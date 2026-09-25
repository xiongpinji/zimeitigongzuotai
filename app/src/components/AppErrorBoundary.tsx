import { Component, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
  /** 用户点击「回到欢迎页」时调用；用于清理崩溃项目状态并导航回安全页面。 */
  onReset?: () => void;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * 应用级错误边界。
 *
 * 背景：页面内容区此前没有任何 ErrorBoundary，任一渲染期抛错都会让整棵 React 树卸载，
 * 只剩深色窗口背景，表现为「整窗黑屏、什么都没有」。典型触发场景是「项目已打开时切换到另一个项目」——
 * openProject 分步写入 timeline/srt/ai store，期间已挂载的 Editor / Remotion 预览会以
 * 中间不一致状态重渲染，一旦抛错就黑屏。
 *
 * 该边界把崩溃转成可见错误信息 + 恢复入口，既避免黑屏，也能暴露真正的抛错组件以便定位根因。
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    console.error('[lingji] 页面渲染崩溃', error, info.componentStack);
    this.setState({ componentStack: info.componentStack });
  }

  private handleReset = (): void => {
    this.setState({ error: null, componentStack: null });
    this.props.onReset?.();
  };

  private handleReload = (): void => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          padding: 32,
          boxSizing: 'border-box',
          overflow: 'auto',
          background: 'var(--color-window-bg)',
          color: 'var(--color-text-primary)',
        }}
      >
        <div style={{ maxWidth: 720, width: '100%' }}>
          <div style={{ fontSize: 13, letterSpacing: '0.12em', color: 'var(--color-system-blue)' }}>
            页面渲染出错
          </div>
          <h1 style={{ margin: '8px 0 4px', fontSize: 22 }}>当前页面崩溃了</h1>
          <p style={{ margin: '0 0 16px', color: 'var(--color-text-secondary)', fontSize: 13 }}>
            应用其余部分仍在运行。你可以回到欢迎页重新打开项目，或重新载入窗口。下面是错误详情（可复制反馈）。
          </p>
          <pre
            style={{
              margin: '0 0 16px',
              padding: 12,
              borderRadius: 8,
              background: 'var(--color-surface-raised, rgba(127,127,127,0.12))',
              color: 'var(--color-text-primary)',
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 320,
              overflow: 'auto',
            }}
          >
            {String(error.stack || error.message || error)}
            {componentStack ? `\n\n组件栈:${componentStack}` : ''}
          </pre>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--color-system-blue)',
                color: '#fff',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              回到欢迎页
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid var(--color-border, rgba(127,127,127,0.4))',
                background: 'transparent',
                color: 'var(--color-text-primary)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              重新载入窗口
            </button>
          </div>
        </div>
      </div>
    );
  }
}
