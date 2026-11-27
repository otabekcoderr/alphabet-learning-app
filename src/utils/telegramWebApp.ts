export interface TelegramWebAppInstance {
  initData?: string;
  platform?: string;
  ready?: () => void;
  expand?: () => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebAppInstance;
    };
  }
}

const TG_WEBAPP_INITDATA_SESSION_KEY = 'alifbo_tg_webapp_initdata_v1';

function readInitDataFromLocationHash(): string {
  if (typeof window === 'undefined') return '';
  try {
    const rawHash = (window.location.hash || '').replace(/^#/, '');
    if (!rawHash) return '';
    const params = new URLSearchParams(rawHash);
    const val = params.get('tgWebAppData');
    return val ? val.trim() : '';
  } catch {
    return '';
  }
}

function readCachedWebAppInitData(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage?.getItem(TG_WEBAPP_INITDATA_SESSION_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

function cacheWebAppInitData(initData: string): void {
  if (typeof window === 'undefined' || !initData) return;
  try {
    window.sessionStorage?.setItem(TG_WEBAPP_INITDATA_SESSION_KEY, initData);
  } catch {
    // Ignore restricted sessionStorage errors
  }
}

/**
 * Return raw Telegram Mini App `initData` string when running inside Telegram WebView,
 * or `""` in normal browser / standalone PWA contexts.
 */
export function getTelegramWebAppInitData(): string {
  if (typeof window === 'undefined') return '';
  const sdkInitData = window.Telegram?.WebApp?.initData?.trim() ?? '';
  if (sdkInitData) {
    cacheWebAppInitData(sdkInitData);
    return sdkInitData;
  }
  const hashInitData = readInitDataFromLocationHash();
  if (hashInitData) {
    cacheWebAppInitData(hashInitData);
    return hashInitData;
  }
  return readCachedWebAppInitData();
}

/** True when currently running inside Telegram's in-app Mini App WebView. */
export function isTelegramWebAppContext(): boolean {
  if (typeof window === 'undefined') return false;
  if (getTelegramWebAppInitData().length > 0) {
    return true;
  }
  const platform = window.Telegram?.WebApp?.platform?.trim().toLowerCase() ?? '';
  return Boolean(platform && platform !== 'unknown');
}

/** Notify Telegram WebApp client that the Mini App is ready and expand viewport height. */
export function initTelegramWebAppViewport(): void {
  if (typeof window === 'undefined') return;
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;
  try {
    webApp.ready?.();
    webApp.expand?.();
  } catch {
    // Ignore non-Telegram browser errors
  }
}

/**
 * Hybrid PWA Bridge: opens the clean app origin in the device's default browser / installed
 * Android PWA via `Telegram.WebApp.openLink` (or `window.open` fallback).
 */
export function openExternalPwaBridge(targetOrigin?: string): void {
  if (typeof window === 'undefined') return;
  const cleanUrl = (targetOrigin || window.location.origin).replace(/\/+$/, '');
  const tgOpenLink = window.Telegram?.WebApp?.openLink;
  if (typeof tgOpenLink === 'function') {
    try {
      tgOpenLink(cleanUrl);
      return;
    } catch {
      // Fall back to standard browser open
    }
  }
  window.open(cleanUrl, '_blank', 'noopener,noreferrer');
}
