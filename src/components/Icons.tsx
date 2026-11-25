import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  BellOff,
  BookOpen,
  Calendar,
  Check,
  Clock,
  Cloud,
  Compass,
  Copy,
  Download,
  ExternalLink,
  Flame,
  Gamepad2,
  Home,
  Lock,
  LogOut,
  MessageCircle,
  Mic,
  Moon,
  Play,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Star,
  Timer,
  Trash2,
  Trophy,
  Upload,
  Volume2,
  X,
} from 'lucide-react';

interface IconProps {
  size?: number;
  className?: string;
}

/** Crisp SVG close icon powered by Lucide (`X`). */
export function CloseIcon({ size = 18, className }: IconProps) {
  return <X size={size} strokeWidth={2.75} aria-hidden="true" className={className} />;
}

/** Crisp SVG clipboard copy icon powered by Lucide (`Copy`). */
export function CopyIcon({ size = 16, className }: IconProps) {
  return <Copy size={size} strokeWidth={2.4} aria-hidden="true" className={className} />;
}

/** Crisp SVG checkmark icon powered by Lucide (`Check`). */
export function CheckIcon({ size = 18, className }: IconProps) {
  return <Check size={size} strokeWidth={2.75} aria-hidden="true" className={className} />;
}

export {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  BellOff,
  BookOpen,
  Calendar,
  Check,
  Clock,
  Cloud,
  Compass,
  Download,
  ExternalLink,
  Flame,
  Gamepad2,
  Home,
  Lock,
  LogOut,
  MessageCircle,
  Mic,
  Moon,
  Play,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Star,
  Timer,
  Trash2,
  Trophy,
  Upload,
  Volume2,
};
