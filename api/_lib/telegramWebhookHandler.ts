import { timingSafeEqual } from 'node:crypto';
import { formatAccountPublicId } from './crypto.js';
import {
  ensureSchema,
  ensureUserPublicId,
  getSql,
  isDbConfigured,
  isUniqueViolationError,
  type UserRow,
} from './db.js';
import { jsonResponse } from './session.js';
import {
  approveTelegramLoginSession,
  isTelegramAuthStoreConfigured,
} from './telegramAuthStore.js';
import {
  answerTelegramCallbackQuery,
  deriveTelegramWebhookSecret,
  generateSixDigitCode,
  hashTelegramAuthCode,
  hashTelegramLoginToken,
  isPublicHttpsOrigin,
  resolvePublicAppOrigin,
  sendTelegramMessage,
  verifyTelegramLoginToken,
  type TelegramInlineButton,
} from './telegramBot.js';

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseCommandAndArg(text: string): { command: string; arg: string } {
  const trimmed = text.trim();
  const match = /^(\/[a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]+))?$/.exec(trimmed);
  if (!match) return { command: '', arg: '' };
  return {
    command: (match[1] ?? '').toLowerCase(),
    arg: (match[2] ?? '').trim(),
  };
}

async function handleDeepLinkLogin(
  botToken: string,
  chatId: number,
  tgUser: TelegramUser,
  loginToken: string,
  appOrigin: string,
): Promise<void> {
  if (tgUser.is_bot) return;

  if (!isTelegramAuthStoreConfigured()) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Uzr, tizimda tasdiqlash xotirasi hali sozlanmagan. Keyinroq urinib ko‘ring.',
    );
    return;
  }

  if (!verifyTelegramLoginToken(loginToken, botToken)) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Havola noto‘g‘ri yoki eskirgan. Iltimos, saytdagi «Telegram orqali kirish» tugmasini qaytadan bosing.',
    );
    return;
  }

  const tokenHash = hashTelegramLoginToken(loginToken, botToken);
  const firstName = (tgUser.first_name || '').trim();
  const lastName = (tgUser.last_name || '').trim();
  const username = (tgUser.username || '').trim().replace(/^@+/, '') || null;

  const approved = await approveTelegramLoginSession({
    tokenHash,
    telegramId: String(tgUser.id),
    telegramUsername: username,
    firstName,
    lastName,
  });

  if (!approved) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Havolaning amal qilish muddati tugagan yoki u allaqachon ishlatilgan. Saytdan «Telegram orqali kirish» tugmasini qaytadan bosing.',
    );
    return;
  }

  const keyboard: TelegramInlineButton[][] = [];
  if (isPublicHttpsOrigin(appOrigin)) {
    keyboard.push([{ text: '🌐 Alifbo saytiga qaytish', url: appOrigin }]);
  }

  await sendTelegramMessage(
    botToken,
    chatId,
    '✅ Kirish tasdiqlandi! Endi saytga qaytishingiz mumkin.',
    keyboard.length > 0 ? keyboard : undefined,
  );
}

async function issueCodeForUser(
  botToken: string,
  chatId: number,
  tgUser: TelegramUser,
  appOrigin: string,
): Promise<void> {
  if (tgUser.is_bot) return;

  if (!isDbConfigured()) {
    await sendTelegramMessage(
      botToken,
      chatId,
      "Uzr, Alifbo ma'lumotlar bazasi hali ulanmagan. Keyinroq urinib ko‘ring.",
    );
    return;
  }

  await ensureSchema();
  const sql = getSql();
  const tgId = String(tgUser.id);

  const countRows = (await sql`
    SELECT COUNT(*)::int AS cnt
    FROM telegram_auth_codes
    WHERE telegram_id = ${tgId}
      AND created_at > NOW() - INTERVAL '10 minutes'
  `) as Array<{ cnt: number }>;

  if ((countRows[0]?.cnt ?? 0) >= 10) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Juda ko‘p kod so‘raldi. Iltimos, bir necha daqiqadan so‘ng qaytadan urinib ko‘ring.',
    );
    return;
  }

  await sql`
    UPDATE telegram_auth_codes
    SET used_at = NOW()
    WHERE telegram_id = ${tgId} AND used_at IS NULL
  `;

  const firstName = (tgUser.first_name || '').trim();
  const lastName = (tgUser.last_name || '').trim();
  const username = (tgUser.username || '').trim().replace(/^@+/, '') || null;

  let issuedCode = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateSixDigitCode();
    const codeHash = hashTelegramAuthCode(candidate, botToken);
    try {
      await sql`
        INSERT INTO telegram_auth_codes (
          code_hash, telegram_id, telegram_username, first_name, last_name, expires_at
        )
        VALUES (
          ${codeHash}, ${tgId}, ${username}, ${firstName}, ${lastName}, NOW() + INTERVAL '5 minutes'
        )
      `;
      issuedCode = candidate;
      break;
    } catch (err) {
      if (isUniqueViolationError(err) && attempt < 4) {
        continue;
      }
      throw err;
    }
  }

  if (!issuedCode) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Tasdiqlash kodi yaratishda xatolik yuz berdi. /kod buyrug‘i bilan qayta urinib ko‘ring.',
    );
    return;
  }

  const existingUsers = (await sql`
    SELECT * FROM users WHERE telegram_id = ${tgId} LIMIT 1
  `) as UserRow[];
  let accountIdLine = '';
  if (existingUsers[0]) {
    const ensured = await ensureUserPublicId(existingUsers[0]);
    if (ensured.public_id) {
      accountIdLine = `\n🆔 Hisob ID: <code>${escapeHtml(formatAccountPublicId(ensured.public_id))}</code>`;
    }
  }

  const greetingName = firstName ? escapeHtml(firstName) : 'do‘stim';
  const msg = [
    `Assalomu alaykum, <b>${greetingName}</b>!`,
    '',
    'Alifbo ilovasiga kirish uchun bir martalik kodingiz:',
    `🔐 <code>${issuedCode}</code>`,
    '',
    'Ushbu 6 xonali kodni saytdagi Telegram maydoniga 5 daqiqa ichida kiriting.',
    accountIdLine,
  ]
    .filter((line, idx, arr) => !(line === '' && idx === arr.length - 1))
    .join('\n');

  const keyboard: TelegramInlineButton[][] = [
    [{ text: '🔄 Yangi kod olish', callback_data: 'new_code' }],
  ];
  if (isPublicHttpsOrigin(appOrigin)) {
    keyboard.push([{ text: '🌐 Alifbo saytiga qaytish', url: appOrigin }]);
  }

  await sendTelegramMessage(botToken, chatId, msg, keyboard);
}

async function handleIdCommand(
  botToken: string,
  chatId: number,
  tgUser: TelegramUser,
): Promise<void> {
  if (!isDbConfigured()) {
    await sendTelegramMessage(
      botToken,
      chatId,
      "Ma'lumotlar bazasi hali ulanmagan.",
    );
    return;
  }

  await ensureSchema();
  const sql = getSql();
  const tgId = String(tgUser.id);
  const rows = (await sql`
    SELECT * FROM users WHERE telegram_id = ${tgId} LIMIT 1
  `) as UserRow[];

  if (!rows[0]) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Sizda hali Alifbo hisobi ulanmagan. Saytdan «Telegram orqali kirish» tugmasini bosing yoki /kod buyrug‘i bilan kiring.',
    );
    return;
  }

  const ensured = await ensureUserPublicId(rows[0]);
  await sendTelegramMessage(
    botToken,
    chatId,
    `Sizning Alifbo hisob ID raqamingiz:\n🆔 <code>${escapeHtml(formatAccountPublicId(ensured.public_id))}</code>`,
  );
}

export async function handleTelegramWebhook(request: Request): Promise<Response> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  if (!botToken) {
    return jsonResponse({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' }, 503);
  }

  const expectedSecret = deriveTelegramWebhookSecret(botToken);
  const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token') || '';
  const expectedBuf = Buffer.from(expectedSecret, 'utf8');
  const receivedBuf = Buffer.from(receivedSecret, 'utf8');
  if (
    expectedBuf.length !== receivedBuf.length ||
    !timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    return jsonResponse({ ok: false }, 403);
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return jsonResponse({ ok: false }, 400);
  }

  const appOrigin = resolvePublicAppOrigin(request);

  try {
    if (update.callback_query) {
      const cb = update.callback_query;
      await answerTelegramCallbackQuery(botToken, cb.id);
      if (cb.data === 'new_code' && cb.message?.chat?.id !== undefined) {
        await issueCodeForUser(botToken, cb.message.chat.id, cb.from, appOrigin);
      }
      return jsonResponse({ ok: true });
    }

    const msg = update.message;
    if (msg?.from && msg.chat && typeof msg.text === 'string') {
      const { command, arg } = parseCommandAndArg(msg.text);
      if (command === '/start' && arg.startsWith('auth_')) {
        const loginToken = arg.slice(5).trim();
        await handleDeepLinkLogin(botToken, msg.chat.id, msg.from, loginToken, appOrigin);
      } else if (
        command === '/start' ||
        command === '/kod' ||
        command === '/code' ||
        command === '/login'
      ) {
        await issueCodeForUser(botToken, msg.chat.id, msg.from, appOrigin);
      } else if (command === '/id') {
        await handleIdCommand(botToken, msg.chat.id, msg.from);
      } else {
        await sendTelegramMessage(
          botToken,
          msg.chat.id,
          'Alifbo boti buyruqlari:\n• Saytdagi «Telegram orqali kirish» tugmasini bosing\n• /kod — bir martalik 6 xonali kod olish\n• /id — Alifbo hisob ID raqamini ko‘rish',
        );
      }
    }
  } catch (err) {
    console.error('Telegram webhook processing failed:', err instanceof Error ? err.message : 'err');
  }

  return jsonResponse({ ok: true });
}
