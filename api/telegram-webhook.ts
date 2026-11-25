import { timingSafeEqual } from 'node:crypto';
import { jsonResponse } from './_lib/session.js';
import {
  deriveTelegramWebhookSecret,
  ensureTelegramWebhookRegistered,
  resolvePublicAppOrigin,
  sanitizeBotUsername,
} from './_lib/telegramBot.js';

export { handleTelegramWebhook as POST } from './_lib/telegramWebhookHandler.js';

function isAuthorizedSetupRequest(request: Request, botToken: string): boolean {
  const configuredSecret =
    process.env.CRON_SECRET?.trim() || process.env.TELEGRAM_SETUP_SECRET?.trim() || '';
  const isHostedVercel = Boolean(process.env.VERCEL);

  if (!configuredSecret && !isHostedVercel) {
    return true;
  }

  const expectedSecret = configuredSecret || deriveTelegramWebhookSecret(botToken);
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerSecret = (request.headers.get('x-setup-secret') || '').trim();
  const provided = bearer || headerSecret;
  if (!provided) return false;

  const expectedBuf = Buffer.from(expectedSecret, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  return (
    expectedBuf.length === providedBuf.length &&
    timingSafeEqual(expectedBuf, providedBuf)
  );
}

export async function GET(request: Request): Promise<Response> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
  if (!botToken) {
    return jsonResponse(
      { ok: false, errorUz: 'TELEGRAM_BOT_TOKEN sozlanmagan.' },
      503,
    );
  }

  if (!isAuthorizedSetupRequest(request, botToken)) {
    return jsonResponse({ ok: false, errorUz: 'Ruxsat etilmagan so‘rov.' }, 401);
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
