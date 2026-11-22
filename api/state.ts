import { ensureSchema, getSql, isDbConfigured } from './_lib/db.js';
import { dbUnavailableResponse, getSessionUserId, jsonResponse } from './_lib/session.js';

const MAX_STATE_BYTES = 512 * 1024;

export async function GET(request: Request): Promise<Response> {
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

    const profile = (stateObj as { profile?: { name?: unknown; avatarId?: unknown } }).profile;
    const nextChildName =
      typeof profile?.name === 'string' && profile.name.trim()
        ? profile.name.trim().slice(0, 20)
        : null;
    const nextAvatarId =
      typeof profile?.avatarId === 'string' && profile.avatarId.trim()
        ? profile.avatarId.trim().slice(0, 24)
        : null;

    if (nextChildName || nextAvatarId) {
      await sql`
        UPDATE users
        SET
          child_name = COALESCE(${nextChildName}, child_name),
          avatar_id = COALESCE(${nextAvatarId}, avatar_id),
          updated_at = NOW()
        WHERE id = ${userId}
      `;
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('State PUT error:', err);
    return jsonResponse({ ok: false, errorUz: "Ma'lumotni saqlashda xatolik." }, 500);
  }
}
