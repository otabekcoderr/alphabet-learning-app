import { playFeedbackChime } from '../utils/audioRecorder';
import { AlertTriangle, Cloud } from './Icons';

interface GuestSaveBannerProps {
  variant?: 'compact' | 'card';
  practicedCount?: number;
  totalStars?: number;
  onSaveAccount: () => void;
}

/**
 * Informs Guest Trial users that progress is currently stored only on this device
 * and provides a direct CTA to create/sign in to a permanent account (Telegram / Google).
 */
export function GuestSaveBanner({
  variant = 'compact',
  practicedCount = 0,
  totalStars = 0,
  onSaveAccount,
}: GuestSaveBannerProps) {
  if (variant === 'compact') {
    return (
      <div className="guest-save-banner guest-save-banner-compact" role="status">
        <div className="guest-save-compact-head">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>Natijalar faqat shu qurilmada saqlanadi</span>
        </div>
        <button
          type="button"
          className="btn-3d-gold btn-compact guest-save-cta-compact"
          onClick={() => {
            playFeedbackChime('pop');
            onSaveAccount();
          }}
        >
          <Cloud size={15} aria-hidden="true" />
          <span>Hisob yaratib saqlash (Telegram / Google)</span>
        </button>
      </div>
    );
  }

  return (
    <section
      className="parent-card guest-save-banner guest-save-banner-card"
      aria-label="Sinov rejimi ogohlantirishi"
    >
      <div className="guest-save-card-copy">
        <div className="guest-save-card-title-row">
          <span className="guest-save-icon-badge" aria-hidden="true">
            <AlertTriangle size={20} />
          </span>
          <h3 className="guest-save-card-title">Natijalar faqat shu qurilmada saqlanadi</h3>
        </div>
        <p className="guest-save-card-text">
          {practicedCount > 0 || totalStars > 0
            ? `Hozircha ${practicedCount} ta so‘z va ${totalStars} ta yulduzcha saqlangan. Brauzer xotirasi tozalansa yoki boshqa telefondan kirsangiz, bu natijalar yo‘qolishi mumkin. Doimiy 8 xonali hisob ID olish va natijalarni ko‘chirish uchun hisob yarating.`
            : 'Sinov rejimida o‘quv natijalari bulutga yozilmaydi. Doimiy 8 xonali hisob ID olish va barcha natijalarni xavfsiz saqlash uchun hisob yarating.'}
        </p>
      </div>

      <button
        type="button"
        className="btn-3d-emerald btn-with-icon guest-save-cta-card"
        onClick={() => {
          playFeedbackChime('pop');
          onSaveAccount();
        }}
      >
        <Cloud size={18} aria-hidden="true" />
        <span>Hisob yaratib saqlash (Telegram / Google)</span>
      </button>
    </section>
  );
}
