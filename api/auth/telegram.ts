import {
  generateAccountPublicId,
  generateAccountUuid,
  pickRandomChildProfileDefaults,
} from '../_lib/crypto.js';
import {
  ensureSchema,
  ensureUserPublicId,
  getSql,
  isDbConfigured,
  isUniqueViolationError,
  userRowToSession,
  type UserRow,
} from '../_lib/db.js';
import {
  createSessionCookie,
  dbUnavailableResponse,
  jsonResponse,
} from '../_lib/session.js';
import { consumeRateLimit, getClientIp, isAllowedAppOrigin } from '../_lib/rateLimit.js';
import {
  consumeTelegramLoginSession,
  createPendingTelegramLoginSession,
  isTelegramAuthStoreConfigured,
} from '../_lib/telegramAuthStore.js';
import {
  createTelegramLoginToken,
  deriveStatelessTelegramIdentity,
  ensureTelegramWebhookRegistered,
  hashTelegramAuthCode,
  hashTelegramLoginToken,
  resolvePublicAppOrigin,
  resolveTelegramBotUsername,
  TELEGRAM_LOGIN_TOKEN_TTL_SEC,
  verifyTelegramLoginToken,
  verifyTelegramWebAppInitData,
} from '../_lib/telegramBot.js';

interface ConsumedCodeRow {
  telegram_id: string;
  telegram_username: string | null;
  first_name: string;
  last_name: string;
}

interface TelegramIdentityInput {
  telegramId: string;
  telegramUsername: string | null;
  firstName: string;
  lastName: string;
  requestedChildName: string;
  requestedAvatarId: string;
}

interface UpsertedTelegramUserResult {
  user: UserRow;
  isNewSignup: boolean;
  state: unknown | null;
}

async function upsertTelegramUserAndLoadState(
  input: TelegramIdentityInput,
): Promise<UpsertedTelegramUserResult | null> {
  await ensureSchema();
  const sql = getSql();

  const telegramId = input.telegramId;
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const username = (input.telegramUsername || '').trim().replace(/^@+/, '');
  const fullName = `${firstName} ${lastName}`.trim();
  const contactDisplay = username
    ? `@${username}`
    : fullName || `Telegram #${telegramId}`;
  const displayName = fullName || (username ? `@${username}` : null);

  const existingRows = (await sql`
    SELECT * FROM users WHERE telegram_id = ${telegramId} LIMIT 1
  `) as UserRow[];

  let user: UserRow | undefined = existingRows[0];
  let isNewSignup = false;

  if (user) {
    const updated = (await sql`
      UPDATE users
      SET
        telegram_username = COALESCE(${username || null}, telegram_username),
        telegram_chat_id = COALESCE(telegram_chat_id, ${telegramId}),
        tg_bot_blocked = FALSE,
        display_name = COALESCE(${displayName}, display_name),
        contact_display = ${contactDisplay},
        updated_at = NOW()
      WHERE id = ${user.id}
      RETURNING *
    `) as UserRow[];
    user = await ensureUserPublicId(updated[0] ?? user);
  } else {
    isNewSignup = true;
    const id = generateAccountUuid();
    const randomDefaults = pickRandomChildProfileDefaults();
    const childName = input.requestedChildName || randomDefaults.childName;
    const avatarId = input.requestedAvatarId || randomDefaults.avatarId;
    const contactKey = `tg:${telegramId}`;

    for (let attempt = 0; attempt < 5; attempt++) {
      const publicId = generateAccountPublicId();
      try {
        const inserted = (await sql`
          INSERT INTO users (
            id, public_id, provider, contact_key, contact_display, telegram_id, telegram_username, telegram_chat_id, tg_reminder_enabled, tg_bot_blocked, display_name, child_name, avatar_id
          )
          VALUES (
            ${id}, ${publicId}, 'telegram', ${contactKey}, ${contactDisplay}, ${telegramId}, ${username || null}, ${telegramId}, TRUE, FALSE, ${displayName}, ${childName}, ${avatarId}
          )
          RETURNING *
        `) as UserRow[];
        user = inserted[0];
        break;
      } catch (err) {
        if (isUniqueViolationError(err, 'public_id') && attempt < 4) {
          continue;
        }
        throw err;
      }
    }
  }

  if (!user) {
    return null;
  }

  const stateRows = (await sql`
    SELECT state_json FROM user_states WHERE user_id = ${user.id} LIMIT 1
  `) as Array<{ state_json: unknown }>;

  return {
    user,
    isNewSignup: isNewSignup && stateRows.length === 0,
    state: stateRows[0]?.state_json ?? null,
  };
}

async function handleTelegramStart(request: Request): Promise<Response> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  if (!botToken) {
    return jsonResponse(
      {
        ok: false,
        code: 'telegram_not_configured',
        errorUz: 'Telegram orqali kirish hali sozlanmagan (TELEGRAM_BOT_TOKEN kerak).',
      },
      503,
    );
  }

  if (!isTelegramAuthStoreConfigured()) {
    return jsonResponse(
      {
        ok: false,
        code: 'db_not_configured',
        errorUz:
          "Ma'lumotlar bazasi yoki token xotirasi ulanmagan (DATABASE_URL yoki KV_REST_API_URL kerak).",
      },
      503,
    );
  }

  const startIpLimit = await consumeRateLimit({
    scope: 'auth_tg_start_ip',
    key: getClientIp(request),
    limit: 12,
    windowSec: 600,
  });
  if (!startIpLimit.allowed) {
    return jsonResponse(
      {
        ok: false,
        code: 'rate_limited',
        errorUz: 'Juda ko‘p urinish. Biroz kutib qayta bosing.',
      },
      429,
      { 'Retry-After': String(startIpLimit.retryAfterSec) },
    );
  }

  let childName: string | undefined;
  let avatarId: string | undefined;

  if (request.method === 'POST') {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.childName === 'string' && body.childName.trim()) {
        childName = body.childName.trim().slice(0, 20);
      }
      if (typeof body.avatarId === 'string' && body.avatarId.trim()) {
        avatarId = body.avatarId.trim().slice(0, 24);
      }
    } catch {
      // Optional JSON body
    }
  } else {
    const reqUrl = new URL(request.url);
    const qChildName = (reqUrl.searchParams.get('childName') || '').trim();
    const qAvatarId = (reqUrl.searchParams.get('avatarId') || '').trim();
    if (qChildName) childName = qChildName.slice(0, 20);
    if (qAvatarId) avatarId = qAvatarId.slice(0, 24);
  }

  const origin = resolvePublicAppOrigin(request);
  try {
    await Promise.race([
      ensureTelegramWebhookRegistered(botToken, origin),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // Never block deep-link creation on webhook registration
  }

  try {
    const loginToken = createTelegramLoginToken(botToken);
    const tokenHash = hashTelegramLoginToken(loginToken, botToken);
    const botUsername = resolveTelegramBotUsername();

    const { expiresAt, backend } = await createPendingTelegramLoginSession({
      tokenHash,
      childName,
      avatarId,
      ttlSec: TELEGRAM_LOGIN_TOKEN_TTL_SEC,
    });

    const deepLink = `https://t.me/${encodeURIComponent(botUsername)}?start=auth_${encodeURIComponent(loginToken)}`;

    return jsonResponse({
      ok: true,
      token: loginToken,
      deepLink,
      botUsername,
      expiresAt,
      storageBackend: backend,
    });
  } catch (err) {
    console.error(
      'Telegram start error:',
      err instanceof Error ? err.message : 'err',
    );
    return jsonResponse(
      {
        ok: false,
        code: 'telegram_start_failed',
        errorUz: 'Telegram kirish havolasini yaratishda xatolik yuz berdi.',
      },
      500,
    );
  }
}

async function handleTelegramStatus(request: Request): Promise<Response> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  if (!botToken) {
    return jsonResponse(
      {
        ok: false,
        code: 'telegram_not_configured',
        errorUz: 'Telegram orqali kirish hali sozlanmagan.',
      },
      503,
    );
  }

  if (!isTelegramAuthStoreConfigured()) {
    return jsonResponse(
      {
        ok: false,
        code: 'db_not_configured',
        errorUz: "Ma'lumotlar bazasi yoki token xotirasi ulanmagan.",
      },
      503,
    );
  }

  const reqUrl = new URL(request.url);
  const token = (reqUrl.searchParams.get('token') || '').trim();
  if (!token || !verifyTelegramLoginToken(token, botToken)) {
    return jsonResponse({ ok: true, status: 'expired' });
  }

  try {
    const tokenHash = hashTelegramLoginToken(token, botToken);
    const consumed = await consumeTelegramLoginSession(tokenHash);

    if (consumed.status !== 'approved') {
      return jsonResponse({ ok: true, status: consumed.status });
    }

    const { data } = consumed;
    const firstName = data.firstName.trim();
    const lastName = data.lastName.trim();
    const username = (data.telegramUsername || '').trim().replace(/^@+/, '');
    const fullName = `${firstName} ${lastName}`.trim();
    const contactDisplay = username
      ? `@${username}`
      : fullName || `Telegram #${data.telegramId}`;
    const requestedChildName = (data.childName || '').trim().slice(0, 20);
    const requestedAvatarId = (data.avatarId || '').trim().slice(0, 24);

    if (!isDbConfigured()) {
      const identity = deriveStatelessTelegramIdentity(data.telegramId, botToken);
      const nowIso = new Date().toISOString();
      const randomDefaults = pickRandomChildProfileDefaults();
      const childName = requestedChildName || randomDefaults.childName;
      const avatarId = requestedAvatarId || randomDefaults.avatarId;

      return jsonResponse(
        {
          ok: true,
          status: 'approved',
          dbSynced: false,
          session: {
            id: identity.id,
            publicId: identity.publicId,
            contact: contactDisplay,
            createdAt: nowIso,
            signedInAt: nowIso,
            provider: 'telegram' as const,
          },
          childName,
          avatarId,
          isNewSignup: false,
          state: null,
        },
        200,
        { 'Set-Cookie': createSessionCookie(identity.id, request) },
      );
    }

    const result = await upsertTelegramUserAndLoadState({
      telegramId: data.telegramId,
      telegramUsername: data.telegramUsername,
      firstName,
      lastName,
      requestedChildName,
      requestedAvatarId,
    });

    if (!result) {
      return jsonResponse(
        {
          ok: false,
          code: 'telegram_db_failed',
          errorUz: 'Hisobni saqlashda xatolik yuz berdi.',
        },
        500,
      );
    }

    return jsonResponse(
      {
        ok: true,
        status: 'approved',
        dbSynced: true,
        session: userRowToSession(result.user),
        childName: result.user.child_name,
        avatarId: result.user.avatar_id,
        isNewSignup: result.isNewSignup,
        state: result.state,
      },
      200,
      { 'Set-Cookie': createSessionCookie(result.user.id, request) },
    );
  } catch (err) {
    console.error(
      'Telegram status polling error:',
      err instanceof Error ? err.message : 'err',
    );
    return jsonResponse(
      { ok: false, errorUz: 'Serverda xatolik yuz berdi. Keyinroq urinib ko‘ring.' },
      500,
    );
  }
}

async function handleTelegramCodeAuth(request: Request): Promise<Response> {
  if (!isDbConfigured()) {
    return dbUnavailableResponse();
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    return jsonResponse(
      {
        ok: false,
        code: 'telegram_not_configured',
        errorUz: 'Telegram orqali kirish hali sozlanmagan (TELEGRAM_BOT_TOKEN kerak).',
      },
      503,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, errorUz: "Noto'g'ri so'rov formati." }, 400);
  }

  const cleanCode =
    typeof body.code === 'string' || typeof body.code === 'number'
      ? String(body.code).replace(/\D/g, '')
      : '';
  if (!/^\d{6}$/.test(cleanCode)) {
    return jsonResponse(
      {
        ok: false,
        code: 'telegram_code_format',
        errorUz: 'Bot yuborgan 6 xonali raqamli kodni kiriting.',
      },
      400,
    );
  }

  const codeIpLimit = await consumeRateLimit({
    scope: 'auth_tg_code_ip',
    key: getClientIp(request),
    limit: 6,
    windowSec: 600,
  });
  if (!codeIpLimit.allowed) {
    return jsonResponse(
      {
        ok: false,
        code: 'rate_limited',
        errorUz: 'Juda ko‘p kod kiritish urinishi. 10 daqiqa kutib turing.',
      },
      429,
      { 'Retry-After': String(codeIpLimit.retryAfterSec) },
    );
  }

  const requestedChildName =
    typeof body.childName === 'string' ? body.childName.trim().slice(0, 20) : '';
  const requestedAvatarId =
    typeof body.avatarId === 'string' ? body.avatarId.trim().slice(0, 24) : '';

  try {
    await ensureSchema();
    const sql = getSql();
    const codeHash = hashTelegramAuthCode(cleanCode, botToken);

    const consumed = (await sql`
      UPDATE telegram_auth_codes
      SET used_at = NOW()
      WHERE code_hash = ${codeHash}
        AND used_at IS NULL
        AND expires_at > NOW()
      RETURNING telegram_id, telegram_username, first_name, last_name
    `) as ConsumedCodeRow[];

    const codeRow = consumed[0];
    if (!codeRow) {
      return jsonResponse(
        {
          ok: false,
          code: 'telegram_code_invalid',
          errorUz: 'Kod noto‘g‘ri yoki muddati tugagan. Telegram botdan /kod orqali yangi kod oling.',
        },
        401,
      );
    }

    const result = await upsertTelegramUserAndLoadState({
      telegramId: codeRow.telegram_id,
      telegramUsername: codeRow.telegram_username,
      firstName: codeRow.first_name,
      lastName: codeRow.last_name,
      requestedChildName,
      requestedAvatarId,
    });

    if (!result) {
      return jsonResponse(
        {
          ok: false,
          code: 'telegram_db_failed',
          errorUz: 'Hisobni saqlashda xatolik yuz berdi.',
        },
        500,
      );
    }

    return jsonResponse(
      {
        ok: true,
        session: userRowToSession(result.user),
        childName: result.user.child_name,
        avatarId: result.user.avatar_id,
        isNewSignup: result.isNewSignup,
        state: result.state,
      },
      200,
      { 'Set-Cookie': createSessionCookie(result.user.id, request) },
    );
  } catch (err) {
    console.error('Telegram code auth error:', err instanceof Error ? err.message : 'err');
    return jsonResponse(
      { ok: false, errorUz: 'Serverda xatolik yuz berdi. Keyinroq urinib ko‘ring.' },
      500,
    );
  }
}

async function handleTelegramWebAppAuth(request: Request): Promise<Response> {
  if (!isAllowedAppOrigin(request)) {
    return jsonResponse(
      { ok: false, code: 'forbidden_origin', errorUz: 'Ruxsat etilmagan manba.' },
      403,
    );
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  if (!botToken) {
    return jsonResponse(
      {
        ok: false,
        code: 'telegram_not_configured',
        errorUz: 'Telegram orqali kirish hali sozlanmagan (TELEGRAM_BOT_TOKEN kerak).',
      },
      503,
    );
  }

  const webappIpLimit = await consumeRateLimit({
    scope: 'auth_tg_webapp_ip',
    key: getClientIp(request),
    limit: 30,
    windowSec: 600,
  });
  if (!webappIpLimit.allowed) {
    return jsonResponse(
      {
        ok: false,
        code: 'rate_limited',
        errorUz: 'Juda ko‘p urinish. Biroz kutib qayta bosing.',
      },
      429,
      { 'Retry-After': String(webappIpLimit.retryAfterSec) },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, errorUz: "Noto'g'ri so'rov formati." }, 400);
  }

  const initData = typeof body.initData === 'string' ? body.initData : '';
  const verified = verifyTelegramWebAppInitData(initData, botToken);
  if (!verified.ok) {
    return jsonResponse(
      {
        ok: false,
        code: 'telegram_webapp_invalid',
        errorUz: 'Telegram WebApp ma’lumotlari tasdiqlanmadi.',
      },
      401,
    );
  }

  const requestedChildName =
    typeof body.childName === 'string' ? body.childName.trim().slice(0, 20) : '';
  const requestedAvatarId =
    typeof body.avatarId === 'string' ? body.avatarId.trim().slice(0, 24) : '';
  const { user: tgUser } = verified;
  const fullName = `${tgUser.firstName} ${tgUser.lastName}`.trim();
  const contactDisplay = tgUser.username
    ? `@${tgUser.username}`
    : fullName || `Telegram #${tgUser.id}`;

  try {
    if (!isDbConfigured()) {
      const identity = deriveStatelessTelegramIdentity(tgUser.id, botToken);
      const nowIso = new Date().toISOString();
      const randomDefaults = pickRandomChildProfileDefaults();
      const childName = requestedChildName || randomDefaults.childName;
      const avatarId = requestedAvatarId || randomDefaults.avatarId;

      return jsonResponse(
        {
          ok: true,
          dbSynced: false,
          session: {
            id: identity.id,
            publicId: identity.publicId,
            contact: contactDisplay,
            createdAt: nowIso,
            signedInAt: nowIso,
            provider: 'telegram' as const,
          },
          childName,
          avatarId,
          isNewSignup: false,
          state: null,
        },
        200,
        { 'Set-Cookie': createSessionCookie(identity.id, request) },
      );
    }

    const result = await upsertTelegramUserAndLoadState({
      telegramId: tgUser.id,
      telegramUsername: tgUser.username,
      firstName: tgUser.firstName,
      lastName: tgUser.lastName,
      requestedChildName,
      requestedAvatarId,
    });

    if (!result) {
      return jsonResponse(
        {
          ok: false,
          code: 'telegram_db_failed',
          errorUz: 'Hisobni saqlashda xatolik yuz berdi.',
        },
        500,
      );
    }

    return jsonResponse(
      {
        ok: true,
        dbSynced: true,
        session: userRowToSession(result.user),
        childName: result.user.child_name,
        avatarId: result.user.avatar_id,
        isNewSignup: result.isNewSignup,
        state: result.state,
      },
      200,
      { 'Set-Cookie': createSessionCookie(result.user.id, request) },
    );
  } catch (err) {
    console.error('Telegram WebApp auth error:', err instanceof Error ? err.message : 'err');
    return jsonResponse(
      { ok: false, errorUz: 'Serverda xatolik yuz berdi. Keyinroq urinib ko‘ring.' },
      500,
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const action = (reqUrl.searchParams.get('action') || '').trim().toLowerCase();

  if (action === 'start') {
    return handleTelegramStart(request);
  }
  if (action === 'status' || (!action && reqUrl.searchParams.has('token'))) {
    return handleTelegramStatus(request);
  }

  return jsonResponse(
    { ok: false, code: 'invalid_action', errorUz: "Noto'g'ri action parametri." },
    400,
  );
}

export async function POST(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const action = (reqUrl.searchParams.get('action') || '').trim().toLowerCase();

  if (action === 'start') {
    return handleTelegramStart(request);
  }
  if (action === 'webapp') {
    return handleTelegramWebAppAuth(request);
  }
  if (!action || action === 'code' || action === 'verify') {
    return handleTelegramCodeAuth(request);
  }

  return jsonResponse(
    { ok: false, code: 'invalid_action', errorUz: "Noto'g'ri action parametri." },
    400,
  );
}
