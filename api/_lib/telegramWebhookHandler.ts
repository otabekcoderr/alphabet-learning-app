import { randomUUID, timingSafeEqual } from 'node:crypto';
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
  consumeTelegramLinkSessionOnWebhook,
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

export function buildReminderConfirmationTextUz(childName?: string | null): string {
  const child = (childName || '').trim();
  const statusLine = child
    ? `<b>${escapeHtml(child)}</b> uchun kunlik mashq bildirishnomalari muvaffaqiyatli yoqildi!`
    : 'Kunlik mashq bildirishnomalari muvaffaqiyatli yoqildi!';
  return (
    `✅ <b>@alifbo_uz_robot</b> ulandi — ${statusLine}\n\n` +
    '⏰ Har kuni Toshkent vaqti bilan soat <b>19:00</b> da (agar o‘sha kuni mashq qilinmagan bo‘lsa) eslatma yuboraman.\n\n' +
    'Boshqarish: /eslatma · O‘chirish: /eslatma_off'
  );
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

  const keyboard: TelegramInlineButton[][] = [
    [{ text: '🔕 Eslatmani o‘chirish', callback_data: 'rem_off' }],
  ];
  if (isPublicHttpsOrigin(appOrigin)) {
    keyboard.unshift([{ text: '🌐 Alifbo saytiga qaytish', url: appOrigin }]);
  }

  await sendTelegramMessage(
    botToken,
    chatId,
    '✅ Kirish tasdiqlandi! Endi saytga qaytishingiz mumkin.\n\n⏰ Eslatma: Har kuni Toshkent vaqti bilan soat <b>19:00</b> da (agar o‘sha kuni mashq qilinmagan bo‘lsa) kunlik mashq eslatmasi yuboriladi.',
    keyboard,
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

async function syncPrivateTelegramChatId(tgUser: TelegramUser, chatId: number): Promise<void> {
  if (tgUser.is_bot || !isDbConfigured()) return;
  try {
    await ensureSchema();
    const sql = getSql();
    const tgId = String(tgUser.id);
    const username = (tgUser.username || '').trim().replace(/^@+/, '') || null;
    await sql`
      UPDATE users
      SET
        telegram_chat_id = ${String(chatId)},
        telegram_username = COALESCE(${username}, telegram_username),
        tg_bot_blocked = FALSE,
        updated_at = NOW()
      WHERE telegram_id = ${tgId}
    `;
  } catch {
    // Best-effort sync
  }
}

async function handleDeepLinkReminderConnect(
  botToken: string,
  chatId: number,
  tgUser: TelegramUser,
  linkToken: string,
  appOrigin: string,
): Promise<void> {
  if (tgUser.is_bot) return;

  if (!isDbConfigured() || !isTelegramAuthStoreConfigured()) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Uzr, tizim bazasi hali sozlanmagan. Keyinroq urinib ko‘ring.',
    );
    return;
  }

  if (!verifyTelegramLoginToken(linkToken, botToken)) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Ulanish havolasi noto‘g‘ri yoki eskirgan. Saytdagi «Ota-ona → Bildirishnomalar» bo‘limidan yangi havola oling.',
    );
    return;
  }

  const tokenHash = hashTelegramLoginToken(linkToken, botToken);
  const consumed = await consumeTelegramLinkSessionOnWebhook({ tokenHash });
  if (!consumed.ok) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Havolaning amal qilish muddati tugagan yoki u allaqachon ishlatilgan. Saytdan qaytadan urinib ko‘ring.',
    );
    return;
  }

  await ensureSchema();
  const sql = getSql();
  const tgId = String(tgUser.id);
  const chatIdStr = String(chatId);
  const username = (tgUser.username || '').trim().replace(/^@+/, '') || null;

  const conflictRows = (await sql`
    SELECT id FROM users
    WHERE telegram_id = ${tgId} AND id <> ${consumed.userId}
    LIMIT 1
  `) as Array<{ id: string }>;

  if (conflictRows[0]) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Bu Telegram profili allaqachon boshqa Alifbo hisobiga ulangan. O‘sha hisobga Telegram orqali kirishingiz mumkin.',
    );
    return;
  }

  const updated = (await sql`
    UPDATE users
    SET
      telegram_id = COALESCE(telegram_id, ${tgId}),
      telegram_chat_id = ${chatIdStr},
      telegram_username = COALESCE(${username}, telegram_username),
      tg_reminder_enabled = TRUE,
      tg_bot_blocked = FALSE,
      consecutive_missed_reminders = 0,
      updated_at = NOW()
    WHERE id = ${consumed.userId}
    RETURNING *
  `) as UserRow[];

  if (!updated[0]) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Hisob topilmadi. Iltimos, saytga qaytib qaytadan kiring.',
    );
    return;
  }

  await sql`
    INSERT INTO parent_notifications (id, user_id, kind, title_uz, body_uz)
    VALUES (
      ${`notif_${randomUUID()}`},
      ${consumed.userId},
      'telegram_linked',
      'Telegram eslatmalari ulandi',
      '@alifbo_uz_robot orqali kunlik mashq eslatmalari faollashtirildi.'
    )
  `;

  const keyboard: TelegramInlineButton[][] = [
    [{ text: '🔕 Eslatmani o‘chirish', callback_data: 'rem_off' }],
  ];
  if (isPublicHttpsOrigin(appOrigin)) {
    keyboard.unshift([{ text: '🌐 Alifbo saytiga qaytish', url: appOrigin }]);
  }

  await sendTelegramMessage(
    botToken,
    chatId,
    buildReminderConfirmationTextUz(updated[0].child_name),
    keyboard,
  );
}

function buildReminderControlKeyboard(enabled: boolean): TelegramInlineButton[][] {
  return [
    [
      enabled
        ? { text: '🔕 Eslatmani o‘chirish', callback_data: 'rem_off' }
        : { text: '🔔 Eslatmani yoqish', callback_data: 'rem_on' },
    ],
  ];
}

async function handleReminderCommandOrAction(
  botToken: string,
  chatId: number,
  tgUser: TelegramUser,
  action: 'status' | 'on' | 'off' | 'hour',
  _hourValue?: number,
): Promise<void> {
  if (tgUser.is_bot) return;
  if (!isDbConfigured()) {
    await sendTelegramMessage(botToken, chatId, "Ma'lumotlar bazasi hali ulanmagan.");
    return;
  }

  await ensureSchema();
  const sql = getSql();
  const tgId = String(tgUser.id);
  const chatIdStr = String(chatId);

  const existing = (await sql`
    SELECT * FROM users
    WHERE telegram_id = ${tgId} OR telegram_chat_id = ${chatIdStr}
    LIMIT 1
  `) as UserRow[];

  const user = existing[0];
  if (!user) {
    await sendTelegramMessage(
      botToken,
      chatId,
      'Sizda hali Alifbo hisobi ulanmagan. Avval saytda «Telegram orqali kirish» yoki «Bildirishnomalar → @alifbo_uz_robot ni ulash» tugmasini bosing.',
    );
    return;
  }

  const nextEnabled = Boolean(user.tg_reminder_enabled);

  if (action === 'off') {
    await sql`
      UPDATE users
      SET tg_reminder_enabled = FALSE, telegram_chat_id = ${chatIdStr}, updated_at = NOW()
      WHERE id = ${user.id}
    `;
    await sendTelegramMessage(
      botToken,
      chatId,
      '🔕 Kunlik mashq eslatmasi o‘chirildi. Istalgan payt /eslatma_on orqali qayta yoqishingiz mumkin.',
      [[{ text: '🔔 Qayta yoqish', callback_data: 'rem_on' }]],
    );
    return;
  }

  if (action === 'on') {
    await sql`
      UPDATE users
      SET
        tg_reminder_enabled = TRUE,
        tg_bot_blocked = FALSE,
        telegram_chat_id = ${chatIdStr},
        consecutive_missed_reminders = 0,
        updated_at = NOW()
      WHERE id = ${user.id}
    `;
    await sendTelegramMessage(
      botToken,
      chatId,
      '🔔 Kunlik mashq eslatmasi yoqildi!\n\n⏰ Har kuni Toshkent vaqti bilan soat <b>19:00</b> da (agar o‘sha kuni mashq qilinmagan bo‘lsa) eslatma yuboraman.',
      buildReminderControlKeyboard(true),
    );
    return;
  }

  if (action === 'hour') {
    await sendTelegramMessage(
      botToken,
      chatId,
      '⏰ Kunlik mashq eslatmalari har kuni Toshkent vaqti bilan soat <b>19:00</b> da (agar o‘sha kuni mashq qilinmagan bo‘lsa) yuboriladi.',
      buildReminderControlKeyboard(nextEnabled),
    );
    return;
  }

  const statusText = nextEnabled ? '🔔 Yoqilgan' : '🔕 O‘chirilgan';
  await sendTelegramMessage(
    botToken,
    chatId,
    `<b>Kunlik mashq eslatmasi</b>\nBola: <b>${escapeHtml(user.child_name)}</b>\nHolat: ${statusText}\n⏰ Vaqti: har kuni soat <b>19:00</b> (Toshkent vaqti, o‘sha kuni mashq qilinmagan bo‘lsa)\n\nQuyidan boshqarishingiz mumkin:`,
    buildReminderControlKeyboard(nextEnabled),
  );
}

async function handlePlainStartCommand(
  botToken: string,
  chatId: number,
  tgUser: TelegramUser,
  appOrigin: string,
): Promise<void> {
  if (tgUser.is_bot) return;
  if (isDbConfigured()) {
    await ensureSchema();
    const sql = getSql();
    const tgId = String(tgUser.id);
    const chatIdStr = String(chatId);
    const linked = (await sql`
      SELECT id, child_name FROM users
      WHERE telegram_id = ${tgId} OR telegram_chat_id = ${chatIdStr}
      LIMIT 1
    `) as Array<{ id: string; child_name: string }>;
    if (linked[0]) {
      await sql`
        UPDATE users
        SET
          tg_reminder_enabled = TRUE,
          tg_bot_blocked = FALSE,
          telegram_chat_id = ${chatIdStr},
          consecutive_missed_reminders = 0,
          updated_at = NOW()
        WHERE id = ${linked[0].id}
      `;
      const keyboard: TelegramInlineButton[][] = [
        [{ text: '🔕 Eslatmani o‘chirish', callback_data: 'rem_off' }],
      ];
      if (isPublicHttpsOrigin(appOrigin)) {
        keyboard.unshift([{ text: '🌐 Alifbo saytiga qaytish', url: appOrigin }]);
      }
      await sendTelegramMessage(
        botToken,
        chatId,
        buildReminderConfirmationTextUz(linked[0].child_name),
        keyboard,
      );
      return;
    }
  }
  await issueCodeForUser(botToken, chatId, tgUser, appOrigin);
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
      const cbChatId = cb.message?.chat?.id;
      if (cbChatId !== undefined) {
        if (cb.data === 'new_code') {
          await issueCodeForUser(botToken, cbChatId, cb.from, appOrigin);
        } else if (cb.data === 'rem_off') {
          await handleReminderCommandOrAction(botToken, cbChatId, cb.from, 'off');
        } else if (cb.data === 'rem_on') {
          await handleReminderCommandOrAction(botToken, cbChatId, cb.from, 'on');
        } else if (cb.data && /^rem_hr_(18|19|20|21)$/.test(cb.data)) {
          const hourVal = Number(cb.data.slice(-2));
          await handleReminderCommandOrAction(botToken, cbChatId, cb.from, 'hour', hourVal);
        }
      }
      return jsonResponse({ ok: true });
    }

    const msg = update.message;
    if (msg?.from && msg.chat && typeof msg.text === 'string') {
      if (msg.chat.type === 'private' || msg.chat.id > 0) {
        await syncPrivateTelegramChatId(msg.from, msg.chat.id);
      }
      const { command, arg } = parseCommandAndArg(msg.text);
      if (command === '/start' && arg.startsWith('auth_')) {
        const loginToken = arg.slice(5).trim();
        await handleDeepLinkLogin(botToken, msg.chat.id, msg.from, loginToken, appOrigin);
      } else if (command === '/start' && arg.startsWith('link_')) {
        const linkToken = arg.slice(5).trim();
        await handleDeepLinkReminderConnect(botToken, msg.chat.id, msg.from, linkToken, appOrigin);
      } else if (command === '/start') {
        await handlePlainStartCommand(botToken, msg.chat.id, msg.from, appOrigin);
      } else if (
        command === '/kod' ||
        command === '/code' ||
        command === '/login'
      ) {
        await issueCodeForUser(botToken, msg.chat.id, msg.from, appOrigin);
      } else if (command === '/id') {
        await handleIdCommand(botToken, msg.chat.id, msg.from);
      } else if (command === '/eslatma') {
        await handleReminderCommandOrAction(botToken, msg.chat.id, msg.from, 'status');
      } else if (command === '/eslatma_on') {
        await handleReminderCommandOrAction(botToken, msg.chat.id, msg.from, 'on');
      } else if (command === '/eslatma_off') {
        await handleReminderCommandOrAction(botToken, msg.chat.id, msg.from, 'off');
      } else {
        await sendTelegramMessage(
          botToken,
          msg.chat.id,
          'Alifbo boti buyruqlari:\n• Saytdagi «Telegram orqali kirish» tugmasini bosing\n• /kod — bir martalik 6 xonali kod olish\n• /id — Alifbo hisob ID raqamini ko‘rish\n• /eslatma — kunlik mashq eslatmasini sozlash',
        );
      }
    }
  } catch (err) {
    console.error('Telegram webhook processing failed:', err instanceof Error ? err.message : 'err');
  }

  return jsonResponse({ ok: true });
}
