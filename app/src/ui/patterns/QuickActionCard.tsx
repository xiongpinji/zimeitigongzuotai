import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './QuickActionCard.module.css';

export interface QuickActionCardProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  icon: ReactNode;
  label: string;
}

/**
 * 快捷操作卡：Setup 首屏的入口按钮（AI 写稿 / 导入音频 / 抖音导入等）。
 * 竖排布局，顶部图标方块 + 底部文字标签，hover 时边框高亮系统蓝。
 */
export function QuickActionCard({
  className,
  disabled,
  icon,
  label,
  type = 'button',
  ...rest
}: QuickActionCardProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={joinClassNames(styles.root, disabled ? styles.disabled : '', className)}
      {...rest}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.label}>{label}</span>
    </button>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}
