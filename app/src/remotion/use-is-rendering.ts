import { getRemotionEnvironment } from 'remotion';

/** 区分预览（@remotion/player）与导出（renderMedia）环境。 */
export function useIsRendering(): boolean {
  return getRemotionEnvironment().isRendering;
}
