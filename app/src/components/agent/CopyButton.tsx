/**
 * CopyButton — 复制文本到剪贴板的小图标按钮。
 *
 * 复用 macOS 专业工具风格：单色系统蓝 accent、低饱和静默态、hover 提亮。
 * 复制成功后短暂切换为 Check 图标作为反馈（1.5s 后回落）。
 * 复制走 navigator.clipboard.writeText（与 QuickActionBar 一致）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';

export interface CopyButtonProps {
  /** 待复制文本；为空时按钮禁用 */
  text: string;
  /** 额外类名（用于定位 / hover 显隐控制） */
  className?: string;
  /** 图标尺寸，默认 13 */
  size?: number;
  /** 无障碍标签，默认「复制」 */
  label?: string;
}

export function CopyButton({
  text,
  className = '',
  size = 13,
  label = '复制',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // 剪贴板不可用时静默失败，不打断会话
      });
  }, [text]);

  // 卸载时清理定时器，避免对已卸载组件 setState
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const actionLabel = copied ? '已复制' : label;

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!text}
      title={actionLabel}
      aria-label={actionLabel}
      className={`inline-flex items-center justify-center rounded-md p-1 text-mac-text-muted/60 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {copied ? <Check size={size} className="text-mac-blue" /> : <Copy size={size} />}
    </button>
  );
}
