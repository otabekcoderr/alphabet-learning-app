import { useEffect, useRef, useState } from 'react';
import { formatAccountPublicId } from '../logic/auth';
import { playFeedbackChime } from '../utils/audioRecorder';
import { CheckIcon, CopyIcon } from './Icons';

interface AccountIdBadgeProps {
  publicId: string;
  label?: string;
  variant?: 'default' | 'compact';
}

/**
 * Displays the user's 8-digit formatted public ID (`XXXX-XXXX`) alongside a
 * clipboard copy button.
 */
export function AccountIdBadge({
  publicId,
  label = 'ID:',
  variant = 'default',
}: AccountIdBadgeProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const formattedId = formatAccountPublicId(publicId);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!formattedId) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedId);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = formattedId;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    }

    playFeedbackChime('pop');
    setCopied(true);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, 2500);
  };

  return (
    <div
      className={`account-id-row ${variant === 'compact' ? 'account-id-compact' : ''}`}
    >
      {label && <span className="muted-text account-id-label">{label}</span>}
      <code className="account-id-badge">{formattedId}</code>
      <button
        type="button"
        className="btn-3d-cream btn-compact btn-with-icon account-id-copy-btn"
        onClick={() => void handleCopy()}
        aria-label={`ID raqamini nusxalash: ${formattedId}`}
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        <span>{copied ? 'Nusxalandi!' : 'Nusxalash'}</span>
      </button>
    </div>
  );
}
