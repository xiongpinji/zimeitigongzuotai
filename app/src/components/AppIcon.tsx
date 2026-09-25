import type { SVGProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowUpToLine,
  Bold,
  BookOpenText,
  Brain,
  ChartColumnIncreasing,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheckBig,
  Clipboard,
  Copy,
  Eye,
  FileText,
  Film,
  FolderOpen,
  Gauge,
  Image,
  Italic,
  LayoutTemplate,
  Layers,
  Lightbulb,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  Monitor,
  Music,
  Pause,
  PencilLine,
  Play,
  Plus,
  Quote,
  Redo2,
  RefreshCw,
  Save,
  Scissors,
  SendHorizontal,
  Settings,
  Settings2,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Type,
  Underline,
  Undo2,
  Upload,
  Volume1,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type AppIconName =
  | 'alert-circle'
  | 'align-center'
  | 'align-left'
  | 'align-right'
  | 'arrow-up-to-line'
  | 'book-open-text'
  | 'bold'
  | 'brain'
  | 'chart-column'
  | 'chevron-down'
  | 'chevron-right'
  | 'circle'
  | 'circle-check-big'
  | 'clipboard'
  | 'copy'
  | 'eye'
  | 'file-text'
  | 'film'
  | 'folder-open'
  | 'gauge'
  | 'image'
  | 'italic'
  | 'layout-template'
  | 'layers'
  | 'lightbulb'
  | 'lock'
  | 'lock-open'
  | 'maximize-2'
  | 'minimize-2'
  | 'monitor'
  | 'music'
  | 'pause'
  | 'pencil-line'
  | 'play'
  | 'plus'
  | 'quote'
  | 'redo-2'
  | 'refresh-cw'
  | 'save'
  | 'scissors'
  | 'send-horizontal'
  | 'settings'
  | 'settings-2'
  | 'skip-back'
  | 'skip-forward'
  | 'sparkles'
  | 'trash-2'
  | 'type'
  | 'underline'
  | 'undo-2'
  | 'upload'
  | 'volume-1'
  | 'volume-2'
  | 'volume-x'
  | 'x'
  | 'zoom-in'
  | 'zoom-out';

interface AppIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  name: AppIconName;
  size?: number;
}

const lucideIconMap: Partial<Record<AppIconName, LucideIcon>> = {
  'alert-circle': CircleAlert,
  'align-center': AlignCenter,
  'align-left': AlignLeft,
  'align-right': AlignRight,
  'arrow-up-to-line': ArrowUpToLine,
  'book-open-text': BookOpenText,
  bold: Bold,
  brain: Brain,
  'chart-column': ChartColumnIncreasing,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  circle: Circle,
  'circle-check-big': CircleCheckBig,
  clipboard: Clipboard,
  copy: Copy,
  eye: Eye,
  'file-text': FileText,
  film: Film,
  'folder-open': FolderOpen,
  gauge: Gauge,
  image: Image,
  italic: Italic,
  'layout-template': LayoutTemplate,
  layers: Layers,
  lightbulb: Lightbulb,
  lock: Lock,
  'lock-open': LockOpen,
  'maximize-2': Maximize2,
  'minimize-2': Minimize2,
  monitor: Monitor,
  music: Music,
  pause: Pause,
  'pencil-line': PencilLine,
  play: Play,
  plus: Plus,
  quote: Quote,
  'redo-2': Redo2,
  'refresh-cw': RefreshCw,
  save: Save,
  scissors: Scissors,
  'send-horizontal': SendHorizontal,
  settings: Settings,
  'settings-2': Settings2,
  'skip-back': SkipBack,
  'skip-forward': SkipForward,
  sparkles: Sparkles,
  'trash-2': Trash2,
  type: Type,
  underline: Underline,
  'undo-2': Undo2,
  upload: Upload,
  'volume-1': Volume1,
  'volume-2': Volume2,
  'volume-x': VolumeX,
  x: X,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
};

export function AppIcon({ name, size = 16, ...props }: AppIconProps) {
  const LucideIcon = lucideIconMap[name];
  if (!LucideIcon) {
    return null;
  }

  return <LucideIcon size={size} strokeWidth={1.9} aria-hidden="true" {...props} />;
}
