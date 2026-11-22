import {
  generateAccountPublicId,
  generateAccountUuid,
  hashPassword,
  normalizeContactKey,
  verifyPassword,
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
  clearSessionCookie,
  createSessionCookie,
  dbUnavailableResponse,
  getSessionUserId,
  jsonResponse,
} from '../_lib/session.js';
import { isTelegramAuthStoreConfigured } from '../_lib/telegramAuthStore.js';
import {
  ensureTelegramWebhookRegistered,
  resolvePublicAppOrigin,
  resolveTelegramBotUsername,
} from '../_lib/telegramBot.js';

async function handleMe(request: Request): Promise<Response> {
  if (!isDbConfigured()) {
    return jsonResponse({ ok: true, authenticated: false, dbConfigured: false });
  }

  const userId = getSessionUserId(request);
  if (!userId) {
    return jsonResponse({ ok: true, authenticated: false, dbConfigured: true });
  }

  try {
    await ensureSchema();
    const sql = getSql();

    const rows = (await sql`
      SELECT * FROM users WHERE id = ${userId} LIMIT 1
    `) as UserRow[];

    const user = rows[0];
    if (!user) {
      return jsonResponse(
        { ok: true, authenticated: false, dbConfigured: true },
        200,
        { 'Set-Cookie': clearSessionCookie(request) },
      );
    }

    const userWithPublicId = await ensureUserPublicId(user);

    const stateRows = (await sql`
      SELECT state_json FROM user_states WHERE user_id = ${userWithPublicId.id} LIMIT 1
    `) as Array<{ state_json: unknown }>;

    return jsonResponse({
      ok: true,
      authenticated: true,
      dbConfigured: true,
      session: userRowToSession(userWithPublicId),
      childName: userWithPublicId.child_name,
      avatarId: userWithPublicId.avatar_id,
      state: stateRows[0]?.state_json ?? null,
    });
  } catch (err) {
    console.error('Me endpoint error:', err);
    return jsonResponse({ ok: true, authenticated: false, dbConfigured: true });
  }
}

async function handleProviders(request: Request): Promise<Response> {
  const google = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  const botIdMatch = /^(\d+):.+/.exec(botToken);
  const telegramBotId = botIdMatch?.[1] ?? null;
  const rawBotUsername = resolveTelegramBotUsername();
  const telegramStoreConfigured = isTelegramAuthStoreConfigured();
  const telegram = Boolean(telegramBotId && rawBotUsername);

  if (telegram && botToken) {
    try {
      const origin = resolvePublicAppOrigin(request);
      await Promise.race([
        ensureTelegramWebhookRegistered(botToken, origin),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      // Never block /api/auth/session?action=providers on webhook registration
    }
  }

  return jsonResponse({
    ok: true,
    dbConfigured: isDbConfigured(),
    google,
    telegram,
    telegramStoreConfigured,
    telegramAuthMode: 'bot_deeplink',
    telegramBotUsername: telegram ? rawBotUsername : null,
    telegramBotId: telegram ? telegramBotId : null,
  });
}

async function handleLogout(request: Request): Promise<Response> {
  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': clearSessionCookie(request),
  });
}

async function handleLogin(request: Request): Promise<Response> {
  if (!isDbConfigured()) {
    return dbUnavailableResponse();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, errorUz: "Noto'g'ri so'rov formati." }, 400);
  }

  const contact = typeof body.contact === 'string' ? body.contact : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const contactKey = normalizeContactKey(contact);

  if (!contactKey || !password) {
    return jsonResponse({ ok: false, errorUz: 'Telefon/pochta va parolni kiriting.' }, 400);
  }

  try {
    await ensureSchema();
    const sql = getSql();

    const rows = (await sql`
      SELECT * FROM users WHERE contact_key = ${contactKey} LIMIT 1
    `) as UserRow[];

    const matched = rows[0];
    if (!matched) {
      return jsonResponse(
        { ok: false, errorUz: 'Bunday hisob topilmadi. Avval ro‘yxatdan o‘ting.' },
        401,
      );
    }

    if (!matched.password_salt || !matched.password_hash) {
      return jsonResponse(
        {
          ok: false,
          errorUz:
            'Bu hisob Google yoki Telegram orqali yaratilgan. O‘sha tugma orqali kiring.',
        },
        401,
      );
    }

    if (!verifyPassword(password, matched.password_salt, matched.password_hash)) {
      return jsonResponse(
        { ok: false, errorUz: 'Parol noto‘g‘ri. Qaytadan urinib ko‘ring.' },
        401,
      );
    }

    const userWithPublicId = await ensureUserPublicId(matched);

    const stateRows = (await sql`
      SELECT state_json FROM user_states WHERE user_id = ${userWithPublicId.id} LIMIT 1
    `) as Array<{ state_json: unknown }>;

    return jsonResponse(
      {
        ok: true,
        session: userRowToSession(userWithPublicId),
        childName: userWithPublicId.child_name,
        avatarId: userWithPublicId.avatar_id,
        state: stateRows[0]?.state_json ?? null,
      },
      200,
      { 'Set-Cookie': createSessionCookie(userWithPublicId.id, request) },
    );
  } catch (err) {
    console.error('Login error:', err);
    return jsonResponse(
      { ok: false, errorUz: 'Serverda xatolik yuz berdi. Keyinroq urinib ko‘ring.' },
      500,
    );
  }
}

async function handleRegister(request: Request): Promise<Response> {
  if (!isDbConfigured()) {
    return dbUnavailableResponse();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, errorUz: "Noto'g'ri so'rov formati." }, 400);
  }

  const contactDisplay = typeof body.contact === 'string' ? body.contact.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const childName = typeof body.childName === 'string' ? body.childName.trim() : '';
  const avatarId = typeof body.avatarId === 'string' ? body.avatarId.trim() : '';
  const contactKey = normalizeContactKey(contactDisplay);

  if (contactDisplay.length < 4) {
    return jsonResponse(
      { ok: false, errorUz: 'Telefon raqami yoki elektron pochta manzilini to‘g‘ri kiriting.' },
      400,
    );
  }
  if (password.length < 6) {
    return jsonResponse(
      { ok: false, errorUz: 'Parol kamida 6 ta belgidan iborat bo‘lishi kerak.' },
      400,
    );
  }
  if (!childName) {
    return jsonResponse(
      { ok: false, errorUz: 'Bolaning ismi yoki taxallusini kiriting.' },
      400,
    );
  }
  if (!avatarId) {
    return jsonResponse(
      { ok: false, errorUz: '8 ta qahramondan birini tanlang.' },
      400,
    );
  }

  try {
    await ensureSchema();
    const sql = getSql();

    const existing = (await sql`
      SELECT id FROM users WHERE contact_key = ${contactKey} LIMIT 1
    `) as Array<{ id: string }>;

    if (existing.length > 0) {
      return jsonResponse(
        {
          ok: false,
          errorUz:
            'Bu telefon raqami yoki pochta bilan allaqachon hisob yaratilgan. «Kirish» bo‘limidan kiring.',
        },
        409,
      );
    }

    const id = generateAccountUuid();
    const { salt, hash } = hashPassword(password);

    let created: UserRow | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const publicId = generateAccountPublicId();
      try {
        const rows = (await sql`
          INSERT INTO users (
            id, public_id, provider, contact_key, contact_display, password_salt, password_hash, child_name, avatar_id
          )
          VALUES (
            ${id}, ${publicId}, 'password', ${contactKey}, ${contactDisplay}, ${salt}, ${hash}, ${childName}, ${avatarId}
          )
          RETURNING *
        `) as UserRow[];
        created = rows[0];
        break;
      } catch (err) {
        if (isUniqueViolationError(err, 'public_id') && attempt < 4) {
          continue;
        }
        throw err;
      }
    }

    if (!created) {
      return jsonResponse({ ok: false, errorUz: 'Hisobni saqlashda xatolik yuz berdi.' }, 500);
    }

    return jsonResponse(
      {
        ok: true,
        session: userRowToSession(created),
        profile: { name: created.child_name, avatarId: created.avatar_id },
        isNewSignup: true,
      },
      201,
      { 'Set-Cookie': createSessionCookie(created.id, request) },
    );
  } catch (err) {
    console.error('Register error:', err);
    return jsonResponse(
      { ok: false, errorUz: 'Serverda xatolik yuz berdi. Keyinroq urinib ko‘ring.' },
      500,
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const action = (new URL(request.url).searchParams.get('action') || 'me').trim().toLowerCase();

  if (action === 'me') {
    return handleMe(request);
  }
  if (action === 'providers') {
    return handleProviders(request);
  }

  return jsonResponse(
    { ok: false, code: 'invalid_action', errorUz: "Noto'g'ri action parametri." },
    400,
  );
}

export async function POST(request: Request): Promise<Response> {
  const action = (new URL(request.url).searchParams.get('action') || '').trim().toLowerCase();

  if (action === 'login') {
    return handleLogin(request);
  }
  if (action === 'register') {
    return handleRegister(request);
  }
  if (action === 'logout') {
    return handleLogout(request);
  }

  return jsonResponse(
    { ok: false, code: 'invalid_action', errorUz: "Noto'g'ri action parametri." },
    400,
  );
}

export async function DELETE(request: Request): Promise<Response> {
  return handleLogout(request);
}
