import { useEffect, useState } from 'react';
import {
  dismissPwaBanner,
  getDeferredInstallPrompt,
  isIosSafariBrowser,
  isPwaBannerDismissed,
  isStandaloneDisplayMode,
  subscribePwaInstallState,
  triggerNativePwaInstall,
} from '../utils/pwa';
import { playFeedbackChime } from '../utils/audioRecorder';
import { CloseIcon, Download, Smartphone } from './Icons';

interface PwaInstallBannerProps {
  variant?: 'home' | 'settings';
}

/**
 * Dismissible PWA install recommendation banner/card:
 * - Android / Chrome: 1-tap native install prompt via beforeinstallprompt
 * - iOS Safari: clear Uzbek visual guide (Share -> Add to Home Screen)
 * - Hidden automatically when already running as standalone PWA or dismissed (on home screen).
 */
export function PwaInstallBanner({ variant = 'home' }: PwaInstallBannerProps) {
  const [, setTick] = useState(0);
  const [iosGuideOpen, setIosGuideOpen] = useState(variant === 'settings');
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    return subscribePwaInstallState(() => setTick((prev) => prev + 1));
  }, []);

  if (isStandaloneDisplayMode()) {
    return null;
  }
  if (variant === 'home' && isPwaBannerDismissed()) {
    return null;
  }

  const nativePrompt = getDeferredInstallPrompt();
  const isIos = isIosSafariBrowser();

  if (variant === 'home' && !nativePrompt && !isIos) {
    return null;
  }

  const handleInstallClick = async () => {
    if (installing) return;
    setInstalling(true);
    playFeedbackChime('pop');
    const outcome = await triggerNativePwaInstall();
    setInstalling(false);
    if (outcome === 'accepted') {
      playFeedbackChime('chime');
    } else if (outcome === 'unavailable' && isIos) {
      setIosGuideOpen(true);
    }
  };

  return (
    <aside
      className={`pwa-install-banner ${variant === 'settings' ? 'pwa-install-banner-settings' : ''}`}
      aria-label="Ilovani o‘rnatish tavsiyasi"
    >
      <div className="pwa-install-row">
        <span className="pwa-install-icon" aria-hidden="true">
          <Smartphone size={22} />
        </span>

        <div className="pwa-install-copy">
          <strong>Alifboni telefonga ilova sifatida o‘rnating</strong>
          <span>
            Tez ochiladi va dars payti brauzer oynasini yashirib, qulay to‘liq ekranda ishlaydi.
          </span>
        </div>

        <div className="pwa-install-actions">
          {nativePrompt ? (
            <button
              type="button"
              className="btn-3d-emerald btn-compact btn-with-icon"
              disabled={installing}
              onClick={() => void handleInstallClick()}
            >
              <Download size={15} />
              <span>{installing ? 'O‘rnatilmoqda...' : 'Ilovani o‘rnatish'}</span>
            </button>
          ) : isIos ? (
            <button
              type="button"
              className="btn-3d-emerald btn-compact"
              onClick={() => {
                playFeedbackChime('pop');
                setIosGuideOpen((prev) => !prev);
              }}
            >
              {iosGuideOpen ? 'Yo‘riqnomani yopish' : 'iPhone’ga o‘rnatish'}
            </button>
          ) : null}

          {variant === 'home' && (
            <button
              type="button"
              className="pwa-dismiss-btn"
              onClick={() => {
                playFeedbackChime('pop');
                dismissPwaBanner();
              }}
              aria-label="Tavsiyani yopish"
            >
              <CloseIcon size={16} />
            </button>
          )}
        </div>
      </div>

      {isIos && iosGuideOpen && (
        <div className="pwa-ios-guide" role="note">
          <span>
            1. Safari pastki panelidagi <strong>Ulashish (Share ⬆️)</strong> tugmasini bosing.
          </span>
          <span>
            2. Ro‘yxatdan <strong>«Bosh ekranga qo‘shish» (Add to Home Screen)</strong> ni tanlang.
          </span>
        </div>
      )}

      {variant === 'settings' && !nativePrompt && !isIos && (
        <p className="muted-text" style={{ margin: '6px 0 0', fontSize: 13 }}>
          Brauzer menyusidan (⋮ → «Ilovani o‘rnatish» / «Bosh ekranga qo‘shish») ham o‘rnatishingiz
          mumkin.
        </p>
      )}
    </aside>
  );
}
