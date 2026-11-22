import { getAvatarOption } from '../logic/gamification';
import { GameVisual } from './GameVisual';
import { MascotSvg } from './MascotSvg';

interface AvatarVisualProps {
  avatarId: string;
  size?: number;
  className?: string;
}

/**
 * Unified avatar renderer shared across SignUp, Child Profile, Parent Settings,
 * and Mascot screens so every chosen character renders consistently.
 */
export function AvatarVisual({ avatarId, size = 36, className = '' }: AvatarVisualProps) {
  const option = getAvatarOption(avatarId);

  if (option.id === 'fox') {
    return <MascotSvg size={size} className={className} />;
  }

  return (
    <GameVisual
      emoji={option.emoji}
      alt={option.label}
      size={size}
      className={className}
    />
  );
}
