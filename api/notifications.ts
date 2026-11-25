import { timingSafeEqual } from 'node:crypto';
import { ensureSchema, getSql, isDbConfigured, type UserRow } from './_lib/db.js';
import { dbUnavailableResponse, getSessionUserId, jsonResponse } from './_lib/session.js';
import {
  createPendingTelegramLinkSession,
  isTelegramAuthStoreConfigured,
} from './_lib/telegramAuthStore.js';
import {
  createTelegramLoginToken,
  ensureTelegramWebhookRegistered,
  getTashkentDateString,
  getTashkentHour,
  hashTelegramLoginToken,
  isPublicHttpsOrigin,
  resolvePublicAppOrigin,
  resolveTelegramBotUsername,
  sendTelegramMessageDetailed,
  TELEGRAM_LOGIN_TOKEN_TTL_SEC,
  type TelegramInlineButton,
} from './_lib/telegramBot.js';

interface ParentNotificationRow {
  id: string;
  user_id: string;
  kind: string;
  title_uz: string;
  body_uz: string;
  read_at: string | Date | null;
  created_at: string | Date;
}

interface ReminderCandidateRow {
  id: string;
  telegram_chat_id: string | null;
  child_name: string;
  current_streak_days: number;
  mastered_words_count: number;
  consecutive_missed_reminders: number;
  last_reminded_date: string | null;
}

const ADMIN_ALERT_WINDOW_MS = 10 * 60 * 1000;
const ADMIN_ALERT_MAX_PER_IP = 10;
const adminAlertRateBuckets = new Map<string, number[]>();

export function resetAdminAlertRateLimiter(): void {
  adminAlertRateBuckets.clear();
}

function isAdminAlertRateLimited(ipKey: string, nowMs: number = Date.now()): boolean {
  const existing = adminAlertRateBuckets.get(ipKey) ?? [];
  const recent = existing.filter((ts) => nowMs - ts < ADMIN_ALERT_WINDOW_MS);
  if (recent.length >= ADMIN_ALERT_MAX_PER_IP) {
    adminAlertRateBuckets.set(ipKey, recent);
    return true;
  }
  recent.push(nowMs);
  adminAlertRateBuckets.set(ipKey, recent);
  return false;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function clampReminderHour(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 19;
  return Math.min(23, Math.max(6, Math.round(raw)));
}

function resolveAction(request: Request): string {
  const url = new URL(request.url);
  const queryAction = (url.searchParams.get('action') || '').trim().toLowerCase();
  if (queryAction) return queryAction;
  if (url.pathname.endsWith('/daily-reminder')) return 'cron-daily-reminder';
  if (url.pathname.endsWith('/settings')) return 'settings';
  if (url.pathname.endsWith('/telegram-link')) return 'telegram-link';
  if (url.pathname.endsWith('/telegram-unlink')) return 'telegram-unlink';
  if (url.pathname.endsWith('/admin-alert')) return 'admin-alert';
  return 'list';
}

function isValidCronAuthorization(request: Request): {
  configured: boolean;
  authorized: boolean;
} {
  const cronSecret = process.env.CRON_SECRET?.trim() || '';
  if (!cronSecret) {
    return { configured: false, authorized: false };
  }
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!bearer) {
    return { configured: true, authorized: false };
  }
  const expectedBuf = Buffer.from(cronSecret, 'utf8');
  const providedBuf = Buffer.from(bearer, 'utf8');
  const authorized =
    expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
  return { configured: true, authorized };
}

async function handleList(request: Request): Promise<Response> {
  if (!isDbConfigured()) {
    return jsonResponse({
      ok: true,
      dbConfigured: false,
      notifications: [],
      settings: null,
    });
  }

  const userId = getSessionUserId(request);
  if (!userId) {
    return jsonResponse({ ok: false, errorUz: 'Avval tizimga kiring.' }, 401);
  }

  try {
    await ensureSchema();
    const sql = getSql();
    const userRows = (await sql`
      SELECT * FROM users WHERE id = ${userId} LIMIT 1
    `) as UserRow[];
    const user = userRows[0];
    if (!user) {
      return jsonResponse({ ok: false, errorUz: 'Foydalanuvchi topilmadi.' }, 401);
    }

    const notifRows = (await sql`
      SELECT id, user_id, kind, title_uz, body_uz, read_at, created_at
      FROM parent_notifications
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 20
    `) as ParentNotificationRow[];

    const telegramLinked = Boolean(user.telegram_chat_id || user.telegram_id);
    return jsonResponse({
      ok: true,
      dbConfigured: true,
      notifications: notifRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        titleUz: row.title_uz,
        bodyUz: row.body_uz,
        readAt:
          row.read_at instanceof Date
            ? row.read_at.toISOString()
            : row.read_at
              ? String(row.read_at)
              : null,
        createdAt:
          row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      })),
      settings: {
        telegramLinked,
        telegramUsername: user.telegram_username ? `@${user.telegram_username}` : null,
        reminderEnabled: Boolean(user.tg_reminder_enabled),
        reminderHour: Number.isFinite(user.tg_reminder_hour) ? user.tg_reminder_hour : 19,
        botBlocked: Boolean(user.tg_bot_blocked),
        botUsername: resolveTelegramBotUsername(),
      },
    });
  } catch (err) {
    console.error('Notifications list error:', err instanceof Error ? err.message : 'err');
    return jsonResponse({ ok: false, errorUz: "Bildirishnomalarni o'qishda xatolik." }, 500);
  }
}

async function handleSettings(request: Request): Promise<Response> {
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

  try {
    await ensureSchema();
    const sql = getSql();

    const hasReminderEnabled = typeof body.reminderEnabled === 'boolean';
    const hasReminderHour = typeof body.reminderHour === 'number';
    const nextEnabled = hasReminderEnabled ? (body.reminderEnabled as boolean) : null;
    const nextHour = hasReminderHour ? clampReminderHour(body.reminderHour) : null;

    const updatedUsers = (await sql`
      UPDATE users
      SET
        tg_reminder_enabled = COALESCE(${nextEnabled}, tg_reminder_enabled),
        tg_reminder_hour = COALESCE(${nextHour}, tg_reminder_hour),
        consecutive_missed_reminders = CASE
          WHEN ${nextEnabled === true} THEN 0
          ELSE consecutive_missed_reminders
        END,
        updated_at = NOW()
      WHERE id = ${userId}
      RETURNING *
    `) as UserRow[];

    const user = updatedUsers[0];
    if (!user) {
      return jsonResponse({ ok: false, errorUz: 'Foydalanuvchi topilmadi.' }, 404);
    }

    if (body.markAllRead === true) {
      await sql`
        UPDATE parent_notifications
        SET read_at = COALESCE(read_at, NOW())
        WHERE user_id = ${userId} AND read_at IS NULL
      `;
    } else if (Array.isArray(body.markReadIds)) {
      const ids = body.markReadIds
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, 50);
      if (ids.length > 0) {
        await sql`
          UPDATE parent_notifications
          SET read_at = COALESCE(read_at, NOW())
          WHERE user_id = ${userId}
            AND id = ANY(${ids}::text[])
            AND read_at IS NULL
        `;
      }
    }

    return jsonResponse({
      ok: true,
      settings: {
        telegramLinked: Boolean(user.telegram_chat_id || user.telegram_id),
        telegramUsername: user.telegram_username ? `@${user.telegram_username}` : null,
        reminderEnabled: Boolean(user.tg_reminder_enabled),
        reminderHour: Number.isFinite(user.tg_reminder_hour) ? user.tg_reminder_hour : 19,
        botBlocked: Boolean(user.tg_bot_blocked),
        botUsername: resolveTelegramBotUsername(),
      },
    });
  } catch (err) {
    console.error('Notifications settings error:', err instanceof Error ? err.message : 'err');
    return jsonResponse({ ok: false, errorUz: 'Sozlamalarni saqlashda xatolik.' }, 500);
  }
}

async function handleTelegramLink(request: Request): Promise<Response> {
  if (!isDbConfigured()) {
    return dbUnavailableResponse();
  }

  const userId = getSessionUserId(request);
  if (!userId) {
    return jsonResponse({ ok: false, errorUz: 'Avval tizimga kiring.' }, 401);
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  if (!botToken) {
    return jsonResponse(
      {
        ok: false,
        code: 'telegram_not_configured',
        errorUz: 'Telegram bot hali sozlanmagan (TELEGRAM_BOT_TOKEN kerak).',
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

  const origin = resolvePublicAppOrigin(request);
  try {
    await Promise.race([
      ensureTelegramWebhookRegistered(botToken, origin),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // Best-effort webhook check
  }

  try {
    const linkToken = createTelegramLoginToken(botToken);
    const tokenHash = hashTelegramLoginToken(linkToken, botToken);
    const botUsername = resolveTelegramBotUsername();

    const { expiresAt } = await createPendingTelegramLinkSession({
      tokenHash,
      userId,
      ttlSec: TELEGRAM_LOGIN_TOKEN_TTL_SEC,
    });

    const deepLink = `https://t.me/${encodeURIComponent(botUsername)}?start=link_${encodeURIComponent(linkToken)}`;
    return jsonResponse({
      ok: true,
      deepLink,
      botUsername,
      expiresAt,
    });
  } catch (err) {
    console.error('Telegram link create error:', err instanceof Error ? err.message : 'err');
    return jsonResponse(
      { ok: false, errorUz: 'Telegram ulash havolasini yaratishda xatolik yuz berdi.' },
      500,
    );
  }
}

async function handleTelegramUnlink(request: Request): Promise<Response> {
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
    await sql`
      UPDATE users
      SET
        tg_reminder_enabled = FALSE,
        telegram_chat_id = CASE WHEN provider = 'telegram' THEN telegram_chat_id ELSE NULL END,
        telegram_id = CASE WHEN provider = 'telegram' THEN telegram_id ELSE NULL END,
        updated_at = NOW()
      WHERE id = ${userId}
    `;

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('Telegram unlink error:', err instanceof Error ? err.message : 'err');
    return jsonResponse({ ok: false, errorUz: 'Ulanishni uzishda xatolik yuz berdi.' }, 500);
  }
}

async function handleAdminAlert(request: Request): Promise<Response> {
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown';

  if (isAdminAlertRateLimited(clientIp)) {
    return jsonResponse(
      { ok: false, code: 'rate_limited', errorUz: "Juda ko'p so'rov yuborildi. Biroz kuting." },
      429,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, errorUz: "Noto'g'ri JSON formati." }, 400);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 5 || text.length > 2500) {
    return jsonResponse({ ok: false, errorUz: 'Xabar matni noto‘g‘ri.' }, 400);
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  const adminChatId =
    process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() || process.env.TELEGRAM_CHAT_ID?.trim() || '';

  if (!botToken || !adminChatId) {
    return jsonResponse(
      {
        ok: false,
        code: 'admin_tg_not_configured',
        errorUz: 'Admin Telegram kanali hali sozlanmagan.',
      },
      503,
    );
  }

  try {
    const safeTokenPath = botToken.split(':').map(encodeURIComponent).join(':');
    const resp = await fetch(`https://api.telegram.org/bot${safeTokenPath}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminChatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!resp.ok) {
      return jsonResponse(
        { ok: false, code: 'upstream_error', errorUz: 'Telegramga yuborishda xatolik.' },
        502,
      );
    }

    const respJson = (await resp.json().catch(() => null)) as { ok?: boolean } | null;
    if (respJson && respJson.ok === false) {
      return jsonResponse(
        { ok: false, code: 'upstream_error', errorUz: 'Telegram xabarni rad etdi.' },
        502,
      );
    }

    return jsonResponse({ ok: true });
  } catch {
    return jsonResponse(
      { ok: false, code: 'network_error', errorUz: 'Telegram serveri bilan bog‘lanib bo‘lmadi.' },
      502,
    );
  }
}

export async function handleCronDailyReminder(request: Request): Promise<Response> {
  const auth = isValidCronAuthorization(request);
  if (!auth.configured) {
    return jsonResponse(
      { ok: false, code: 'cron_secret_not_configured', errorUz: 'CRON_SECRET sozlanmagan.' },
      503,
    );
  }
  if (!auth.authorized) {
    return jsonResponse({ ok: false, errorUz: 'Ruxsat etilmagan so‘rov.' }, 401);
  }

  if (!isDbConfigured()) {
    return dbUnavailableResponse();
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  if (!botToken) {
    return jsonResponse(
      { ok: false, code: 'telegram_not_configured', errorUz: 'TELEGRAM_BOT_TOKEN sozlanmagan.' },
      503,
    );
  }

  const url = new URL(request.url);
  const respectHour = url.searchParams.get('respectHour') === '1';
  const todayUz = getTashkentDateString();
  const hourUz = getTashkentHour();
  const appOrigin = resolvePublicAppOrigin(request);
  const hasPublicUrl = isPublicHttpsOrigin(appOrigin);

  try {
    await ensureSchema();
    const sql = getSql();

    const candidates = (
      respectHour
        ? await sql`
            SELECT id, telegram_chat_id, child_name, current_streak_days, mastered_words_count, consecutive_missed_reminders, last_reminded_date
            FROM users
            WHERE tg_reminder_enabled = TRUE
              AND tg_bot_blocked = FALSE
              AND telegram_chat_id IS NOT NULL
              AND tg_reminder_hour = ${hourUz}
              AND (last_practice_date IS NULL OR last_practice_date < ${todayUz})
              AND (last_reminded_date IS NULL OR last_reminded_date < ${todayUz})
            LIMIT 500
          `
        : await sql`
            SELECT id, telegram_chat_id, child_name, current_streak_days, mastered_words_count, consecutive_missed_reminders, last_reminded_date
            FROM users
            WHERE tg_reminder_enabled = TRUE
              AND tg_bot_blocked = FALSE
              AND telegram_chat_id IS NOT NULL
              AND (last_practice_date IS NULL OR last_practice_date < ${todayUz})
              AND (last_reminded_date IS NULL OR last_reminded_date < ${todayUz})
            LIMIT 500
          `
    ) as ReminderCandidateRow[];

    let sent = 0;
    let paused = 0;
    let blocked = 0;
    let failed = 0;

    const BATCH_SIZE = 20;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (user) => {
          if (!user.telegram_chat_id) return;

          const claimed = (await sql`
            UPDATE users
            SET
              last_reminded_date = ${todayUz},
              consecutive_missed_reminders = consecutive_missed_reminders + 1,
              updated_at = NOW()
            WHERE id = ${user.id}
              AND (last_reminded_date IS NULL OR last_reminded_date < ${todayUz})
            RETURNING consecutive_missed_reminders
          `) as Array<{ consecutive_missed_reminders: number }>;

          if (!claimed[0]) return;

          const missedCount = claimed[0].consecutive_missed_reminders;
          const childLabel = escapeHtml((user.child_name || 'Bolajon').trim());

          if (missedCount >= 5) {
            await sql`
              UPDATE users
              SET tg_reminder_enabled = FALSE, updated_at = NOW()
              WHERE id = ${user.id}
            `;
            const pauseKeyboard: TelegramInlineButton[][] = [
              [{ text: '🔔 Eslatmani qayta yoqish', callback_data: 'rem_on' }],
            ];
            if (hasPublicUrl) {
              pauseKeyboard.unshift([{ text: '▶️ Mashqni boshlash', url: appOrigin }]);
            }
            const pauseRes = await sendTelegramMessageDetailed(
              botToken,
              user.telegram_chat_id,
              `🦊 Assalomu alaykum! Sizni bezovta qilmaslik uchun <b>${childLabel}</b> uchun kunlik eslatmalarni vaqtincha to‘xtatib turdik.\n\nIstalgan payt quyidagi tugma orqali yana yoqishingiz mumkin:`,
              pauseKeyboard,
            );
            if (pauseRes.blockedByUser) {
              await sql`
                UPDATE users
                SET tg_bot_blocked = TRUE, tg_reminder_enabled = FALSE, updated_at = NOW()
                WHERE id = ${user.id}
              `;
              blocked++;
            } else if (pauseRes.ok) {
              paused++;
            } else {
              await sql`
                UPDATE users
                SET
                  tg_reminder_enabled = TRUE,
                  last_reminded_date = ${user.last_reminded_date},
                  consecutive_missed_reminders = ${user.consecutive_missed_reminders},
                  updated_at = NOW()
                WHERE id = ${user.id}
              `;
              failed++;
            }
            return;
          }

          const streakLine =
            user.current_streak_days >= 2
              ? `\n🔥 Hozirgi faol seriya: <b>${user.current_streak_days} kun</b> — uni saqlab qolaylik!`
              : '';
          const masteryLine =
            user.mastered_words_count > 0
              ? `\n⭐ Mustaqil o‘qilgan so‘zlar: <b>${user.mastered_words_count} ta</b>`
              : '';

          const text = [
            `🦊 Assalomu alaykum! Bugun <b>${childLabel}</b> bilan 10 daqiqa o‘qish mashqini bajaramizmi?`,
            streakLine,
            masteryLine,
            '',
            'Zukko tulki yangi harf va so‘zlar bilan kutmoqda!',
          ]
            .filter((line, idx, arr) => line !== '' || (idx > 0 && arr[idx - 1] !== ''))
            .join('\n');

          const keyboard: TelegramInlineButton[][] = [
            [{ text: '🔕 Eslatmani o‘chirish', callback_data: 'rem_off' }],
          ];
          if (hasPublicUrl) {
            keyboard.unshift([{ text: '▶️ Mashqni boshlash', url: appOrigin }]);
          }

          const sendRes = await sendTelegramMessageDetailed(
            botToken,
            user.telegram_chat_id,
            text,
            keyboard,
          );

          if (sendRes.blockedByUser) {
            await sql`
              UPDATE users
              SET tg_bot_blocked = TRUE, tg_reminder_enabled = FALSE, updated_at = NOW()
              WHERE id = ${user.id}
            `;
            blocked++;
          } else if (sendRes.ok) {
            sent++;
          } else {
            await sql`
              UPDATE users
              SET
                last_reminded_date = ${user.last_reminded_date},
                consecutive_missed_reminders = ${user.consecutive_missed_reminders},
                updated_at = NOW()
              WHERE id = ${user.id}
            `;
            failed++;
          }
        }),
      );
    }

    return jsonResponse({
      ok: true,
      todayUz,
      hourUz,
      scanned: candidates.length,
      sent,
      paused,
      blocked,
      failed,
    });
  } catch (err) {
    console.error('Cron daily reminder error:', err instanceof Error ? err.message : 'err');
    return jsonResponse({ ok: false, errorUz: 'Kunlik eslatma yuborishda xatolik.' }, 500);
  }
}

export async function GET(request: Request): Promise<Response> {
  const action = resolveAction(request);
  if (action === 'list') {
    return handleList(request);
  }
  if (action === 'cron-daily-reminder') {
    return handleCronDailyReminder(request);
  }
  return jsonResponse({ ok: false, code: 'invalid_action', errorUz: "Noto'g'ri action parametri." }, 400);
}

export async function POST(request: Request): Promise<Response> {
  const action = resolveAction(request);
  if (action === 'settings') {
    return handleSettings(request);
  }
  if (action === 'telegram-link') {
    return handleTelegramLink(request);
  }
  if (action === 'telegram-unlink') {
    return handleTelegramUnlink(request);
  }
  if (action === 'admin-alert') {
    return handleAdminAlert(request);
  }
  if (action === 'cron-daily-reminder') {
    return handleCronDailyReminder(request);
  }
  return jsonResponse({ ok: false, code: 'invalid_action', errorUz: "Noto'g'ri action parametri." }, 400);
}
