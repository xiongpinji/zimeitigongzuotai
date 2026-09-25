// 视频生成成本确认 Hook
//
// 第一期实现：使用原生 window.confirm；后续可替换为自研 Dialog。
// 用户勾选"记住选择"后，写入 localStorage，下次直接放行。

const SKIP_KEY = 'lingji.videoCardConfirm.skip';

/**
 * 返回一个 async 调用器；调用后弹出确认弹窗。
 * - 用户取消 -> resolve(false)
 * - 用户确认 -> 询问是否记住选择 -> resolve(true)
 * - 已记住选择 -> 直接 resolve(true)，不再弹窗
 */
export function useVideoGenConfirm(): () => Promise<boolean> {
  return async () => {
    if (typeof window === 'undefined') return true;
    if (window.localStorage?.getItem(SKIP_KEY) === '1') return true;
    const ok = window.confirm('将调用视频 AI 生成视频卡（耗时较长且按次计费），是否继续？');
    if (ok) {
      const remember = window.confirm('记住选择，下次不再提示？');
      if (remember) window.localStorage?.setItem(SKIP_KEY, '1');
    }
    return ok;
  };
}
