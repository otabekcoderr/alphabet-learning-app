import { jsonResponse } from './_lib/session.js';
import {
  ensureTelegramWebhookRegistered,
  resolvePublicAppOrigin,
  sanitizeBotUsername,
} from './_lib/telegramBot.js';

export { handleTelegramWebhook as POST } from './_lib/telegramWebhookHandler.js';

export async function GET(request: Request): Promise<Response> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  if (!botToken) {
    return jsonResponse(
      { ok: false, errorUz: 'TELEGRAM_BOT_TOKEN sozlanmagan.' },
      503,
    );
  }

  const botUsername = sanitizeBotUsername(
    process.env.TELEGRAM_BOT_USERNAME || process.env.VITE_TELEGRAM_BOT_USERNAME,
  );
  const appOrigin = resolvePublicAppOrigin(request);
  const res = await ensureTelegramWebhookRegistered(botToken, appOrigin, true);

  return jsonResponse(
    {
      ok: res.ok,
      botUsername: botUsername || null,
      webhookUrl: res.webhookUrl,
      updated: res.updated,
      reason: res.reason ?? null,
    },
    res.ok ? 200 : 400,
  );
}
