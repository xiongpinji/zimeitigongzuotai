import { Film, PenLine, Upload } from 'lucide-react';
import { m, LayoutGroup } from 'framer-motion';
import type { AppPage } from '../lib/electron-api';
import { springs } from '../ui/lib/motion';
import { Button } from '../ui';
import styles from './WorkspaceTabs.module.css';

type WorkspaceTab = 'script-workbench' | 'editor' | 'publish';

interface WorkspaceTabsProps {
  active: WorkspaceTab;
  onSwitch: (tab: WorkspaceTab) => void;
  /** script.md 整体进度：null 表示无稿件（隐藏圆环），50 = 已生成未审，100 = 审稿完成 */
  scriptProgress?: number | null;
}

// SVG 进度圆环，r=5 circumference≈31.42
const RING_R = 5;
const RING_C = 2 * Math.PI * RING_R;

function ScriptProgressRing({ progress }: { progress: number }) {
  const done = progress >= 100;
  const dashoffset = RING_C * (1 - progress / 100);
  const color = done ? '#34d399' : 'var(--color-text-tertiary, #636366)';

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      style={{ flexShrink: 0, transition: 'opacity 0.2s' }}
      aria-label={done ? '写稿已完成' : '写稿进行中'}
    >
      {/* 背景轨道 */}
      <circle
        cx="7"
        cy="7"
        r={RING_R}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.15"
      />
      {/* 进度弧 */}
      <circle
        cx="7"
        cy="7"
        r={RING_R}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={RING_C}
        strokeDashoffset={dashoffset}
        strokeLinecap="round"
        transform="rotate(-90 7 7)"
        style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.3s ease' }}
      />
      {/* 完成勾号 */}
      {done && (
        <polyline
          points="4.5,7 6.2,8.8 9.5,5.5"
          fill="none"
          stroke="#34d399"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

const tabs: { key: WorkspaceTab; label: string; icon: React.ReactNode; page: AppPage }[] = [
  { key: 'script-workbench', label: '写稿工作台', icon: <PenLine />, page: 'script-workbench' },
  { key: 'editor', label: '视频编辑器', icon: <Film />, page: 'editor' },
  { key: 'publish', label: '发布', icon: <Upload />, page: 'publish' },
];

export function WorkspaceTabs({ active, onSwitch, scriptProgress }: WorkspaceTabsProps) {
  return (
    <nav className={styles.root}>
      <LayoutGroup id="workspace-tabs">
        {tabs.map((tab, i) => {
          const isActive = active === tab.key;
          return (
            <span key={tab.key} style={{ display: 'contents' }}>
              {i > 0 && <span className={styles.separator} />}
              <Button
                variant="ghost"
                type="button"
                className={`${styles.tab} ${isActive ? styles.active : ''}`}
                onClick={() => onSwitch(tab.key)}
              >
                {isActive && (
                  <>
                    <m.span
                      layoutId="workspace-tab-bg"
                      className={styles.tabBg}
                      transition={springs.swift}
                    />
                    <m.span
                      layoutId="workspace-tab-underline"
                      className={styles.tabUnderline}
                      transition={springs.swift}
                    />
                  </>
                )}
                <span className={styles.tabContent}>
                  <span className={styles.icon}>{tab.icon}</span>
                  {tab.label}
                  {tab.key === 'script-workbench' && scriptProgress != null && (
                    <ScriptProgressRing progress={scriptProgress} />
                  )}
                </span>
              </Button>
            </span>
          );
        })}
      </LayoutGroup>
    </nav>
  );
}
