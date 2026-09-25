import { Button } from '../../ui';
import { AppIcon, type AppIconName } from '../AppIcon';
import styles from './ToolRail.module.css';

export type EditorTool = 'select' | 'crop' | 'text' | 'filter' | 'adjust' | 'transform';

interface ToolRailProps {
  activeTool: EditorTool;
  onSelectTool: (tool: EditorTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

// 说明：AppIcon 当前未内置 mouse-pointer / crop / sliders / rotate-ccw，
// 因此在工具栏场景中使用语义最接近的已注册图标，保持 darwin-ui 视觉一致
const TOOLS: Array<{ id: EditorTool; label: string; icon: AppIconName }> = [
  { id: 'select', label: '选择', icon: 'circle' },
  { id: 'crop', label: '裁剪', icon: 'scissors' },
  { id: 'text', label: '文字', icon: 'type' },
  { id: 'filter', label: '滤镜', icon: 'sparkles' },
  { id: 'adjust', label: '调色', icon: 'settings-2' },
  { id: 'transform', label: '变换', icon: 'refresh-cw' },
];

export function ToolRail({
  activeTool,
  onSelectTool,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ToolRailProps) {
  return (
    <div className={styles.rail}>
      {TOOLS.map((tool) => (
        <Button.Icon
          key={tool.id}
          variant={activeTool === tool.id ? 'primary' : 'ghost'}
          onClick={() => onSelectTool(tool.id)}
          aria-label={tool.label}
          title={tool.label}
        >
          <AppIcon name={tool.icon} size={16} />
        </Button.Icon>
      ))}
      <div className={styles.divider} />
      <Button.Icon
        variant="ghost"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="撤销"
        title="撤销"
      >
        <AppIcon name="undo-2" size={16} />
      </Button.Icon>
      <Button.Icon
        variant="ghost"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="重做"
        title="重做"
      >
        <AppIcon name="redo-2" size={16} />
      </Button.Icon>
    </div>
  );
}
