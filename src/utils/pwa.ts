const PWA_DISMISS_STORAGE_KEY = 'alifbo_pwa_install_dismissed_v1';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt: () => Promise<void>;
}

let deferredPromptEvent: BeforeInstallPromptEvent | null = null;
let reloadDeferred = false;
let pendingReload = false;
const promptListeners = new Set<() => void>();

function notifyPromptListeners(): void {
  for (const listener of promptListeners) {
    listener();
  }
}

export function subscribePwaInstallState(listener: () => void): () => void {
  promptListeners.add(listener);
  return () => {
    promptListeners.delete(listener);
  };
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPromptEvent;
}

export function clearDeferredInstallPrompt(): void {
  deferredPromptEvent = null;
  notifyPromptListeners();
}

export async function triggerNativePwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const promptEvt = deferredPromptEvent;
  if (!promptEvt) return 'unavailable';
  try {
    await promptEvt.prompt();
    const choice = await promptEvt.userChoice;
    deferredPromptEvent = null;
    notifyPromptListeners();
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  const navStandalone = Boolean((window.navigator as { standalone?: boolean }).standalone);
  const mediaStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return navStandalone || mediaStandalone;
}

export function isIosSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/i.test(ua);
  const isWebKit = /WebKit/i.test(ua);
  const isCriOSOrFxiOS = /CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua);
  return isIos && isWebKit && !isCriOSOrFxiOS;
}

export function isPwaBannerDismissed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PWA_DISMISS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissPwaBanner(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PWA_DISMISS_STORAGE_KEY, '1');
    }
  } catch {
    // Ignore storage quota errors in private mode
  }
  notifyPromptListeners();
}

function executeSafeReload(): void {
  if (reloadDeferred) {
    pendingReload = true;
    return;
  }
  pendingReload = false;
  if (typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
    window.location.reload();
  }
}

/**
 * Defer Service Worker deploy reloads while an active child lesson is in progress,
 * then apply automatically once the child returns from the lesson.
 */
export function setPwaReloadDeferral(defer: boolean): void {
  reloadDeferred = defer;
  if (!defer && pendingReload) {
    executeSafeReload();
  }
}

let lifecycleInitialized = false;

export function initPwaLifecycle(): void {
  if (lifecycleInitialized || typeof window === 'undefined') return;
  lifecycleInitialized = true;

  window.addEventListener('beforeinstallprompt', (event: Event) => {
    event.preventDefault();
    deferredPromptEvent = event as BeforeInstallPromptEvent;
    notifyPromptListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredPromptEvent = null;
    notifyPromptListeners();
  });

  window.addEventListener('vite:preloadError', (event: Event) => {
    event.preventDefault();
    executeSafeReload();
  });

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    let hadInitialController = Boolean(navigator.serviceWorker.controller);
    let reloadingForSw = false;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadInitialController) {
        hadInitialController = true;
        return;
      }
      if (reloadingForSw) return;
      reloadingForSw = true;
      executeSafeReload();
    });

    const registerAndPoll = () => {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                installing.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              void reg.update().catch(() => undefined);
            }
          });
        })
        .catch(() => undefined);
    };

    if (document.readyState === 'complete') {
      registerAndPoll();
    } else {
      window.addEventListener('load', registerAndPoll, { once: true });
    }
  }
}
