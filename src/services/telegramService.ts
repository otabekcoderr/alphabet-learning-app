export const TG_PENDING_QUEUE_KEY = 'alifbo_tg_pending_queue_v1';

const MAX_PENDING_MESSAGES = 50;
const DEFAULT_TELEGRAM_TIMEOUT_MS = 8000;
const DEFAULT_ADMIN_ALERT_ENDPOINT = '/api/notifications/admin-alert';

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

export interface SendTelegramMessageOptions {
  category?: TelegramMessageCategory;
  endpoint?: string;
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
 * Read locally queued Telegram messages saved when offline, blocked, or unconfigured.
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

async function postAdminAlert(
  endpoint: string,
  category: TelegramMessageCategory,
  trimmedText: string,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; reason: TelegramFailureReason; statusCode?: number }> {
  if (typeof fetch !== 'function') {
    return { ok: false, reason: 'unavailable' };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  if (controller) {
    timerId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        category,
        text: trimmedText,
      }),
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (resp.status === 503) {
      return { ok: false, reason: 'missing_env', statusCode: 503 };
    }

    if (!resp.ok) {
      return { ok: false, reason: 'http_error', statusCode: resp.status };
    }

    try {
      const body = (await resp.json()) as { ok?: unknown } | null;
      if (body && typeof body === 'object' && body.ok === false) {
        return { ok: false, reason: 'http_error', statusCode: resp.status };
      }
    } catch {
      // Response was HTTP 2xx without parseable JSON body; treat as sent
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: 'network_error' };
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  }
}

/**
 * Send a plain-text notification via the server-side `/api/notifications/admin-alert` endpoint.
 * Never exposes bot tokens to the browser; queues locally on network/server failure.
 */
export async function sendTelegramMessage(
  text: string,
  options?: SendTelegramMessageOptions,
): Promise<TelegramSendResult> {
  const trimmedText = text.trim();
  const category: TelegramMessageCategory = options?.category ?? 'general';
  const endpoint = options?.endpoint ?? DEFAULT_ADMIN_ALERT_ENDPOINT;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TELEGRAM_TIMEOUT_MS;

  if (!trimmedText) {
    return { ok: false, queuedLocally: false, reason: 'unavailable' };
  }

  const result = await postAdminAlert(endpoint, category, trimmedText, timeoutMs);
  if (result.ok) {
    return { ok: true, queuedLocally: false };
  }

  const queuedLocally = savePendingTelegramMessage({
    category,
    text: trimmedText,
    reason: result.reason,
    ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : {}),
  });
  return {
    ok: false,
    queuedLocally,
    reason: result.reason,
    ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : {}),
  };
}

/**
 * Retry delivering locally queued messages via the server-side endpoint when online.
 */
export async function flushPendingTelegramMessages(
  endpoint: string = DEFAULT_ADMIN_ALERT_ENDPOINT,
): Promise<number> {
  const storage = getStorageSafe();
  if (!storage) return 0;

  const queued = getPendingTelegramMessages();
  if (queued.length === 0) return 0;

  const remaining: PendingTelegramMessage[] = [];
  let flushedCount = 0;

  for (const item of queued) {
    const res = await postAdminAlert(endpoint, item.category, item.text, DEFAULT_TELEGRAM_TIMEOUT_MS);
    if (res.ok) {
      flushedCount++;
    } else {
      remaining.push(item);
    }
  }

  try {
    if (remaining.length === 0) {
      storage.removeItem(TG_PENDING_QUEUE_KEY);
    } else {
      storage.setItem(TG_PENDING_QUEUE_KEY, JSON.stringify(remaining));
    }
  } catch {
    // Ignore storage quota errors
  }

  return flushedCount;
}

export interface OnboardingTelegramPayload {
  childStageLabel: string;
  previousAttemptsLabel: string;
  biggestDifficultyLabel: string;
  contact?: string;
  childName?: string;
  publicId?: string;
  isGuest?: boolean;
  completedAt?: string;
}

/** Format strategic onboarding answers as a clean Uzbek Telegram message. */
export function formatOnboardingTelegramMessage(payload: OnboardingTelegramPayload): string {
  const contactText = payload.contact?.trim() || 'Kiritilmadi';
  const childLabel = payload.childName?.trim() || 'Bolajon';
  const idLine =
    payload.isGuest === true
      ? 'Holat: Sinov rejimi (Guest)'
      : payload.publicId?.trim()
        ? `ID: ${payload.publicId.trim()}`
        : null;
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
  isGuest?: boolean;
  submittedAt?: string;
}

/** Format PMF / Mom Test feedback responses as a clean Uzbek Telegram message. */
export function formatFeedbackTelegramMessage(payload: FeedbackTelegramPayload): string {
  const childLabel = payload.childName?.trim() || 'Bolajon';
  const idLine =
    payload.isGuest === true
      ? 'Holat: Sinov rejimi (Guest)'
      : payload.publicId?.trim()
        ? `ID: ${payload.publicId.trim()}`
        : null;
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
