import { generateInstallSalt, sha256Hex } from './pin';

export type AuthProviderKind = 'password' | 'google' | 'telegram';

export interface ParentAccountSession {
  id: string;
  publicId?: string;
  contact: string;
  createdAt: string;
  signedInAt: string;
  provider?: AuthProviderKind;
  avatarUrl?: string;
  isGuest?: boolean;
  telegramLinked?: boolean;
}

export const GUEST_TRIAL_ACCOUNT_ID = 'guest_trial';
export const GUEST_VISIT_COUNT_KEY = 'alifbo_guest_visit_count_v1';
export const GUEST_SESSION_ACTIVE_KEY = 'alifbo_guest_session_active_v1';

/** Return true when the active session is a temporary device-only guest trial. */
export function isGuestAccount(account: ParentAccountSession | null | undefined): boolean {
  return Boolean(
    account && (account.id === GUEST_TRIAL_ACCOUNT_ID || account.isGuest === true),
  );
}

/** Record/check Guest Trial visits across separate browser sessions to prompt registration on 2nd+ return. */
export function registerGuestAppVisit(params: {
  isGuest: boolean;
  hasCompletedOnboarding: boolean;
  localStore?: Storage | null;
  sessionStore?: Storage | null;
}): {
  visitCount: number;
  isNewBrowserSession: boolean;
  shouldPromptReturnSignup: boolean;
} {
  const ls =
    params.localStore !== undefined
      ? params.localStore
      : typeof window !== 'undefined'
        ? window.localStorage
        : null;
  const ss =
    params.sessionStore !== undefined
      ? params.sessionStore
      : typeof window !== 'undefined'
        ? window.sessionStorage
        : null;

  if (!params.isGuest) {
    try {
      ls?.removeItem(GUEST_VISIT_COUNT_KEY);
      ss?.removeItem(GUEST_SESSION_ACTIVE_KEY);
    } catch {
      // Ignore storage errors
    }
    return { visitCount: 0, isNewBrowserSession: false, shouldPromptReturnSignup: false };
  }

  let prevCount = 0;
  let alreadyActiveInSession = false;
  try {
    const rawCount = Number(ls?.getItem(GUEST_VISIT_COUNT_KEY) ?? '0');
    prevCount = Number.isFinite(rawCount) && rawCount > 0 ? Math.trunc(rawCount) : 0;
    alreadyActiveInSession = ss?.getItem(GUEST_SESSION_ACTIVE_KEY) === '1';
  } catch {
    prevCount = 0;
  }

  const isNewBrowserSession = !alreadyActiveInSession;
  const visitCount = isNewBrowserSession ? prevCount + 1 : Math.max(1, prevCount);

  try {
    ls?.setItem(GUEST_VISIT_COUNT_KEY, String(visitCount));
    ss?.setItem(GUEST_SESSION_ACTIVE_KEY, '1');
  } catch {
    // Ignore storage errors
  }

  return {
    visitCount,
    isNewBrowserSession,
    shouldPromptReturnSignup: params.hasCompletedOnboarding && visitCount >= 2,
  };
}

/** Return the permanent 8-digit public ID only for registered accounts (never for Guest Trial). */
export function getDisplayablePublicId(
  account: ParentAccountSession | null | undefined,
): string | undefined {
  if (!account || isGuestAccount(account)) {
    return undefined;
  }
  return isValidAccountPublicId(account.publicId) ? account.publicId : undefined;
}

export interface StoredParentAccountRecord {
  id: string;
  publicId?: string;
  contactKey: string;
  contactDisplay: string;
  passwordSalt: string;
  passwordHash: string;
  childName: string;
  avatarId: string;
  createdAt: string;
}

export interface AuthProvidersStatus {
  ok: boolean;
  dbConfigured: boolean;
  google: boolean;
  telegram: boolean;
  telegramStoreConfigured?: boolean;
  telegramAuthMode?: 'bot_deeplink' | 'bot_code';
  telegramBotUsername: string | null;
  telegramBotId: string | null;
}

export const DEFAULT_TELEGRAM_BOT_USERNAME = 'alifbo_uz_robot';
export const ACCOUNT_PUBLIC_ID_REGEX = /^\d{8}$/;

/** Generate a random 8-digit numeric public ID (no leading zero). */
export function generateAccountPublicId(): string {
  const min = 10_000_000;
  const range = 90_000_000;
  const maxUnbiased = Math.floor(0x1_0000_0000 / range) * range;

  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    while (true) {
      cryptoObj.getRandomValues(buf);
      const val = buf[0] ?? 0;
      if (val < maxUnbiased) {
        return String(min + (val % range));
      }
    }
  }

  return String(min + Math.floor(Math.random() * range));
}

/** Check whether a value is a valid 8-digit numeric public account ID. */
export function isValidAccountPublicId(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_PUBLIC_ID_REGEX.test(value);
}

/** Format an 8-digit numeric public ID as `XXXX-XXXX` for UI display (e.g. `4829-1034`). */
export function formatAccountPublicId(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 8)}`;
  }
  return trimmed;
}

/** Generate an internal UUID v4 for account `id`. */
export function generateAccountUuid(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function generateUniqueLocalPublicId(existingIds: Set<string>): string {
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = generateAccountPublicId();
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }
  return generateAccountPublicId();
}

/** Strip whitespace and leading `@` characters from a Telegram bot username. */
export function sanitizeTelegramBotUsername(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/^@+/, '');
}

/** Build a `https://t.me/<bot>?start=<mode>` deep link for Telegram bot auth. */
export function buildTelegramBotDeepLink(
  botUsername: string,
  startParam: 'signup' | 'login' = 'login',
): string {
  const cleanUsername = sanitizeTelegramBotUsername(botUsername);
  return `https://t.me/${encodeURIComponent(cleanUsername)}?start=${startParam}`;
}

/** Build a `https://t.me/<bot>?start=auth_<token>` deep link for polling-based bot login. */
export function buildTelegramAuthDeepLink(botUsername: string, loginToken: string): string {
  const cleanUsername = sanitizeTelegramBotUsername(botUsername) || DEFAULT_TELEGRAM_BOT_USERNAME;
  return `https://t.me/${encodeURIComponent(cleanUsername)}?start=auth_${encodeURIComponent(loginToken.trim())}`;
}

/** Keep only digits from a Telegram OTP code input, clamped to 6 characters. */
export function normalizeTelegramAuthCode(raw: string): string {
  return (raw || '').replace(/\D/g, '').slice(0, 6);
}

export type RemoteAuthResult =
  | {
      ok: true;
      session: ParentAccountSession;
      childName: string;
      avatarId: string;
      isNewSignup: boolean;
      state: unknown | null;
    }
  | { ok: false; code?: string; errorUz: string };

export interface RemoteMeResult {
  ok: boolean;
  authenticated: boolean;
  dbConfigured: boolean;
  session?: ParentAccountSession;
  childName?: string;
  avatarId?: string;
  state?: unknown | null;
}

const ACCOUNTS_STORAGE_KEY = 'alifbo_parent_accounts_v1';

function hashAccountPassword(salt: string, password: string): string {
  return sha256Hex(`account:${salt}:${password}`);
}

/** Normalize an email address or phone number for consistent account lookup. */
export function normalizeContactKey(contact: string): string {
  const trimmed = (contact || '').trim().toLowerCase();
  if (trimmed.includes('@')) {
    return trimmed;
  }
  const digitsOnly = trimmed.replace(/[\s\-()+]/g, '');
  return /^\d{5,}$/.test(digitsOnly) ? digitsOnly : trimmed;
}

function loadStoredAccounts(): StoredParentAccountRecord[] {
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const validRecords = parsed.filter(
      (entry): entry is StoredParentAccountRecord =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as StoredParentAccountRecord).id === 'string' &&
        typeof (entry as StoredParentAccountRecord).contactKey === 'string' &&
        typeof (entry as StoredParentAccountRecord).passwordSalt === 'string' &&
        typeof (entry as StoredParentAccountRecord).passwordHash === 'string',
    );
    const existingIds = new Set(
      validRecords
        .map((rec) => rec.publicId)
        .filter((pid): pid is string => isValidAccountPublicId(pid)),
    );
    let migrated = false;
    const normalized = validRecords.map((rec) => {
      if (isValidAccountPublicId(rec.publicId)) {
        return rec;
      }
      migrated = true;
      const publicId = generateUniqueLocalPublicId(existingIds);
      existingIds.add(publicId);
      return { ...rec, publicId };
    });
    if (migrated) {
      saveStoredAccounts(normalized);
    }
    return normalized;
  } catch {
    return [];
  }
}

function saveStoredAccounts(records: StoredParentAccountRecord[]): void {
  try {
    window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors in restricted browsing contexts
  }
}

export function hasRegisteredParentAccounts(): boolean {
  return loadStoredAccounts().length > 0;
}

export function registerParentAccount(params: {
  contact: string;
  password: string;
  childName: string;
  avatarId: string;
  nowIso?: string;
}):
  | {
      ok: true;
      session: ParentAccountSession;
      profile: { name: string; avatarId: string };
    }
  | { ok: false; errorUz: string } {
  const contactDisplay = params.contact.trim();
  const contactKey = normalizeContactKey(contactDisplay);
  const childName = params.childName.trim();
  const avatarId = params.avatarId.trim();

  if (contactDisplay.length < 4) {
    return {
      ok: false,
      errorUz: 'Telefon raqami yoki elektron pochta manzilini to‘g‘ri kiriting.',
    };
  }
  if (params.password.length < 6) {
    return {
      ok: false,
      errorUz: 'Parol kamida 6 ta belgidan iborat bo‘lishi kerak.',
    };
  }
  if (!childName) {
    return {
      ok: false,
      errorUz: 'Bolaning ismi yoki taxallusini kiriting.',
    };
  }
  if (!avatarId) {
    return {
      ok: false,
      errorUz: '8 ta qahramondan birini tanlang.',
    };
  }

  const existing = loadStoredAccounts();
  if (existing.some((acc) => acc.contactKey === contactKey)) {
    return {
      ok: false,
      errorUz: 'Bu telefon raqami yoki pochta bilan allaqachon hisob yaratilgan. «Kirish» bo‘limidan kiring.',
    };
  }

  const nowIso = params.nowIso ?? new Date().toISOString();
  const salt = generateInstallSalt();
  const id = generateAccountUuid();
  const existingPublicIds = new Set(
    existing
      .map((acc) => acc.publicId)
      .filter((pid): pid is string => isValidAccountPublicId(pid)),
  );
  const publicId = generateUniqueLocalPublicId(existingPublicIds);
  const record: StoredParentAccountRecord = {
    id,
    publicId,
    contactKey,
    contactDisplay,
    passwordSalt: salt,
    passwordHash: hashAccountPassword(salt, params.password),
    childName,
    avatarId,
    createdAt: nowIso,
  };

  saveStoredAccounts([...existing, record]);

  return {
    ok: true,
    session: {
      id,
      publicId,
      contact: contactDisplay,
      createdAt: nowIso,
      signedInAt: nowIso,
    },
    profile: {
      name: childName,
      avatarId,
    },
  };
}

export function authenticateParentAccount(params: {
  contact: string;
  password: string;
  nowIso?: string;
}):
  | {
      ok: true;
      session: ParentAccountSession;
      childName: string;
      avatarId: string;
    }
  | { ok: false; errorUz: string } {
  const contactKey = normalizeContactKey(params.contact);
  if (!contactKey || !params.password) {
    return {
      ok: false,
      errorUz: 'Telefon/pochta va parolni kiriting.',
    };
  }

  const records = loadStoredAccounts();
  const matched = records.find((acc) => acc.contactKey === contactKey);
  if (!matched) {
    return {
      ok: false,
      errorUz: 'Bunday hisob topilmadi. Avval ro‘yxatdan o‘ting.',
    };
  }

  const candidateHash = hashAccountPassword(matched.passwordSalt, params.password);
  if (candidateHash !== matched.passwordHash) {
    return {
      ok: false,
      errorUz: 'Parol noto‘g‘ri. Qaytadan urinib ko‘ring.',
    };
  }

  let publicId = matched.publicId;
  if (!isValidAccountPublicId(publicId)) {
    publicId = generateAccountPublicId();
    const updatedRecords = records.map((acc) =>
      acc.id === matched.id ? { ...acc, publicId } : acc,
    );
    saveStoredAccounts(updatedRecords);
  }

  const nowIso = params.nowIso ?? new Date().toISOString();
  return {
    ok: true,
    session: {
      id: matched.id,
      publicId,
      contact: matched.contactDisplay,
      createdAt: matched.createdAt,
      signedInAt: nowIso,
    },
    childName: matched.childName,
    avatarId: matched.avatarId,
  };
}

export async function fetchAuthProviders(): Promise<AuthProvidersStatus> {
  try {
    const res = await fetch('/api/auth/session?action=providers', { credentials: 'include' });
    if (!res.ok) {
      return {
        ok: false,
        dbConfigured: false,
        google: false,
        telegram: false,
        telegramStoreConfigured: false,
        telegramAuthMode: 'bot_deeplink',
        telegramBotUsername: null,
        telegramBotId: null,
      };
    }
    const data = (await res.json()) as Partial<AuthProvidersStatus>;
    const botUsername = sanitizeTelegramBotUsername(
      typeof data.telegramBotUsername === 'string' ? data.telegramBotUsername : '',
    );
    const botId =
      typeof data.telegramBotId === 'string' && /^\d+$/.test(data.telegramBotId)
        ? data.telegramBotId
        : null;
    return {
      ok: Boolean(data.ok),
      dbConfigured: Boolean(data.dbConfigured),
      google: Boolean(data.google),
      telegram: Boolean(data.telegram),
      telegramStoreConfigured: Boolean(data.telegramStoreConfigured),
      telegramAuthMode: data.telegramAuthMode === 'bot_code' ? 'bot_code' : 'bot_deeplink',
      telegramBotUsername: botUsername || null,
      telegramBotId: botId,
    };
  } catch {
    return {
      ok: false,
      dbConfigured: false,
      google: false,
      telegram: false,
      telegramStoreConfigured: false,
      telegramAuthMode: 'bot_deeplink',
      telegramBotUsername: null,
      telegramBotId: null,
    };
  }
}

export async function fetchCurrentSession(): Promise<RemoteMeResult> {
  try {
    const res = await fetch('/api/auth/session?action=me', { credentials: 'include' });
    if (!res.ok) {
      return { ok: false, authenticated: false, dbConfigured: false };
    }
    const data = (await res.json()) as Partial<RemoteMeResult>;
    return {
      ok: Boolean(data.ok),
      authenticated: Boolean(data.authenticated),
      dbConfigured: Boolean(data.dbConfigured),
      session: data.session,
      childName: data.childName,
      avatarId: data.avatarId,
      state: data.state ?? null,
    };
  } catch {
    return { ok: false, authenticated: false, dbConfigured: false };
  }
}

export async function registerParentAccountRemote(params: {
  contact: string;
  password: string;
  childName: string;
  avatarId: string;
}): Promise<RemoteAuthResult> {
  try {
    const res = await fetch('/api/auth/session?action=register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      code?: string;
      errorUz?: string;
      session?: ParentAccountSession;
      profile?: { name: string; avatarId: string };
      isNewSignup?: boolean;
    };
    if (!res.ok || !data.ok || !data.session || !data.profile) {
      return {
        ok: false,
        code: data.code,
        errorUz: data.errorUz || 'Ro‘yxatdan o‘tishda xatolik yuz berdi.',
      };
    }
    return {
      ok: true,
      session: data.session,
      childName: data.profile.name,
      avatarId: data.profile.avatarId,
      isNewSignup: data.isNewSignup ?? true,
      state: null,
    };
  } catch {
    return {
      ok: false,
      errorUz: 'Server bilan bog‘lanib bo‘lmadi. Internetni tekshiring.',
    };
  }
}

export async function authenticateParentAccountRemote(params: {
  contact: string;
  password: string;
}): Promise<RemoteAuthResult> {
  try {
    const res = await fetch('/api/auth/session?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      code?: string;
      errorUz?: string;
      session?: ParentAccountSession;
      childName?: string;
      avatarId?: string;
      state?: unknown;
    };
    if (!res.ok || !data.ok || !data.session) {
      return {
        ok: false,
        code: data.code,
        errorUz: data.errorUz || 'Kirishda xatolik yuz berdi.',
      };
    }
    return {
      ok: true,
      session: data.session,
      childName: data.childName || 'Bolajon',
      avatarId: data.avatarId || 'fox',
      isNewSignup: false,
      state: data.state ?? null,
    };
  } catch {
    return {
      ok: false,
      errorUz: 'Server bilan bog‘lanib bo‘lmadi. Internetni tekshiring.',
    };
  }
}

export async function authenticateWithTelegramWebApp(payload: {
  initData: string;
  childName?: string;
  avatarId?: string;
}): Promise<RemoteAuthResult & { dbSynced?: boolean }> {
  try {
    const res = await fetch('/api/auth/telegram?action=webapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        initData: payload.initData,
        childName: payload.childName,
        avatarId: payload.avatarId,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      code?: string;
      errorUz?: string;
      dbSynced?: boolean;
      session?: ParentAccountSession;
      childName?: string;
      avatarId?: string;
      isNewSignup?: boolean;
      state?: unknown;
    };
    if (!res.ok || !data.ok || !data.session) {
      return {
        ok: false,
        code: data.code,
        errorUz: data.errorUz || 'Telegram WebApp orqali kirishda xatolik yuz berdi.',
      };
    }
    return {
      ok: true,
      dbSynced: Boolean(data.dbSynced),
      session: data.session,
      childName: data.childName || 'Bolajon',
      avatarId: data.avatarId || 'fox',
      isNewSignup: Boolean(data.isNewSignup),
      state: data.state ?? null,
    };
  } catch {
    return {
      ok: false,
      errorUz: 'Telegram WebApp serveri bilan bog‘lanib bo‘lmadi.',
    };
  }
}

export async function authenticateWithTelegramCode(payload: {
  code: string;
  childName?: string;
  avatarId?: string;
}): Promise<RemoteAuthResult> {
  try {
    const res = await fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        code: normalizeTelegramAuthCode(payload.code),
        childName: payload.childName,
        avatarId: payload.avatarId,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      code?: string;
      errorUz?: string;
      session?: ParentAccountSession;
      childName?: string;
      avatarId?: string;
      isNewSignup?: boolean;
      state?: unknown;
    };
    if (!res.ok || !data.ok || !data.session) {
      return {
        ok: false,
        code: data.code,
        errorUz: data.errorUz || 'Telegram orqali kirishda xatolik yuz berdi.',
      };
    }
    return {
      ok: true,
      session: data.session,
      childName: data.childName || 'Bolajon',
      avatarId: data.avatarId || 'fox',
      isNewSignup: Boolean(data.isNewSignup),
      state: data.state ?? null,
    };
  } catch {
    return {
      ok: false,
      errorUz: 'Telegram tasdiqlashda server bilan bog‘lanib bo‘lmadi.',
    };
  }
}

export type StartTelegramAuthResult =
  | {
      ok: true;
      token: string;
      deepLink: string;
      botUsername: string;
      expiresAt: string;
    }
  | { ok: false; code?: string; errorUz: string };

export type TelegramAuthStatusResult =
  | { ok: true; status: 'pending' | 'expired' }
  | {
      ok: true;
      status: 'approved';
      dbSynced: boolean;
      session: ParentAccountSession;
      childName: string;
      avatarId: string;
      isNewSignup: boolean;
      state: unknown | null;
    }
  | { ok: false; code?: string; errorUz: string };

/** Create a one-time Telegram bot deep-link login token and URL (`?start=auth_<token>`). */
export async function startTelegramDeepLinkAuth(payload?: {
  childName?: string;
  avatarId?: string;
  mode?: 'signup' | 'login';
}): Promise<StartTelegramAuthResult> {
  try {
    const res = await fetch('/api/auth/telegram?action=start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        childName: payload?.childName,
        avatarId: payload?.avatarId,
        mode: payload?.mode,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      code?: string;
      errorUz?: string;
      token?: string;
      deepLink?: string;
      botUsername?: string;
      expiresAt?: string;
    };
    if (!res.ok || !data.ok || !data.token || !data.deepLink) {
      return {
        ok: false,
        code: data.code,
        errorUz: data.errorUz || 'Telegram havolasini yaratishda xatolik yuz berdi.',
      };
    }
    return {
      ok: true,
      token: data.token,
      deepLink: data.deepLink,
      botUsername: sanitizeTelegramBotUsername(data.botUsername) || DEFAULT_TELEGRAM_BOT_USERNAME,
      expiresAt: data.expiresAt || '',
    };
  } catch {
    return {
      ok: false,
      errorUz: 'Telegram serveri bilan bog‘lanib bo‘lmadi.',
    };
  }
}

/** Poll `/api/auth/telegram?action=status&token=...` for bot confirmation of the login token. */
export async function pollTelegramAuthStatus(token: string): Promise<TelegramAuthStatusResult> {
  try {
    const qs = new URLSearchParams({ action: 'status', token });
    const res = await fetch(`/api/auth/telegram?${qs.toString()}`, {
      credentials: 'include',
    });
    const data = (await res.json()) as {
      ok?: boolean;
      code?: string;
      errorUz?: string;
      status?: 'pending' | 'approved' | 'expired';
      dbSynced?: boolean;
      session?: ParentAccountSession;
      childName?: string;
      avatarId?: string;
      isNewSignup?: boolean;
      state?: unknown;
    };
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        code: data.code,
        errorUz: data.errorUz || 'Telegram tasdiqlash holatini tekshirib bo‘lmadi.',
      };
    }
    if (data.status === 'approved' && data.session) {
      return {
        ok: true,
        status: 'approved',
        dbSynced: Boolean(data.dbSynced),
        session: data.session,
        childName: data.childName || 'Bolajon',
        avatarId: data.avatarId || 'fox',
        isNewSignup: Boolean(data.isNewSignup),
        state: data.state ?? null,
      };
    }
    return {
      ok: true,
      status: data.status === 'expired' ? 'expired' : 'pending',
    };
  } catch {
    return {
      ok: false,
      errorUz: 'Telegram holatini tekshirishda tarmoq xatoligi yuz berdi.',
    };
  }
}

export async function logoutRemoteSession(): Promise<void> {
  try {
    await fetch('/api/auth/session?action=logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Ignore network failures on sign-out
  }
}

export async function fetchRemoteState(): Promise<{ ok: boolean; state: unknown | null }> {
  try {
    const res = await fetch('/api/state', { credentials: 'include' });
    if (!res.ok) return { ok: false, state: null };
    const data = (await res.json()) as { ok?: boolean; state?: unknown };
    return { ok: Boolean(data.ok), state: data.state ?? null };
  } catch {
    return { ok: false, state: null };
  }
}

export async function saveRemoteState(state: unknown): Promise<boolean> {
  try {
    const res = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ state }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
