export const TG_PENDING_QUEUE_KEY = 'alifbo_tg_pending_queue_v1';

const MAX_PENDING_MESSAGES = 50;
const DEFAULT_TELEGRAM_TIMEOUT_MS = 8000;

export type TelegramMessageCategory = 'onboarding' | 'feedback' | 'general';

export type TelegramFailureReason =
  | 'missing_env'
  | 'network_error'
  | 'http_error'
  | 'unavailable';

export interface PendingTelegramMessage {
  id: string;
  category: TelegramMessageCategory;
  text: string;
  createdAt: string;
  reason: TelegramFailureReason;
  statusCode?: number;
}

export interface TelegramSendResult {
  ok: boolean;
  queuedLocally: boolean;
  reason?: TelegramFailureReason;
  statusCode?: number;
}

export interface TelegramEnvConfig {
  botToken?: string;
  chatId?: string;
}

export interface SendTelegramMessageOptions {
  category?: TelegramMessageCategory;
  env?: TelegramEnvConfig;
  timeoutMs?: number;
}

function getStorageSafe(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function isValidFailureReason(value: unknown): value is TelegramFailureReason {
  return (
    value === 'missing_env' ||
    value === 'network_error' ||
    value === 'http_error' ||
    value === 'unavailable'
  );
}

function isValidCategory(value: unknown): value is TelegramMessageCategory {
  return value === 'onboarding' || value === 'feedback' || value === 'general';
}

function isValidPendingMessage(value: unknown): value is PendingTelegramMessage {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    isValidCategory(obj.category) &&
    typeof obj.text === 'string' &&
    typeof obj.createdAt === 'string' &&
    isValidFailureReason(obj.reason) &&
    (obj.statusCode === undefined || typeof obj.statusCode === 'number')
  );
}

function generateLocalQueueId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `tg_${Date.now()}_${rand}`;
}

/**
 * Read locally queued Telegram messages saved when offline, blocked, or missing env vars.
 */
export function getPendingTelegramMessages(): PendingTelegramMessage[] {
  const storage = getStorageSafe();
  if (!storage) return [];
  try {
    const raw = storage.getItem(TG_PENDING_QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPendingMessage);
  } catch {
    return [];
  }
}

/**
 * Persist an unsent Telegram message to localStorage so user flows never freeze or lose data.
 */
export function savePendingTelegramMessage(params: {
  category: TelegramMessageCategory;
  text: string;
  reason: TelegramFailureReason;
  statusCode?: number;
}): boolean {
  const storage = getStorageSafe();
  if (!storage) return false;
  try {
    const existing = getPendingTelegramMessages();
    const entry: PendingTelegramMessage = {
      id: generateLocalQueueId(),
      category: params.category,
      text: params.text,
      createdAt: new Date().toISOString(),
      reason: params.reason,
      ...(params.statusCode !== undefined ? { statusCode: params.statusCode } : {}),
    };
    const next = [...existing, entry].slice(-MAX_PENDING_MESSAGES);
    storage.setItem(TG_PENDING_QUEUE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

function resolveTelegramEnv(override?: TelegramEnvConfig): { botToken: string; chatId: string } {
  const rawToken =
    override !== undefined ? override.botToken : import.meta.env?.VITE_TG_BOT_TOKEN;
  const rawChatId =
    override !== undefined ? override.chatId : import.meta.env?.VITE_TG_CHAT_ID;
  return {
    botToken: typeof rawToken === 'string' ? rawToken.trim() : '',
    chatId: typeof rawChatId === 'string' ? rawChatId.trim() : '',
  };
}

/**
 * Send a plain-text notification via Telegram Bot API (`sendMessage`).
 * Never throws; on missing env, offline state, HTTP error, or network block,
 * stores the payload safely in localStorage.
 */
export async function sendTelegramMessage(
  text: string,
  options?: SendTelegramMessageOptions,
): Promise<TelegramSendResult> {
  const trimmedText = text.trim();
  const category: TelegramMessageCategory = options?.category ?? 'general';

  if (!trimmedText) {
    return { ok: false, queuedLocally: false, reason: 'unavailable' };
  }

  const { botToken, chatId } = resolveTelegramEnv(options?.env);
  if (!botToken || !chatId) {
    const queuedLocally = savePendingTelegramMessage({
      category,
      text: trimmedText,
      reason: 'missing_env',
    });
    return { ok: false, queuedLocally, reason: 'missing_env' };
  }

  if (typeof fetch !== 'function') {
    const queuedLocally = savePendingTelegramMessage({
      category,
      text: trimmedText,
      reason: 'unavailable',
    });
    return { ok: false, queuedLocally, reason: 'unavailable' };
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TELEGRAM_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  if (controller) {
    timerId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  try {
    const safeTokenPath = botToken.split(':').map(encodeURIComponent).join(':');
    const endpoint = `https://api.telegram.org/bot${safeTokenPath}/sendMessage`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: trimmedText,
        disable_web_page_preview: true,
      }),
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (!resp.ok) {
      const queuedLocally = savePendingTelegramMessage({
        category,
        text: trimmedText,
        reason: 'http_error',
        statusCode: resp.status,
      });
      return {
        ok: false,
        queuedLocally,
        reason: 'http_error',
        statusCode: resp.status,
      };
    }

    try {
      const body = (await resp.json()) as { ok?: unknown } | null;
      if (body && typeof body === 'object' && body.ok === false) {
        const queuedLocally = savePendingTelegramMessage({
          category,
          text: trimmedText,
          reason: 'http_error',
          statusCode: resp.status,
        });
        return {
          ok: false,
          queuedLocally,
          reason: 'http_error',
          statusCode: resp.status,
        };
      }
    } catch {
      // Response was HTTP 2xx without parseable JSON body; treat as sent
    }

    return { ok: true, queuedLocally: false };
  } catch {
    const queuedLocally = savePendingTelegramMessage({
      category,
      text: trimmedText,
      reason: 'network_error',
    });
    return { ok: false, queuedLocally, reason: 'network_error' };
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  }
}

export interface OnboardingTelegramPayload {
  childStageLabel: string;
  previousAttemptsLabel: string;
  biggestDifficultyLabel: string;
  contact?: string;
  childName?: string;
  publicId?: string;
  completedAt?: string;
}

/** Format strategic onboarding answers as a clean Uzbek Telegram message. */
export function formatOnboardingTelegramMessage(payload: OnboardingTelegramPayload): string {
  const contactText = payload.contact?.trim() || 'Kiritilmadi';
  const childLabel = payload.childName?.trim() || 'Bolajon';
  const idLine = payload.publicId?.trim() ? `ID: ${payload.publicId.trim()}` : null;
  const timeLine = payload.completedAt?.trim() || new Date().toISOString();

  return [
    'ALIFBO — Yangi foydalanuvchi (Onboarding)',
    `Bola: ${childLabel}`,
    ...(idLine ? [idLine] : []),
    `1. Bosqich: ${payload.childStageLabel}`,
    `2. Oldingi urinish: ${payload.previousAttemptsLabel}`,
    `3. Eng qiyin jihati: ${payload.biggestDifficultyLabel}`,
    `4. Aloqa (Telegram/Tel): ${contactText}`,
    `Vaqt: ${timeLine}`,
  ].join('\n');
}

export interface FeedbackTelegramPayload {
  disappointmentLabel: string;
  stuckPoint: string;
  recommendationNote: string;
  sessionsCompleted: number;
  childName?: string;
  publicId?: string;
  submittedAt?: string;
}

/** Format PMF / Mom Test feedback responses as a clean Uzbek Telegram message. */
export function formatFeedbackTelegramMessage(payload: FeedbackTelegramPayload): string {
  const childLabel = payload.childName?.trim() || 'Bolajon';
  const idLine = payload.publicId?.trim() ? `ID: ${payload.publicId.trim()}` : null;
  const stuckText = payload.stuckPoint.trim() || 'Yozilmadi';
  const recText = payload.recommendationNote.trim() || 'Yozilmadi';
  const timeLine = payload.submittedAt?.trim() || new Date().toISOString();

  return [
    'ALIFBO — Ota-ona fikri (PMF / Feedback)',
    `Bola: ${childLabel}`,
    ...(idLine ? [idLine] : []),
    `Tugatilgan mashq sessiyalari: ${payload.sessionsCompleted}`,
    `1. Yopilib qolsa munosabat: ${payload.disappointmentLabel}`,
    `2. Qiyinchilik / yoqmagan joyi: ${stuckText}`,
    `3. Tavsiya va yetishmayotgan jihat: ${recText}`,
    `Vaqt: ${timeLine}`,
  ].join('\n');
}
