export type WindowCloseAction = 'close-project' | 'allow-window-close';

interface WindowCloseContext {
  hasProject: boolean;
  isAppQuitting: boolean;
}

/**
 * 统一管理窗口关闭行为：
 * - 正常点红点时，有工程则先关闭工程并回到欢迎页
 * - 真正退出应用时，保持原生关闭流程
 */
export function resolveWindowCloseAction({
  hasProject,
  isAppQuitting,
}: WindowCloseContext): WindowCloseAction {
  if (isAppQuitting) {
    return 'allow-window-close';
  }

  if (hasProject) {
    return 'close-project';
  }

  return 'allow-window-close';
}
