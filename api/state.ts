import { ensureSchema, getSql, isDbConfigured } from './_lib/db.js';
import { handleHealthCheck } from './_lib/health.js';
import { consumeRateLimit, isAllowedAppOrigin } from './_lib/rateLimit.js';
import { dbUnavailableResponse, getSessionUserId, jsonResponse } from './_lib/session.js';
import { getTashkentDateString } from './_lib/telegramBot.js';

const MAX_STATE_BYTES = 512 * 1024;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_SERVER_STARS = 50_000;
export const MAX_SERVER_SESSIONS = 100_000;
export const MAX_SERVER_DAILY_SECONDS = 86_400;
export const MAX_SERVER_WORD_PROGRESS_KEYS = 500;
export const MAX_SERVER_LETTER_MASTERY_KEYS = 40;

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

/** Clamp numeric bounds and cap collection sizes before persisting user state to Postgres. */
export function sanitizeServerStatePayload(
  stateObj: Record<string, unknown>,
  todayUz: string = getTashkentDateString(),
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...stateObj };

  if (typeof next.totalStars === 'number') {
    next.totalStars = Number.isFinite(next.totalStars)
      ? Math.min(MAX_SERVER_STARS, Math.max(0, Math.trunc(next.totalStars)))
      : 0;
  }
  if (typeof next.totalEffortStars === 'number') {
    next.totalEffortStars = Number.isFinite(next.totalEffortStars)
      ? Math.min(MAX_SERVER_STARS, Math.max(0, Math.trunc(next.totalEffortStars)))
      : 0;
  }
  if (typeof next.todayPracticedSeconds === 'number') {
    next.todayPracticedSeconds = Number.isFinite(next.todayPracticedSeconds)
      ? Math.min(MAX_SERVER_DAILY_SECONDS, Math.max(0, Math.round(next.todayPracticedSeconds)))
      : 0;
  }
  if (typeof next.completedSessionsCount === 'number') {
    next.completedSessionsCount = Number.isFinite(next.completedSessionsCount)
      ? Math.min(MAX_SERVER_SESSIONS, Math.max(0, Math.trunc(next.completedSessionsCount)))
      : 0;
  }

  if (Array.isArray(next.practiceDates)) {
    const cleanDates = new Set<string>();
    for (const d of next.practiceDates) {
      if (typeof d === 'string' && ISO_DATE_REGEX.test(d)) {
        cleanDates.add(d > todayUz ? todayUz : d);
      }
    }
    next.practiceDates = Array.from(cleanDates).sort().slice(-1095);
  }

  if (isPlainRecord(next.wordProgress)) {
    const cappedWordProgress: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(next.wordProgress)) {
      if (count >= MAX_SERVER_WORD_PROGRESS_KEYS) break;
      if (isPlainRecord(v)) {
        cappedWordProgress[k] = v;
        count += 1;
      }
    }
    next.wordProgress = cappedWordProgress;
  }

  if (isPlainRecord(next.letterMastery)) {
    const cappedLetterMastery: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(next.letterMastery)) {
      if (count >= MAX_SERVER_LETTER_MASTERY_KEYS) break;
      if (isPlainRecord(v)) {
        cappedLetterMastery[k] = v;
        count += 1;
      }
    }
    next.letterMastery = cappedLetterMastery;
  }

  if (Array.isArray(next.seenWordIds)) {
    const seen = new Set<string>();
    for (const id of next.seenWordIds) {
      if (typeof id === 'string' && id.trim().length > 0 && id.length <= 64) {
        seen.add(id);
        if (seen.size >= 1000) break;
      }
    }
    next.seenWordIds = Array.from(seen);
  }

  return next;
}

function computeStreakDays(sortedUniqueDates: string[]): number {
  if (sortedUniqueDates.length === 0) return 0;
  let streak = 1;
  for (let i = sortedUniqueDates.length - 1; i > 0; i--) {
    const curMs = Date.parse(`${sortedUniqueDates[i]}T00:00:00Z`);
    const prevMs = Date.parse(`${sortedUniqueDates[i - 1]}T00:00:00Z`);
    if (Math.round((curMs - prevMs) / 86_400_000) === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function extractUserActivityMeta(stateObj: Record<string, unknown>): {
  nextChildName: string | null;
  nextAvatarId: string | null;
  latestPracticeDate: string | null;
  currentStreakDays: number;
  masteredWordsCount: number;
} {
  const profile =
    stateObj.profile && typeof stateObj.profile === 'object'
      ? (stateObj.profile as { name?: unknown; avatarId?: unknown })
      : undefined;
  const nextChildName =
    typeof profile?.name === 'string' && profile.name.trim()
      ? profile.name.trim().slice(0, 20)
      : null;
  const nextAvatarId =
    typeof profile?.avatarId === 'string' && profile.avatarId.trim()
      ? profile.avatarId.trim().slice(0, 24)
      : null;

  const todayUz = getTashkentDateString();
  const rawDates = Array.isArray(stateObj.practiceDates) ? stateObj.practiceDates : [];
  const dateSet = new Set<string>();
  for (const d of rawDates) {
    if (typeof d === 'string' && ISO_DATE_REGEX.test(d)) {
      dateSet.add(d > todayUz ? todayUz : d);
    }
  }

  const rawDailyDate =
    typeof stateObj.dailyPracticeDate === 'string' && ISO_DATE_REGEX.test(stateObj.dailyPracticeDate)
      ? stateObj.dailyPracticeDate
      : null;
  const dailyDate = rawDailyDate ? (rawDailyDate > todayUz ? todayUz : rawDailyDate) : null;
  const todaySeconds =
    typeof stateObj.todayPracticedSeconds === 'number' ? stateObj.todayPracticedSeconds : 0;
  if (dailyDate && todaySeconds > 0) {
    dateSet.add(dailyDate);
  }

  const sortedDates = Array.from(dateSet).sort();
  const latestPracticeDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1]! : null;
  const currentStreakDays = computeStreakDays(sortedDates);

  let masteredWordsCount = 0;
  if (
    stateObj.wordProgress &&
    typeof stateObj.wordProgress === 'object' &&
    !Array.isArray(stateObj.wordProgress)
  ) {
    for (const val of Object.values(stateObj.wordProgress as Record<string, unknown>)) {
      if (val && typeof val === 'object' && (val as { status?: unknown }).status === 'mastered') {
        masteredWordsCount++;
      }
    }
  }

  return {
    nextChildName,
    nextAvatarId,
    latestPracticeDate,
    currentStreakDays,
    masteredWordsCount,
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = (url.searchParams.get('action') || '').trim().toLowerCase();
  if (action === 'health' || url.pathname.endsWith('/health')) {
    return handleHealthCheck();
  }

  if (!isDbConfigured()) {
    return dbUnavailableResponse();
  }

  const userId = getSessionUserId(request);
  if (!userId) {
    return jsonResponse({ ok: false, errorUz: 'Avval tizimga kiring.' }, 401);
  }

  try {
    await ensureSchema();
    const sql = getSql();
    const rows = (await sql`
      SELECT state_json FROM user_states WHERE user_id = ${userId} LIMIT 1
    `) as Array<{ state_json: unknown }>;

    return jsonResponse({
      ok: true,
      state: rows[0]?.state_json ?? null,
    });
  } catch (err) {
    console.error('State GET error:', err);
    return jsonResponse({ ok: false, errorUz: "Ma'lumotni o'qishda xatolik." }, 500);
  }
}

export async function PUT(request: Request): Promise<Response> {
  if (!isAllowedAppOrigin(request)) {
    return jsonResponse(
      { ok: false, code: 'state_forbidden_origin', errorUz: 'Ruxsat etilmagan manba.' },
      403,
    );
  }
  if (!isDbConfigured()) {
    return dbUnavailableResponse();
  }

  const userId = getSessionUserId(request);
  if (!userId) {
    return jsonResponse({ ok: false, errorUz: 'Avval tizimga kiring.' }, 401);
  }

  const rl = await consumeRateLimit({
    scope: 'state_put_user',
    key: userId,
    limit: 30,
    windowSec: 60,
  });
  if (!rl.allowed) {
    return jsonResponse(
      { ok: false, code: 'rate_limited', errorUz: "Juda ko'p saqlash so'rovi yuborildi. Biroz kuting." },
      429,
      { 'Retry-After': String(rl.retryAfterSec) },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, errorUz: "Noto'g'ri JSON formati." }, 400);
  }

  const stateObj = body.state;
  if (!stateObj || typeof stateObj !== 'object' || Array.isArray(stateObj)) {
    return jsonResponse({ ok: false, errorUz: "state obyekti noto'g'ri." }, 400);
  }

  const sanitizedState = sanitizeServerStatePayload(stateObj as Record<string, unknown>);
  const serialized = JSON.stringify(sanitizedState);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
    return jsonResponse({ ok: false, errorUz: "Ma'lumot hajmi juda katta." }, 413);
  }

  try {
    await ensureSchema();
    const sql = getSql();

    await sql`
      INSERT INTO user_states (user_id, state_json, updated_at)
      VALUES (${userId}, ${serialized}::jsonb, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        state_json = EXCLUDED.state_json,
        updated_at = NOW()
    `;

    const meta = extractUserActivityMeta(sanitizedState);
    const todayUz = getTashkentDateString();
    const practicedToday = meta.latestPracticeDate === todayUz;

    await sql`
      UPDATE users
      SET
        child_name = COALESCE(${meta.nextChildName}, child_name),
        avatar_id = COALESCE(${meta.nextAvatarId}, avatar_id),
        last_practice_date = CASE
          WHEN ${meta.latestPracticeDate} IS NULL THEN last_practice_date
          WHEN last_practice_date IS NULL OR ${meta.latestPracticeDate} > last_practice_date THEN ${meta.latestPracticeDate}
          ELSE last_practice_date
        END,
        current_streak_days = ${meta.currentStreakDays},
        mastered_words_count = ${meta.masteredWordsCount},
        consecutive_missed_reminders = CASE
          WHEN ${practicedToday} THEN 0
          ELSE consecutive_missed_reminders
        END,
        updated_at = NOW()
      WHERE id = ${userId}
    `;

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('State PUT error:', err);
    return jsonResponse({ ok: false, errorUz: "Ma'lumotni saqlashda xatolik." }, 500);
  }
}
