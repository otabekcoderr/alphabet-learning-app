import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { getRequestOrigin } from './session.js';

export const DEFAULT_TELEGRAM_BOT_USERNAME = 'alifbo_uz_robot';
export const TELEGRAM_LOGIN_TOKEN_TTL_SEC = 300;

export interface TelegramInlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

let _registeredWebhookUrl: string | null = null;

export function sanitizeBotUsername(raw: string | undefined): string {
  return (raw || '').trim().replace(/^@+/, '');
}

export function resolveTelegramBotUsername(): string {
  return sanitizeBotUsername(
    process.env.TELEGRAM_BOT_USERNAME ||
      process.env.VITE_TELEGRAM_BOT_USERNAME ||
      DEFAULT_TELEGRAM_BOT_USERNAME,
  );
}

function getLoginTokenSigningKey(botToken: string): string {
  return process.env.SESSION_SECRET?.trim() || botToken;
}

/**
 * Create an HMAC-signed, URL-safe Telegram deep-link login token (`<nonce>_<sig>`).
 * Total length is 39 chars (`auth_<token>` = 44 chars), safely within Telegram's 64-char limit.
 */
export function createTelegramLoginToken(botToken: string): string {
  const nonce = randomBytes(16).toString('base64url');
  const sig = createHmac('sha256', getLoginTokenSigningKey(botToken))
    .update(`tg-login:${nonce}`)
    .digest('base64url')
    .slice(0, 16);
  return `${nonce}_${sig}`;
}

/** Verify the format and HMAC signature of a Telegram deep-link login token. */
export function verifyTelegramLoginToken(token: string, botToken: string): boolean {
  if (!/^[A-Za-z0-9_-]{16,32}_[A-Za-z0-9_-]{16}$/.test(token)) {
    return false;
  }
  const splitIdx = token.length - 17;
  if (splitIdx <= 0 || token[splitIdx] !== '_') return false;
  const nonce = token.slice(0, splitIdx);
  const sig = token.slice(splitIdx + 1);
  const expectedSig = createHmac('sha256', getLoginTokenSigningKey(botToken))
    .update(`tg-login:${nonce}`)
    .digest('base64url')
    .slice(0, 16);

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
}

/** Deterministic SHA-256 HMAC digest of a deep-link login token for database/KV storage. */
export function hashTelegramLoginToken(token: string, botToken: string): string {
  return createHmac('sha256', botToken).update(`tg-login-hash:${token}`).digest('hex');
}

/** Deterministic UUID + 8-digit numeric public ID for KV-only fallback when Postgres is absent. */
export function deriveStatelessTelegramIdentity(
  telegramId: string,
  botToken: string,
): { id: string; publicId: string } {
  const digest = createHmac('sha256', getLoginTokenSigningKey(botToken))
    .update(`tg-identity:${telegramId}`)
    .digest();
  const uuidBytes = Buffer.from(digest.subarray(0, 16));
  uuidBytes[6] = ((uuidBytes[6] ?? 0) & 0x0f) | 0x40;
  uuidBytes[8] = ((uuidBytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = uuidBytes.toString('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  const numVal = digest.readUInt32BE(16);
  const publicId = String(10_000_000 + (numVal % 90_000_000));
  return { id, publicId };
}

export function deriveTelegramWebhookSecret(botToken: string): string {
  const configured = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (configured) {
    return configured;
  }
  return createHmac('sha256', botToken)
    .update('alifbo-telegram-webhook-secret-v1')
    .digest('hex')
    .slice(0, 48);
}

export function hashTelegramAuthCode(code: string, botToken: string): string {
  return createHmac('sha256', botToken).update(`tg-code:${code}`).digest('hex');
}

export function generateSixDigitCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

export function resolvePublicAppOrigin(request: Request): string {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return getRequestOrigin(request).replace(/\/+$/, '');
}

export function isPublicHttpsOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
  } catch {
    return false;
  }
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  inlineKeyboard?: TelegramInlineButton[][],
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (inlineKeyboard && inlineKeyboard.length > 0) {
      body.reply_markup = { inline_keyboard: inlineKeyboard };
    }
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function answerTelegramCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  try {
    const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
    if (text) {
      body.text = text;
    }
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Ignore callback answer failures
  }
}

export async function ensureTelegramWebhookRegistered(
  botToken: string,
  appOrigin: string,
  forceCheck = false,
): Promise<{
  ok: boolean;
  webhookUrl: string | null;
  updated: boolean;
  reason?: string;
}> {
  if (!botToken) {
    return { ok: false, webhookUrl: null, updated: false, reason: 'missing_bot_token' };
  }
  if (!isPublicHttpsOrigin(appOrigin)) {
    return { ok: false, webhookUrl: null, updated: false, reason: 'non_public_origin' };
  }

  const expectedUrl = `${appOrigin}/api/telegram-webhook`;
  if (!forceCheck && _registeredWebhookUrl === expectedUrl) {
    return { ok: true, webhookUrl: expectedUrl, updated: false };
  }

  try {
    const infoResp = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`, {
      signal: AbortSignal.timeout(4000),
    });
    if (infoResp.ok) {
      const infoJson = (await infoResp.json()) as {
        ok?: boolean;
        result?: { url?: string };
      };
      if (!forceCheck && infoJson.ok && infoJson.result?.url === expectedUrl) {
        _registeredWebhookUrl = expectedUrl;
        return { ok: true, webhookUrl: expectedUrl, updated: false };
      }
    }

    const setResp = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: expectedUrl,
        secret_token: deriveTelegramWebhookSecret(botToken),
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!setResp.ok) {
      return { ok: false, webhookUrl: expectedUrl, updated: false, reason: 'set_webhook_failed' };
    }
    const setJson = (await setResp.json()) as { ok?: boolean };
    if (setJson.ok) {
      _registeredWebhookUrl = expectedUrl;
      return { ok: true, webhookUrl: expectedUrl, updated: true };
    }
    return { ok: false, webhookUrl: expectedUrl, updated: false, reason: 'set_webhook_failed' };
  } catch {
    return { ok: false, webhookUrl: expectedUrl, updated: false, reason: 'network_error' };
  }
}
