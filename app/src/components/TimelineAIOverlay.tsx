import type { RefObject } from 'react';
import type { WorkflowState } from '../store/ai';

interface TimelineAIOverlayProps {
  workflow: WorkflowState;
  timelineContainerRef: RefObject<HTMLDivElement | null>;
  compactTimeline: boolean;
  onCancel: () => void;
  onRetry: () => void;
}

export function TimelineAIOverlay({
  workflow,
  timelineContainerRef: _timelineContainerRef,
  compactTimeline: _compactTimeline,
  onCancel: _onCancel,
  onRetry: _onRetry,
}: TimelineAIOverlayProps) {
  const isVisible =
    workflow.step !== 'idle' && workflow.step !== 'done' && workflow.step !== 'error';

  if (!isVisible) {
    return null;
  }

  return (
    <div
      data-editor-region="workflow-blocker"
      role="status"
      aria-live="polite"
      aria-label="AI 一键剪辑进行中，编辑器暂不可操作"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'all',
        cursor: 'progress',
        background: 'rgba(10, 10, 18, 0.28)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: 6,
          padding: '14px 18px',
          borderRadius: 16,
          border: '1px solid rgba(196, 181, 253, 0.22)',
          background:
            'linear-gradient(135deg, rgba(30, 41, 59, 0.88), rgba(46, 16, 101, 0.72))',
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.2)',
          color: '#ede9fe',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            margin: '0 auto',
            border: '2px solid rgba(237, 233, 254, 0.4)',
            borderTopColor: '#c084fc',
            borderRadius: '50%',
            animation: 'workflowBlockerSpin 0.85s linear infinite',
          }}
        />
        <div style={{ fontSize: 13, fontWeight: 600 }}>AI 一键剪辑进行中</div>
        <div style={{ fontSize: 11, color: '#ddd6fe' }}>底部状态栏可查看进度</div>
      </div>
      <style>
        {`
          @keyframes workflowBlockerSpin {
            from {
              transform: rotate(0deg);
            }

            to {
              transform: rotate(360deg);
            }
          }
        `}
      </style>
    </div>
  );
}
