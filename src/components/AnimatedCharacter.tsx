import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { resolveMascotPresentation } from '../logic/gamification';
import { AvatarVisual } from './AvatarVisual';
import { Volume2, Sparkles } from './Icons';

export type CharacterMood =
  | 'idle'
  | 'listening'
  | 'speaking'
  | 'talking'
  | 'celebrating'
  | 'encouraging'
  | 'sleeping';

interface AnimatedCharacterProps {
  mood?: CharacterMood;
  size?: number;
  avatarId?: string;
  avatarEmoji?: string;
  name?: string;
  speechText?: string;
  onReplaySpeech?: () => void;
  layout?: 'row' | 'stacked' | 'compact';
  bubblePosition?: 'right' | 'top' | 'none';
  showNameInBubble?: boolean;
}

/**
 * Interactive 60 FPS animated Zukko Tulki (or chosen avatar) powered by Framer Motion.
 * Supports live emotional states: idle, listening, speaking/talking, celebrating, encouraging, sleeping.
 */
export function AnimatedCharacter({
  mood = 'idle',
  size = 116,
  avatarId = 'fox',
  avatarEmoji: _avatarEmoji,
  name,
  speechText,
  onReplaySpeech,
  layout = 'row',
  bubblePosition = 'right',
  showNameInBubble = false,
}: AnimatedCharacterProps) {
  const resolved = resolveMascotPresentation({ avatarId, explicitName: name });
  const normalizedMood = mood === 'talking' ? 'speaking' : mood;

  const spriteAnimate =
    normalizedMood === 'celebrating'
      ? { y: [0, -14, 0, -9, 0], rotate: [0, -6, 6, -3, 0], scale: [1, 1.08, 1] }
      : normalizedMood === 'speaking'
        ? { y: [0, -5, 0], scale: [1, 1.035, 1], rotate: [-1.5, 1.5, -1.5] }
        : normalizedMood === 'listening'
          ? { rotate: [-4.5, 4.5, -4.5], scale: [1, 1.035, 1] }
          : normalizedMood === 'encouraging'
            ? { y: [0, -3, 0], rotate: [0, 3.5, -3.5, 0] }
            : normalizedMood === 'sleeping'
              ? { y: [0, 3, 0], scale: [1, 0.96, 1] }
              : { y: [0, -6, 0], rotate: [-1.2, 1.2, -1.2] };

  const spriteTransition =
    normalizedMood === 'celebrating'
      ? { duration: 0.95, repeat: Infinity, repeatDelay: 0.4 }
      : normalizedMood === 'speaking'
        ? { duration: 0.55, repeat: Infinity, ease: 'easeInOut' as const }
        : normalizedMood === 'listening'
          ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' as const }
          : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' as const };

  const shouldRenderBubble = Boolean(speechText) && bubblePosition !== 'none';

  const bubbleNode = shouldRenderBubble && speechText ? (
    <motion.div
      key={speechText}
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 360, damping: 24 }}
      className={`zukko-speech-bubble ${
        bubblePosition === 'top' ? 'zukko-bubble-top' : 'zukko-bubble-right'
      }`}
    >
      <span className="zukko-speech-text">
        {showNameInBubble && <strong>{resolved.name}: </strong>}
        {speechText}
      </span>
      {onReplaySpeech && (
        <button
          type="button"
          className="btn-bubble-audio"
          onClick={onReplaySpeech}
          aria-label="Gapni qayta eshitish"
          title="Eshitish"
        >
          <Volume2 size={16} strokeWidth={2.5} />
        </button>
      )}
    </motion.div>
  ) : null;

  return (
    <div
      className={`animated-char-wrap layout-${layout} bubble-${bubblePosition}`}
      style={{ '--char-size': `${size}px` } as CSSProperties}
    >
      {bubblePosition === 'top' && bubbleNode}

      <div
        className={`animated-char-figure mood-${normalizedMood}`}
        aria-label={`${resolved.name} — ${normalizedMood}`}
      >
        {normalizedMood === 'listening' && (
          <>
            <motion.span
              className="zukko-listening-ring"
              animate={{ scale: [0.88, 1.28], opacity: [0.65, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
              aria-hidden="true"
            />
            <motion.span
              className="zukko-listening-ring"
              animate={{ scale: [0.88, 1.28], opacity: [0.65, 0] }}
              transition={{ duration: 1.4, delay: 0.7, repeat: Infinity, ease: 'easeOut' }}
              aria-hidden="true"
            />
          </>
        )}

        {normalizedMood === 'celebrating' && (
          <motion.span
            className="zukko-celebrate-sparkle"
            animate={{ rotate: [0, 15, -15, 0], scale: [0.9, 1.15, 0.9] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            aria-hidden="true"
          >
            <Sparkles size={22} />
          </motion.span>
        )}

        <motion.div
          className="animated-char-sprite"
          animate={spriteAnimate}
          transition={spriteTransition}
        >
          {resolved.usesFoxSvg ? (
            <img
              src="/images/zukko.webp"
              alt={resolved.name}
              width={size}
              height={size}
              draggable={false}
              className="zukko-hero-png"
            />
          ) : (
            <div className="avatar-companion-disc">
              <AvatarVisual avatarId={resolved.avatarId} size={Math.round(size * 0.72)} />
            </div>
          )}
        </motion.div>

        {normalizedMood === 'speaking' && (
          <div className="char-voice-waves" aria-hidden="true">
            <motion.span
              animate={{ scaleY: [0.4, 1.35, 0.45] }}
              transition={{ duration: 0.42, repeat: Infinity }}
            />
            <motion.span
              animate={{ scaleY: [1.2, 0.4, 1.3] }}
              transition={{ duration: 0.36, repeat: Infinity }}
            />
            <motion.span
              animate={{ scaleY: [0.45, 1.4, 0.4] }}
              transition={{ duration: 0.48, repeat: Infinity }}
            />
          </div>
        )}

        {normalizedMood === 'sleeping' && (
          <motion.span
            className="char-sleep-zzz"
            aria-hidden="true"
            animate={{ y: [0, -16], opacity: [0.95, 0] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          >
            Zzz
          </motion.span>
        )}
      </div>

      {bubblePosition === 'right' && bubbleNode}
    </div>
  );
}
