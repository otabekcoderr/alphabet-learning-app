import { ensureSchema, getSql, isDbConfigured } from './db.js';
import { getRequestOrigin } from './session.js';
import { getTashkentDateString } from './telegramBot.js';

interface MemoryBucket {
  count: number;
  resetAtMs: number;
  alerted: boolean;
}

const memoryBuckets = new Map<string, MemoryBucket>();

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfterSec: number;
}

export interface DailyBudgetResult {
  allowed: boolean;
  count: number;
  triggeredAlert: boolean;
}

export function resetMemoryRateLimits(): void {
  memoryBuckets.clear();
}

export function getClientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (fwd) return fwd.slice(0, 64);
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 64);
  return 'local';
}

function tryExtractOrigin(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

export function isAllowedAppOrigin(
  request: Request,
  options?: { requireRefererOrSessionOnGet?: boolean; hasSession?: boolean },
): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite === 'cross-site') {
    return false;
  }

  const allowedOrigins = new Set<string>();
  const reqOrigin = tryExtractOrigin(getRequestOrigin(request));
  if (reqOrigin) allowedOrigins.add(reqOrigin);

  const publicUrl = tryExtractOrigin(process.env.PUBLIC_APP_URL?.trim() || null);
  if (publicUrl) allowedOrigins.add(publicUrl);

  if (!process.env.VERCEL) {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
    allowedOrigins.add('http://localhost:8765');
    allowedOrigins.add('http://127.0.0.1:8765');
  }

  const originHeader = request.headers.get('origin');
  let sawValidAppOriginHeader = false;
  if (originHeader !== null) {
    const parsedOrigin = tryExtractOrigin(originHeader);
    if (!parsedOrigin || !allowedOrigins.has(parsedOrigin)) {
      return false;
    }
    sawValidAppOriginHeader = true;
  }

  const refererHeader = request.headers.get('referer');
  let sawValidAppReferer = false;
  if (refererHeader !== null) {
    const parsedReferer = tryExtractOrigin(refererHeader);
    if (!parsedReferer || !allowedOrigins.has(parsedReferer)) {
      return false;
    }
    sawValidAppReferer = true;
  }

  if (
    options?.requireRefererOrSessionOnGet &&
    request.method.toUpperCase() === 'GET' &&
    !options.hasSession &&
    !sawValidAppOriginHeader &&
    !sawValidAppReferer
  ) {
    return false;
  }

  return true;
}

function consumeMemoryBucket(
  bucketKey: string,
  resetAtMs: number,
  nowMs: number,
): MemoryBucket {
  const existing = memoryBuckets.get(bucketKey);
  if (!existing || existing.resetAtMs <= nowMs) {
    const fresh: MemoryBucket = { count: 1, resetAtMs, alerted: false };
    memoryBuckets.set(bucketKey, fresh);
    return fresh;
  }
  existing.count += 1;
  return existing;
}

export async function consumeRateLimit(params: {
  scope: string;
  key: string;
  limit: number;
  windowSec: number;
  nowMs?: number;
}): Promise<RateLimitResult> {
  const nowMs = params.nowMs ?? Date.now();
  const safeWindowSec = Math.max(1, params.windowSec);
  const windowMs = safeWindowSec * 1000;
  const slot = Math.floor(nowMs / windowMs);
  const resetAtMs = (slot + 1) * windowMs;
  const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
  const safeKey = (params.key || 'anon').slice(0, 128);
  const bucketKey = `${params.scope}:${safeKey}:${slot}`;

  let count = 1;
  if (isDbConfigured()) {
    try {
      await ensureSchema();
      const sql = getSql();
      const rows = (await sql`
        INSERT INTO api_rate_limits (bucket_key, hit_count, reset_at)
        VALUES (${bucketKey}, 1, to_timestamp(${resetAtMs / 1000}))
        ON CONFLICT (bucket_key)
        DO UPDATE SET hit_count = api_rate_limits.hit_count + 1
        RETURNING hit_count
      `) as Array<{ hit_count: number }>;
      count = rows[0]?.hit_count ?? 1;
      if (Math.random() < 0.02) {
        void sql`DELETE FROM api_rate_limits WHERE reset_at < NOW()`.catch(() => undefined);
      }
    } catch {
      count = consumeMemoryBucket(bucketKey, resetAtMs, nowMs).count;
    }
  } else {
    count = consumeMemoryBucket(bucketKey, resetAtMs, nowMs).count;
  }

  return {
    allowed: count <= params.limit,
    count,
    remaining: Math.max(0, params.limit - count),
    retryAfterSec,
  };
}

async function sendBudgetAdminAlert(
  service: 'stt' | 'tts',
  todayUz: string,
  count: number,
  dailyCap: number,
): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  const adminChatId =
    process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() || process.env.TELEGRAM_CHAT_ID?.trim() || '';
  if (!botToken || !adminChatId) {
    return false;
  }
  try {
    const safeTokenPath = botToken.split(':').map(encodeURIComponent).join(':');
    const resp = await fetch(`https://api.telegram.org/bot${safeTokenPath}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminChatId,
        text: `⚠️ ALIFBO XARAJAT OGOHLANTIRUVI: Bugungi (${todayUz}) ${service.toUpperCase()} so‘rovlari 80% chegaradan oshdi (${count}/${dailyCap}).`,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(4000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function consumeDailyGlobalBudget(params: {
  service: 'stt' | 'tts';
  dailyCap: number;
  now?: Date;
}): Promise<DailyBudgetResult> {
  const nowDate = params.now ?? new Date();
  const nowMs = nowDate.getTime();
  const todayUz = getTashkentDateString(nowDate);
  const bucketKey = `daily_global:${params.service}:${todayUz}`;
  const resetAtMs = nowMs + 36 * 3600 * 1000;
  const alertAt = Math.max(1, Math.ceil(params.dailyCap * 0.8));

  let count = 1;
  let shouldTriggerAlert = false;

  if (isDbConfigured()) {
    try {
      await ensureSchema();
      const sql = getSql();
      const rows = (await sql`
        INSERT INTO api_rate_limits (bucket_key, hit_count, reset_at, alerted)
        VALUES (${bucketKey}, 1, to_timestamp(${resetAtMs / 1000}), FALSE)
        ON CONFLICT (bucket_key)
        DO UPDATE SET hit_count = api_rate_limits.hit_count + 1
        RETURNING hit_count, alerted
      `) as Array<{ hit_count: number; alerted: boolean }>;
      count = rows[0]?.hit_count ?? 1;
      const alreadyAlerted = Boolean(rows[0]?.alerted);
      if (count >= alertAt && !alreadyAlerted) {
        const claimed = (await sql`
          UPDATE api_rate_limits
          SET alerted = TRUE
          WHERE bucket_key = ${bucketKey} AND alerted = FALSE
          RETURNING bucket_key
        `) as Array<{ bucket_key: string }>;
        shouldTriggerAlert = claimed.length > 0;
      }
    } catch {
      const bucket = consumeMemoryBucket(bucketKey, resetAtMs, nowMs);
      count = bucket.count;
      if (count >= alertAt && !bucket.alerted) {
        bucket.alerted = true;
        shouldTriggerAlert = true;
      }
    }
  } else {
    const bucket = consumeMemoryBucket(bucketKey, resetAtMs, nowMs);
    count = bucket.count;
    if (count >= alertAt && !bucket.alerted) {
      bucket.alerted = true;
      shouldTriggerAlert = true;
    }
  }

  let triggeredAlert = false;
  if (shouldTriggerAlert) {
    triggeredAlert = await sendBudgetAdminAlert(params.service, todayUz, count, params.dailyCap);
  }

  return {
    allowed: count <= params.dailyCap,
    count,
    triggeredAlert,
  };
}
