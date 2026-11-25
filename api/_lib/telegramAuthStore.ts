import { ensureSchema, getSql, isDbConfigured } from './db.js';

export type TelegramAuthStoreBackend = 'postgres' | 'kv' | 'memory' | 'none';

export interface ApprovedTelegramLoginData {
  childName: string | null;
  avatarId: string | null;
  telegramId: string;
  telegramUsername: string | null;
  firstName: string;
  lastName: string;
}

export type ConsumeTelegramSessionResult =
  | { status: 'pending'; expiresAt: string }
  | { status: 'expired' }
  | { status: 'approved'; data: ApprovedTelegramLoginData };

export type ConsumeTelegramLinkResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'expired_or_invalid' };

interface MemoryTelegramLoginRecord {
  status: 'pending' | 'approved' | 'pending_link' | 'linked';
  linkUserId?: string | null;
  childName: string | null;
  avatarId: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  firstName: string;
  lastName: string;
  expiresAtMs: number;
  consumedAtMs: number | null;
}

const memoryStore = new Map<string, MemoryTelegramLoginRecord>();

function getKvCredentials(): { url: string; token: string } | null {
  const url = (
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const token = (
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    ''
  ).trim();
  if (!url || !token) return null;
  return { url, token };
}

export function getTelegramAuthStoreBackend(): TelegramAuthStoreBackend {
  if (isDbConfigured()) return 'postgres';
  if (getKvCredentials()) return 'kv';
  if (!process.env.VERCEL) return 'memory';
  return 'none';
}

export function isTelegramAuthStoreConfigured(): boolean {
  return getTelegramAuthStoreBackend() !== 'none';
}

/** Clear the local in-memory store (used in unit tests). */
export function resetMemoryTelegramAuthStore(): void {
  memoryStore.clear();
}

async function runKvCommand<T = unknown>(command: string[]): Promise<T | null> {
  const creds = getKvCredentials();
  if (!creds) return null;

  const resp = await fetch(creds.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(4000),
  });
  if (!resp.ok) {
    throw new Error(`KV REST HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as { result?: T; error?: string };
  if (json.error) {
    throw new Error(json.error);
  }
  return json.result ?? null;
}

export async function createPendingTelegramLoginSession(params: {
  tokenHash: string;
  childName?: string;
  avatarId?: string;
  ttlSec: number;
}): Promise<{ expiresAt: string; backend: TelegramAuthStoreBackend }> {
  const backend = getTelegramAuthStoreBackend();
  const expiresAtMs = Date.now() + params.ttlSec * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const childName = params.childName?.trim().slice(0, 20) || null;
  const avatarId = params.avatarId?.trim().slice(0, 24) || null;

  if (backend === 'postgres') {
    await ensureSchema();
    const sql = getSql();
    await sql`
      DELETE FROM telegram_login_sessions
      WHERE expires_at < NOW() - INTERVAL '1 hour'
    `;
    await sql`
      INSERT INTO telegram_login_sessions (
        token_hash, status, child_name, avatar_id, expires_at
      )
      VALUES (
        ${params.tokenHash}, 'pending', ${childName}, ${avatarId}, ${expiresAt}
      )
      ON CONFLICT (token_hash) DO UPDATE SET
        status = 'pending',
        child_name = EXCLUDED.child_name,
        avatar_id = EXCLUDED.avatar_id,
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL,
        approved_at = NULL
    `;
    return { expiresAt, backend };
  }

  if (backend === 'kv') {
    const key = `tg_login:${params.tokenHash}`;
    const record: MemoryTelegramLoginRecord = {
      status: 'pending',
      childName,
      avatarId,
      telegramId: null,
      telegramUsername: null,
      firstName: '',
      lastName: '',
      expiresAtMs,
      consumedAtMs: null,
    };
    await runKvCommand(['SET', key, JSON.stringify(record), 'EX', String(params.ttlSec)]);
    return { expiresAt, backend };
  }

  if (backend === 'memory') {
    const now = Date.now();
    for (const [key, val] of memoryStore.entries()) {
      if (val.expiresAtMs <= now) {
        memoryStore.delete(key);
      }
    }
    memoryStore.set(params.tokenHash, {
      status: 'pending',
      childName,
      avatarId,
      telegramId: null,
      telegramUsername: null,
      firstName: '',
      lastName: '',
      expiresAtMs,
      consumedAtMs: null,
    });
    return { expiresAt, backend };
  }

  throw new Error('Telegram auth store is not configured');
}

export async function approveTelegramLoginSession(params: {
  tokenHash: string;
  telegramId: string;
  telegramUsername: string | null;
  firstName: string;
  lastName: string;
}): Promise<boolean> {
  const backend = getTelegramAuthStoreBackend();

  if (backend === 'postgres') {
    await ensureSchema();
    const sql = getSql();
    const updated = (await sql`
      UPDATE telegram_login_sessions
      SET
        status = 'approved',
        telegram_id = ${params.telegramId},
        telegram_username = ${params.telegramUsername},
        first_name = ${params.firstName},
        last_name = ${params.lastName},
        approved_at = NOW()
      WHERE token_hash = ${params.tokenHash}
        AND status = 'pending'
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING token_hash
    `) as Array<{ token_hash: string }>;
    return updated.length > 0;
  }

  if (backend === 'kv') {
    const key = `tg_login:${params.tokenHash}`;
    const raw = await runKvCommand<string>(['GET', key]);
    if (!raw) return false;
    const record = JSON.parse(raw) as MemoryTelegramLoginRecord;
    const remainingSec = Math.ceil((record.expiresAtMs - Date.now()) / 1000);
    if (remainingSec <= 0 || record.status !== 'pending' || record.consumedAtMs !== null) {
      return false;
    }
    const nextRecord: MemoryTelegramLoginRecord = {
      ...record,
      status: 'approved',
      telegramId: params.telegramId,
      telegramUsername: params.telegramUsername,
      firstName: params.firstName,
      lastName: params.lastName,
    };
    await runKvCommand(['SET', key, JSON.stringify(nextRecord), 'EX', String(remainingSec)]);
    return true;
  }

  if (backend === 'memory') {
    const record = memoryStore.get(params.tokenHash);
    if (
      !record ||
      record.expiresAtMs <= Date.now() ||
      record.status !== 'pending' ||
      record.consumedAtMs !== null
    ) {
      return false;
    }
    record.status = 'approved';
    record.telegramId = params.telegramId;
    record.telegramUsername = params.telegramUsername;
    record.firstName = params.firstName;
    record.lastName = params.lastName;
    return true;
  }

  return false;
}

export async function consumeTelegramLoginSession(
  tokenHash: string,
): Promise<ConsumeTelegramSessionResult> {
  const backend = getTelegramAuthStoreBackend();

  if (backend === 'postgres') {
    await ensureSchema();
    const sql = getSql();
    const approvedRows = (await sql`
      UPDATE telegram_login_sessions
      SET consumed_at = NOW()
      WHERE token_hash = ${tokenHash}
        AND status = 'approved'
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING child_name, avatar_id, telegram_id, telegram_username, first_name, last_name
    `) as Array<{
      child_name: string | null;
      avatar_id: string | null;
      telegram_id: string | null;
      telegram_username: string | null;
      first_name: string;
      last_name: string;
    }>;

    const approved = approvedRows[0];
    if (approved && approved.telegram_id) {
      return {
        status: 'approved',
        data: {
          childName: approved.child_name,
          avatarId: approved.avatar_id,
          telegramId: approved.telegram_id,
          telegramUsername: approved.telegram_username,
          firstName: approved.first_name,
          lastName: approved.last_name,
        },
      };
    }

    const statusRows = (await sql`
      SELECT status, expires_at, consumed_at
      FROM telegram_login_sessions
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `) as Array<{
      status: string;
      expires_at: string | Date;
      consumed_at: string | Date | null;
    }>;

    const row = statusRows[0];
    if (!row || row.consumed_at !== null) {
      return { status: 'expired' };
    }
    const expiresAtMs =
      row.expires_at instanceof Date
        ? row.expires_at.getTime()
        : new Date(String(row.expires_at)).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return { status: 'expired' };
    }
    if (row.status === 'pending') {
      return { status: 'pending', expiresAt: new Date(expiresAtMs).toISOString() };
    }
    return { status: 'expired' };
  }

  if (backend === 'kv') {
    const key = `tg_login:${tokenHash}`;
    const raw = await runKvCommand<string>(['GET', key]);
    if (!raw) return { status: 'expired' };
    const record = JSON.parse(raw) as MemoryTelegramLoginRecord;
    if (record.expiresAtMs <= Date.now() || record.consumedAtMs !== null) {
      return { status: 'expired' };
    }
    if (record.status === 'pending') {
      return { status: 'pending', expiresAt: new Date(record.expiresAtMs).toISOString() };
    }
    if (record.status === 'approved' && record.telegramId) {
      const claimKey = `tg_login_claimed:${tokenHash}`;
      const remainingSec = Math.max(10, Math.ceil((record.expiresAtMs - Date.now()) / 1000));
      const lockRes = await runKvCommand<string | null>([
        'SET',
        claimKey,
        '1',
        'NX',
        'EX',
        String(remainingSec),
      ]);
      if (lockRes !== 'OK') {
        return { status: 'expired' };
      }
      await runKvCommand(['DEL', key]);
      return {
        status: 'approved',
        data: {
          childName: record.childName,
          avatarId: record.avatarId,
          telegramId: record.telegramId,
          telegramUsername: record.telegramUsername,
          firstName: record.firstName,
          lastName: record.lastName,
        },
      };
    }
    return { status: 'expired' };
  }

  if (backend === 'memory') {
    const record = memoryStore.get(tokenHash);
    if (!record || record.expiresAtMs <= Date.now() || record.consumedAtMs !== null) {
      return { status: 'expired' };
    }
    if (record.status === 'pending') {
      return { status: 'pending', expiresAt: new Date(record.expiresAtMs).toISOString() };
    }
    if (record.status === 'approved' && record.telegramId) {
      record.consumedAtMs = Date.now();
      return {
        status: 'approved',
        data: {
          childName: record.childName,
          avatarId: record.avatarId,
          telegramId: record.telegramId,
          telegramUsername: record.telegramUsername,
          firstName: record.firstName,
          lastName: record.lastName,
        },
      };
    }
    return { status: 'expired' };
  }

  return { status: 'expired' };
}

export async function createPendingTelegramLinkSession(params: {
  tokenHash: string;
  userId: string;
  ttlSec: number;
}): Promise<{ expiresAt: string; backend: TelegramAuthStoreBackend }> {
  const backend = getTelegramAuthStoreBackend();
  const expiresAtMs = Date.now() + params.ttlSec * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();

  if (backend === 'postgres') {
    await ensureSchema();
    const sql = getSql();
    await sql`
      DELETE FROM telegram_login_sessions
      WHERE expires_at < NOW() - INTERVAL '1 hour'
    `;
    await sql`
      INSERT INTO telegram_login_sessions (
        token_hash, status, link_user_id, expires_at
      )
      VALUES (
        ${params.tokenHash}, 'pending_link', ${params.userId}, ${expiresAt}
      )
      ON CONFLICT (token_hash) DO UPDATE SET
        status = 'pending_link',
        link_user_id = EXCLUDED.link_user_id,
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL,
        approved_at = NULL
    `;
    return { expiresAt, backend };
  }

  if (backend === 'kv') {
    const key = `tg_link:${params.tokenHash}`;
    const record: MemoryTelegramLoginRecord = {
      status: 'pending_link',
      linkUserId: params.userId,
      childName: null,
      avatarId: null,
      telegramId: null,
      telegramUsername: null,
      firstName: '',
      lastName: '',
      expiresAtMs,
      consumedAtMs: null,
    };
    await runKvCommand(['SET', key, JSON.stringify(record), 'EX', String(params.ttlSec)]);
    return { expiresAt, backend };
  }

  if (backend === 'memory') {
    memoryStore.set(params.tokenHash, {
      status: 'pending_link',
      linkUserId: params.userId,
      childName: null,
      avatarId: null,
      telegramId: null,
      telegramUsername: null,
      firstName: '',
      lastName: '',
      expiresAtMs,
      consumedAtMs: null,
    });
    return { expiresAt, backend };
  }

  throw new Error('Telegram auth store is not configured');
}

export async function consumeTelegramLinkSessionOnWebhook(params: {
  tokenHash: string;
}): Promise<ConsumeTelegramLinkResult> {
  const backend = getTelegramAuthStoreBackend();

  if (backend === 'postgres') {
    await ensureSchema();
    const sql = getSql();
    const rows = (await sql`
      UPDATE telegram_login_sessions
      SET status = 'linked', approved_at = NOW(), consumed_at = NOW()
      WHERE token_hash = ${params.tokenHash}
        AND status = 'pending_link'
        AND consumed_at IS NULL
        AND expires_at > NOW()
        AND link_user_id IS NOT NULL
      RETURNING link_user_id
    `) as Array<{ link_user_id: string | null }>;
    const userId = rows[0]?.link_user_id;
    return userId ? { ok: true, userId } : { ok: false, reason: 'expired_or_invalid' };
  }

  if (backend === 'kv') {
    const key = `tg_link:${params.tokenHash}`;
    const raw = await runKvCommand<string>(['GET', key]);
    if (!raw) return { ok: false, reason: 'expired_or_invalid' };
    const record = JSON.parse(raw) as MemoryTelegramLoginRecord;
    if (
      record.expiresAtMs <= Date.now() ||
      record.status !== 'pending_link' ||
      record.consumedAtMs !== null ||
      !record.linkUserId
    ) {
      return { ok: false, reason: 'expired_or_invalid' };
    }
    await runKvCommand(['DEL', key]);
    return { ok: true, userId: record.linkUserId };
  }

  if (backend === 'memory') {
    const record = memoryStore.get(params.tokenHash);
    if (
      !record ||
      record.expiresAtMs <= Date.now() ||
      record.status !== 'pending_link' ||
      record.consumedAtMs !== null ||
      !record.linkUserId
    ) {
      return { ok: false, reason: 'expired_or_invalid' };
    }
    record.status = 'linked';
    record.consumedAtMs = Date.now();
    return { ok: true, userId: record.linkUserId };
  }

  return { ok: false, reason: 'expired_or_invalid' };
}
