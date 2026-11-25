import { ensureSchema, getSql, isDbConfigured } from './_lib/db.js';
import { handleHealthCheck } from './_lib/health.js';
import { dbUnavailableResponse, getSessionUserId, jsonResponse } from './_lib/session.js';
import { getTashkentDateString } from './_lib/telegramBot.js';

const MAX_STATE_BYTES = 512 * 1024;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

  const rawDates = Array.isArray(stateObj.practiceDates) ? stateObj.practiceDates : [];
  const dateSet = new Set<string>();
  for (const d of rawDates) {
    if (typeof d === 'string' && ISO_DATE_REGEX.test(d)) {
      dateSet.add(d);
    }
  }

  const dailyDate =
    typeof stateObj.dailyPracticeDate === 'string' && ISO_DATE_REGEX.test(stateObj.dailyPracticeDate)
      ? stateObj.dailyPracticeDate
      : null;
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
  if (!isDbConfigured()) {
    return dbUnavailableResponse();
  }

  const userId = getSessionUserId(request);
  if (!userId) {
    return jsonResponse({ ok: false, errorUz: 'Avval tizimga kiring.' }, 401);
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

  const serialized = JSON.stringify(stateObj);
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

    const meta = extractUserActivityMeta(stateObj as Record<string, unknown>);
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
