import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  createTelegramLinkDeepLinkApi,
  fetchNotificationsData,
  saveReminderSettingsApi,
  unlinkTelegramReminderApi,
  type AppNotificationAction,
  type AppNotificationItem,
  type RemoteReminderSettings,
} from '../logic/notifications';
import { playFeedbackChime } from '../utils/audioRecorder';
import { Bell, BellOff, Check, CloseIcon, ExternalLink } from './Icons';

interface TelegramReminderCardProps {
  isGuest: boolean;
  dbConfigured: boolean;
  settings: RemoteReminderSettings | null;
  onSettingsUpdated: (next: RemoteReminderSettings) => void;
  onRefreshCenter: () => Promise<void>;
  onOpenGuestUpgrade: () => void;
}

/**
 * Reusable card for managing @alifbo_uz_robot daily practice reminders
 * and linking Google/Password accounts to the Telegram bot.
 */
export function TelegramReminderCard({
  isGuest,
  dbConfigured,
  settings,
  onSettingsUpdated,
  onRefreshCenter,
  onOpenGuestUpgrade,
}: TelegramReminderCardProps) {
  const [busy, setBusy] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [waitingLink, setWaitingLink] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pollBusyRef = useRef(false);

  const botUsername = settings?.botUsername || 'alifbo_uz_robot';

  useEffect(() => {
    if (!waitingLink || isGuest) return;
    let active = true;

    const checkLinked = async () => {
      if (!active || pollBusyRef.current) return;
      pollBusyRef.current = true;
      try {
        const res = await fetchNotificationsData();
        if (!active || !res.ok || !res.settings) return;
        if (res.settings.telegramLinked && !res.settings.botBlocked && res.settings.reminderEnabled) {
          setWaitingLink(false);
          setLinkUrl(null);
          playFeedbackChime('chime');
          setStatusMsg({
            ok: true,
            text: `@${res.settings.botUsername} muvaffaqiyatli ulandi! Har kuni soat 19:00 da (Toshkent vaqti) eslatma yuboriladi.`,
          });
          onSettingsUpdated(res.settings);
          await onRefreshCenter();
        }
      } finally {
        pollBusyRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void checkLinked();
    }, 2500);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkLinked();
      }
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [waitingLink, isGuest, onSettingsUpdated, onRefreshCenter]);

  const handleToggleReminder = async () => {
    if (!settings || busy) return;
    setBusy(true);
    setStatusMsg(null);
    const nextEnabled = !settings.reminderEnabled;
    const res = await saveReminderSettingsApi({ reminderEnabled: nextEnabled });
    setBusy(false);
    if (!res.ok || !res.settings) {
      playFeedbackChime('soft-bonk');
      setStatusMsg({ ok: false, text: res.errorUz || 'O‘zgartirib bo‘lmadi.' });
      return;
    }
    playFeedbackChime('pop');
    onSettingsUpdated(res.settings);
    setStatusMsg({
      ok: true,
      text: nextEnabled
        ? 'Kunlik mashq eslatmasi yoqildi.'
        : 'Kunlik mashq eslatmasi o‘chirildi.',
    });
  };

  const handleStartConnect = async () => {
    if (busy) return;
    setBusy(true);
    setStatusMsg(null);
    const res = await createTelegramLinkDeepLinkApi();
    setBusy(false);
    if (!res.ok) {
      playFeedbackChime('soft-bonk');
      setStatusMsg({ ok: false, text: res.errorUz });
      return;
    }
    playFeedbackChime('pop');
    setLinkUrl(res.deepLink);
    setWaitingLink(true);
    const popup = window.open(res.deepLink, '_blank', 'noopener,noreferrer');
    if (!popup) {
      window.location.assign(res.deepLink);
    }
  };

  const handleUnlink = async () => {
    if (busy) return;
    setBusy(true);
    setStatusMsg(null);
    const res = await unlinkTelegramReminderApi();
    setBusy(false);
    if (!res.ok) {
      playFeedbackChime('soft-bonk');
      setStatusMsg({ ok: false, text: res.errorUz || 'Ulanishni uzib bo‘lmadi.' });
      return;
    }
    playFeedbackChime('pop');
    setWaitingLink(false);
    setLinkUrl(null);
    await onRefreshCenter();
    setStatusMsg({ ok: true, text: 'Telegram eslatmalari to‘xtatildi.' });
  };

  if (isGuest) {
    return (
      <section className="parent-card tg-reminder-card">
        <div className="tg-reminder-header">
          <div className="tg-reminder-title-wrap">
            <Bell size={19} aria-hidden="true" />
            <h3>@{botUsername} kunlik mashq eslatmasi</h3>
          </div>
        </div>
        <p className="muted-text" style={{ margin: 0 }}>
          Farzandingiz mashqni o‘tkazib yubormasligi uchun Telegram orqali kunlik eslatmalarni yoqish
          mumkin. Buning uchun avval hisob yarating.
        </p>
        <button
          type="button"
          className="btn-3d-emerald btn-compact"
          onClick={() => {
            playFeedbackChime('pop');
            onOpenGuestUpgrade();
          }}
        >
          Hisob yaratib yoqish
        </button>
      </section>
    );
  }

  if (!dbConfigured || !settings) {
    return (
      <section className="parent-card tg-reminder-card">
        <div className="tg-reminder-title-wrap">
          <Bell size={19} aria-hidden="true" />
          <h3>@{botUsername} kunlik mashq eslatmasi</h3>
        </div>
        <p className="muted-text" style={{ margin: 0 }}>
          Kunlik eslatma xizmati server ma’lumotlar bazasi ulangandan so‘ng ishlaydi.
        </p>
      </section>
    );
  }

  return (
    <section className="parent-card tg-reminder-card">
      <div className="tg-reminder-header">
        <div className="tg-reminder-title-wrap">
          {settings.reminderEnabled && settings.telegramLinked && !settings.botBlocked ? (
            <Bell size={19} aria-hidden="true" />
          ) : (
            <BellOff size={19} aria-hidden="true" />
          )}
          <h3>@{botUsername} kunlik mashq eslatmasi</h3>
        </div>
        {settings.telegramLinked && !settings.botBlocked && (
          <span className="tg-linked-pill">
            <Check size={13} strokeWidth={3} />
            <span>{settings.telegramUsername || 'Telegram ulangan'}</span>
          </span>
        )}
      </div>

      {!settings.telegramLinked || settings.botBlocked ? (
        <div className="tg-connect-box">
          <p className="muted-text" style={{ margin: 0 }}>
            {settings.botBlocked
              ? `@${botUsername} boti Telegramda to‘xtatilgan ko‘rinadi. Qayta ulash uchun botni ochib «Start» bosing.`
              : `Agar farzandingiz kun davomida mashq qilmagan bo‘lsa, @${botUsername} kechqurun ota-onaga yumshoq eslatma yuboradi.`}
          </p>

          <div className="tg-connect-actions">
            <button
              type="button"
              className="btn-3d-emerald btn-compact btn-with-icon"
              disabled={busy}
              onClick={() => void handleStartConnect()}
            >
              <ExternalLink size={15} />
              <span>{busy ? 'Havola tayyorlanmoqda...' : `@${botUsername} ni ulash`}</span>
            </button>

            {waitingLink && linkUrl && (
              <a
                href={linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-3d-cream btn-compact btn-with-icon"
              >
                <span>Botni qayta ochish</span>
              </a>
            )}
          </div>

          {waitingLink && (
            <div className="telegram-waiting-status">
              <span className="telegram-waiting-dot" aria-hidden="true" />
              <span>
                Telegramda <strong>«Start»</strong> tugmasini bosing — ulanish avtomatik tasdiqlanadi.
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="tg-settings-body">
          <div className="parent-toggle-row">
            <div className="parent-toggle-copy">
              <strong id="tg-reminder-switch-label">Kunlik mashq eslatmalari</strong>
              <p className="muted-text" style={{ margin: '4px 0 0' }}>
                Faqat bola shu kuni hali mashq qilmagan bo‘lsa yuboriladi. Ketma-ket 5 kun javob
                bo‘lmasa avtomatik pauzaga tushadi.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.reminderEnabled}
              aria-labelledby="tg-reminder-switch-label"
              disabled={busy}
              className={`parent-toggle-switch ${
                settings.reminderEnabled ? 'parent-toggle-switch-on' : ''
              }`}
              onClick={() => void handleToggleReminder()}
            >
              <span className="parent-toggle-thumb" aria-hidden="true" />
              <span className="parent-toggle-state-text">
                {settings.reminderEnabled ? 'Yoqilgan' : 'O‘chirilgan'}
              </span>
            </button>
          </div>

          <div className="tg-hour-row">
            <span className="muted-text">
              Eslatma vaqti: <strong>Har kuni soat 19:00</strong> (Toshkent vaqti)
            </span>
            <div className="tg-hour-controls">
              <button
                type="button"
                className="btn-3d-cream btn-compact"
                disabled={busy}
                onClick={() => void handleUnlink()}
              >
                Uzish
              </button>
            </div>
          </div>
        </div>
      )}

      {statusMsg && (
        <div
          className={`feedback-banner ${statusMsg.ok ? 'feedback-success' : 'feedback-gentle'}`}
          style={{ marginTop: 8 }}
        >
          {statusMsg.text}
        </div>
      )}
    </section>
  );
}

interface ParentNotificationsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  isGuest: boolean;
  dbConfigured: boolean;
  notifications: AppNotificationItem[];
  settings: RemoteReminderSettings | null;
  onSettingsUpdated: (next: RemoteReminderSettings) => void;
  onRefreshCenter: () => Promise<void>;
  onMarkAllRead: (ids: string[]) => void;
  onNotificationAction: (action: AppNotificationAction) => void;
  onOpenGuestUpgrade: () => void;
}

/**
 * Full-focus Notification Center modal for ParentCorner showing active alerts,
 * pedagogical tips, and @alifbo_uz_robot reminder controls.
 */
export function ParentNotificationsPanel({
  isOpen,
  onClose,
  isGuest,
  dbConfigured,
  notifications,
  settings,
  onSettingsUpdated,
  onRefreshCenter,
  onMarkAllRead,
  onNotificationAction,
  onOpenGuestUpgrade,
}: ParentNotificationsPanelProps) {
  if (!isOpen) return null;

  const unreadIds = notifications.filter((n) => n.unread).map((n) => n.id);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="parent-notifs-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          playFeedbackChime('pop');
          onClose();
        }
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
        className="modal-card notif-modal-card"
      >
        <div className="modal-header-row">
          <div className="modal-title-with-icon">
            <span className="modal-icon-badge" aria-hidden="true">
              <Bell size={18} />
            </span>
            <h2 id="parent-notifs-title" className="modal-title">
              Bildirishnomalar
            </h2>
          </div>

          <button
            type="button"
            className="btn-circle-close"
            onClick={() => {
              playFeedbackChime('pop');
              onClose();
            }}
            aria-label="Yopish"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="notif-modal-body">
          <TelegramReminderCard
            isGuest={isGuest}
            dbConfigured={dbConfigured}
            settings={settings}
            onSettingsUpdated={onSettingsUpdated}
            onRefreshCenter={onRefreshCenter}
            onOpenGuestUpgrade={() => {
              onClose();
              onOpenGuestUpgrade();
            }}
          />

          <div className="notif-list-header">
            <h3 className="notif-section-heading">Xabarnomalar</h3>
            {unreadIds.length > 0 && (
              <button
                type="button"
                className="btn-3d-cream btn-compact"
                onClick={() => {
                  playFeedbackChime('pop');
                  onMarkAllRead(unreadIds);
                }}
              >
                Hammasini o‘qildi qilish
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="verify-empty-state">
              <p style={{ margin: 0, fontWeight: 700 }}>
                Hozircha yangi bildirishnomalar yo‘q — hammasi joyida!
              </p>
            </div>
          ) : (
            <div className="notif-panel-list">
              {notifications.map((item) => (
                <article
                  key={item.id}
                  className={`notif-item-card ${
                    item.unread ? 'notif-item-unread' : ''
                  } ${item.priority === 'high' ? 'notif-item-high' : ''}`}
                >
                  <div className="notif-item-top">
                    <strong className="notif-item-title">{item.titleUz}</strong>
                    {item.unread && <span className="notif-new-pill">Yangi</span>}
                  </div>
                  <p className="notif-item-body">{item.bodyUz}</p>
                  {item.ctaAction && item.ctaLabelUz && (
                    <button
                      type="button"
                      className="btn-3d-cream btn-compact notif-item-cta"
                      onClick={() => {
                        playFeedbackChime('pop');
                        onClose();
                        onNotificationAction(item.ctaAction!);
                      }}
                    >
                      {item.ctaLabelUz}
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
