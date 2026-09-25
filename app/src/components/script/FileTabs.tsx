import { FileText, Film, X } from 'lucide-react';
import { m, LayoutGroup } from 'framer-motion';
import { isVideoImportPreviewFile } from '../../lib/video-import-preview';
import { springs } from '../../ui/lib/motion';
import { Button } from '../../ui';
import { VersionDropdown } from './VersionDropdown';

interface FileTabsProps {
  tabs: string[];
  openedFile: string | null;
  fileDirtyMap: Record<string, boolean>;
  fileConflictMap: Record<string, boolean>;
  onOpenFile: (file: string) => void;
  onCloseTab?: (file: string) => void;
  onTabContextMenu?: (file: string) => void;
}

export function FileTabs({
  tabs,
  openedFile,
  fileDirtyMap,
  fileConflictMap,
  onOpenFile,
  onCloseTab,
  onTabContextMenu,
}: FileTabsProps) {
  if (!tabs.length) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 1,
        padding: '0 12px',
        borderBottom: '1px solid var(--color-border-subtle)',
        background: 'var(--color-window-bg)',
      }}
    >
      <LayoutGroup id="file-tabs">
      {tabs.map((tab) => {
        const active = tab === openedFile;
        const dirty = fileDirtyMap[tab];
        const conflict = fileConflictMap[tab];
        const previewFile = isVideoImportPreviewFile(tab);

        return (
          <div
            key={tab}
            onContextMenu={(event) => {
              event.preventDefault();
              onTabContextMenu?.(tab);
            }}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              borderBottom: '2px solid transparent',
            }}
          >
            {active && (
              <>
                <m.span
                  layoutId="file-tab-bg"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                      'color-mix(in srgb, var(--color-selection-blue, #0a84ff) 10%, transparent)',
                    pointerEvents: 'none',
                  }}
                  transition={springs.swift}
                />
                <m.span
                  layoutId="file-tab-underline"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: -2,
                    height: 2,
                    background: 'var(--color-selection-blue, #0a84ff)',
                    pointerEvents: 'none',
                  }}
                  transition={springs.swift}
                />
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenFile(tab)}
              className="!bg-transparent hover:!bg-transparent !p-0 !h-auto !rounded-none"
              style={{
                position: 'relative',
                zIndex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 4px 10px 12px',
                color: active
                  ? 'var(--color-selection-blue, #0a84ff)'
                  : 'var(--color-text-secondary)',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {previewFile ? <Film size={14} /> : <FileText size={14} />}
              <span>{tab}</span>
              {dirty ? (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: 'var(--color-brand-warm, #ff9f0a)',
                    flexShrink: 0,
                  }}
                />
              ) : null}
              {conflict ? (
                <span style={{ color: 'var(--color-danger, #ff453a)', fontSize: 11 }}>⚠</span>
              ) : null}
            </Button>

            {onCloseTab && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                iconOnly
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab);
                }}
                title="关闭标签"
                aria-label="关闭标签"
                className="!bg-transparent hover:!bg-white/10 !rounded !h-5 !w-5 !min-w-0 !p-0"
                style={{
                  position: 'relative',
                  zIndex: 1,
                  marginRight: 4,
                  color: active
                    ? 'var(--color-selection-blue, #0a84ff)'
                    : 'var(--color-text-tertiary, #636366)',
                  opacity: 0.6,
                }}
              >
                <X size={12} />
              </Button>
            )}
          </div>
        );
      })}
      </LayoutGroup>

      {/* 版本历史下拉：仅在查看 script.md 时挂载，避免无意义重渲染 */}
      {openedFile === 'script.md' ? (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <VersionDropdown />
        </div>
      ) : null}
    </div>
  );
}
