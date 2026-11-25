import { DYNAMIC_WORD_POOL, formatGraphemeForScript } from '../data/curriculum';
import type { AlifboState } from '../storage/progressStorage';
import { isGuestAccount } from './auth';
import { computeProblemGraphemes } from './pedagogy';

export type AppNotificationKind =
  | 'guest_save_warning'
  | 'pending_parent_verify'
  | 'telegram_reminder_connect'
  | 'struggling_letter_tip'
  | 'streak_milestone'
  | 'system';

export type AppNotificationAction =
  | 'open_guest_upgrade'
  | 'open_verify_tab'
  | 'connect_telegram'
  | 'open_diagnostics';

export interface AppNotificationItem {
  id: string;
  kind: AppNotificationKind;
  titleUz: string;
  bodyUz: string;
  ctaLabelUz?: string;
  ctaAction?: AppNotificationAction;
  unread: boolean;
  priority: 'high' | 'normal';
  createdAt?: string;
}

export interface RemoteReminderSettings {
  telegramLinked: boolean;
  telegramUsername: string | null;
  reminderEnabled: boolean;
  reminderHour: number;
  botBlocked: boolean;
  botUsername: string;
}

export interface ServerNotificationDto {
  id: string;
  kind: string;
  titleUz: string;
  bodyUz: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationCenterResponse {
  ok: boolean;
  dbConfigured: boolean;
  notifications: ServerNotificationDto[];
  settings: RemoteReminderSettings | null;
}

/**
 * Build prioritized, calm Uzbek parent notifications from local progress state,
 * remote Telegram reminder settings, and server-persisted alerts.
 */
export function buildParentNotifications(params: {
  state: AlifboState;
  remoteSettings: RemoteReminderSettings | null;
  serverNotifications?: ServerNotificationDto[];
}): AppNotificationItem[] {
  const { state, remoteSettings, serverNotifications = [] } = params;
  const readSet = new Set(state.readNotificationIds);
  const items: AppNotificationItem[] = [];
  const isGuest = isGuestAccount(state.account);
  const totalStars = state.totalStars + state.totalEffortStars;
  const practicedWordsCount = Object.keys(state.wordProgress).length;

  if (isGuest) {
    const id = 'local:guest_save_warning';
    items.push({
      id,
      kind: 'guest_save_warning',
      titleUz: 'Natijalar faqat shu qurilmada saqlanadi',
      bodyUz:
        practicedWordsCount > 0 || totalStars > 0
          ? `Hozircha ${practicedWordsCount} ta so‘z va ${totalStars} ta yulduzcha saqlangan. Yo‘qotmaslik uchun hisob yarating.`
          : 'Brauzer xotirasi tozalansa natijalar o‘chib ketishi mumkin. Doimiy 8 xonali ID va bulut saqlash uchun hisob yarating.',
      ctaLabelUz: 'Hisob yaratib saqlash',
      ctaAction: 'open_guest_upgrade',
      unread: !readSet.has(id),
      priority: 'high',
    });
  }

  const pendingVerifyCount = DYNAMIC_WORD_POOL.filter((item) => {
    const prog = state.wordProgress[item.id];
    return Boolean(prog?.pendingVoiceVerify) && prog?.status !== 'mastered';
  }).length;

  if (pendingVerifyCount > 0) {
    const id = `local:pending_verify:${pendingVerifyCount}`;
    items.push({
      id,
      kind: 'pending_parent_verify',
      titleUz: `${pendingVerifyCount} ta so‘z ota-ona tasdig‘ini kutmoqda`,
      bodyUz:
        'Farzandingiz rasmli mashqda topgan so‘zlarni birga tekshirib tasdiqlang — shunda keyingi bosqichlar ochiladi.',
      ctaLabelUz: 'Tasdiqlashga o‘tish',
      ctaAction: 'open_verify_tab',
      unread: !readSet.has(id),
      priority: 'high',
    });
  }

  if (!isGuest && remoteSettings && (!remoteSettings.telegramLinked || remoteSettings.botBlocked)) {
    const id = remoteSettings.botBlocked
      ? 'local:telegram_bot_blocked'
      : 'local:telegram_reminder_connect';
    items.push({
      id,
      kind: 'telegram_reminder_connect',
      titleUz: remoteSettings.botBlocked
        ? `@${remoteSettings.botUsername} boti bloklangan`
        : 'Telegram orqali kunlik eslatmani yoqing',
      bodyUz: remoteSettings.botBlocked
        ? 'Kunlik mashq eslatmalari kelishi uchun Telegram botni qayta faollashtiring.'
        : `@${remoteSettings.botUsername} har kuni mashq vaqtini eslatib, farzandingizning muntazamligini saqlashga yordam beradi.`,
      ctaLabelUz: 'Botni ulash',
      ctaAction: 'connect_telegram',
      unread: !readSet.has(id),
      priority: 'normal',
    });
  }

  const problemGraphemes = computeProblemGraphemes(state.wordProgress, DYNAMIC_WORD_POOL);
  if (problemGraphemes.length > 0) {
    const top = problemGraphemes[0]!;
    const label = formatGraphemeForScript(top.grapheme, 'standard_latin').toUpperCase();
    const id = `local:struggling_letter:${top.grapheme}`;
    items.push({
      id,
      kind: 'struggling_letter_tip',
      titleUz: `«${label}» tovushini birga mustahkamlaylik`,
      bodyUz: `So‘nggi mashqlarda «${label}» ishtirokidagi ${top.assistedWords} ta so‘zda yordam kerak bo‘ldi. Bugun 2-3 daqiqa bo‘g‘inlab takrorlash foydali bo‘ladi.`,
      ctaLabelUz: 'Diagnostikani ko‘rish',
      ctaAction: 'open_diagnostics',
      unread: !readSet.has(id),
      priority: 'normal',
    });
  }

  const days = state.practiceDates.length;
  if (days >= 3 && (days === 3 || days === 7 || days === 14 || days >= 30)) {
    const milestone = days >= 30 ? 30 : days;
    const id = `local:streak_milestone:${milestone}`;
    items.push({
      id,
      kind: 'streak_milestone',
      titleUz: `Ajoyib muntazamlik: ${days} kunlik faollik!`,
      bodyUz: `${state.profile.name || 'Bolajon'} allaqachon ${days} kun mashq qildi. Muntazam qisqa mashqlar ravon o‘qishning eng tez yo‘lidir.`,
      unread: !readSet.has(id),
      priority: 'normal',
    });
  }

  for (const srv of serverNotifications) {
    items.push({
      id: srv.id,
      kind: 'system',
      titleUz: srv.titleUz,
      bodyUz: srv.bodyUz,
      unread: srv.readAt === null && !readSet.has(srv.id),
      priority: 'normal',
      createdAt: srv.createdAt,
    });
  }

  return items;
}

export async function fetchNotificationsData(): Promise<NotificationCenterResponse> {
  try {
    const res = await fetch('/api/notifications?action=list', {
      credentials: 'include',
    });
    if (!res.ok) {
      return { ok: false, dbConfigured: false, notifications: [], settings: null };
    }
    const data = (await res.json()) as Partial<NotificationCenterResponse>;
    return {
      ok: Boolean(data.ok),
      dbConfigured: Boolean(data.dbConfigured),
      notifications: Array.isArray(data.notifications) ? data.notifications : [],
      settings: data.settings ?? null,
    };
  } catch {
    return { ok: false, dbConfigured: false, notifications: [], settings: null };
  }
}

export async function saveReminderSettingsApi(payload: {
  reminderEnabled?: boolean;
  reminderHour?: number;
  markReadIds?: string[];
  markAllRead?: boolean;
}): Promise<{ ok: boolean; settings?: RemoteReminderSettings; errorUz?: string }> {
  try {
    const res = await fetch('/api/notifications/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      settings?: RemoteReminderSettings;
      errorUz?: string;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, errorUz: data.errorUz || 'Sozlamalarni saqlab bo‘lmadi.' };
    }
    return { ok: true, settings: data.settings };
  } catch {
    return { ok: false, errorUz: 'Server bilan bog‘lanib bo‘lmadi.' };
  }
}

export async function createTelegramLinkDeepLinkApi(): Promise<
  | { ok: true; deepLink: string; botUsername: string; expiresAt: string }
  | { ok: false; errorUz: string }
> {
  try {
    const res = await fetch('/api/notifications/telegram-link', {
      method: 'POST',
      credentials: 'include',
    });
    const data = (await res.json()) as {
      ok?: boolean;
      deepLink?: string;
      botUsername?: string;
      expiresAt?: string;
      errorUz?: string;
    };
    if (!res.ok || !data.ok || !data.deepLink) {
      return {
        ok: false,
        errorUz: data.errorUz || 'Telegram ulash havolasini yaratib bo‘lmadi.',
      };
    }
    return {
      ok: true,
      deepLink: data.deepLink,
      botUsername: data.botUsername || 'alifbo_uz_robot',
      expiresAt: data.expiresAt || '',
    };
  } catch {
    return { ok: false, errorUz: 'Server bilan bog‘lanib bo‘lmadi.' };
  }
}

export async function unlinkTelegramReminderApi(): Promise<{ ok: boolean; errorUz?: string }> {
  try {
    const res = await fetch('/api/notifications/telegram-unlink', {
      method: 'POST',
      credentials: 'include',
    });
    const data = (await res.json()) as { ok?: boolean; errorUz?: string };
    return { ok: Boolean(res.ok && data.ok), errorUz: data.errorUz };
  } catch {
    return { ok: false, errorUz: 'Server bilan bog‘lanib bo‘lmadi.' };
  }
}
