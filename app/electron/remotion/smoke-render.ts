import * as React from 'react';
import * as JsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Remotion from 'remotion';
import { compileCardTsx } from './compile-card-node';

export interface SmokeRenderResult {
  ok: boolean;
  error?: string;
}

const SMOKE_DURATION_IN_FRAMES = 150;

/**
 * 构造一份只覆盖 useCurrentFrame / useVideoConfig 的 Remotion 垫片：
 * 真实 remotion 的这两个 hook 在 Composition 上下文外会抛错，
 * 而我们要在生成期"裸渲染"卡片，因此必须用固定值覆盖。
 * 其余 interpolate / spring / Easing / AbsoluteFill / Sequence 等保持真实实现。
 */
function makeRemotionShim(frame: number): typeof Remotion {
  return {
    ...Remotion,
    useCurrentFrame: () => frame,
    useVideoConfig: () => ({
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: SMOKE_DURATION_IN_FRAMES,
      id: 'smoke',
      defaultProps: {},
      props: {},
    }),
  } as unknown as typeof Remotion;
}

/**
 * 求值主进程 esbuild 编译出的卡片 CJS 模块，返回其 default 导出的组件。
 * 与 src/remotion/card-host.tsx 的 evalCardComponent 对齐：react / react/jsx-runtime 注入宿主实例，
 * remotion 注入带固定 frame/config 的垫片，使 useCurrentFrame 等可在 Composition 上下文外正常工作。
 */
function evalCardComponent(
  compiledJs: string,
  frame: number,
): React.ComponentType<Record<string, unknown>> | null {
  if (!compiledJs.trim()) return null;
  const remotionShim = makeRemotionShim(frame);
  const requireShim = (id: string): unknown => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return JsxRuntime;
    if (id === 'remotion') return remotionShim;
    throw new Error(`Motion Card 不允许引用模块：${id}`);
  };
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  // eslint-disable-next-line no-new-func
  const factory = new Function('require', 'module', 'exports', compiledJs);
  factory(requireShim, moduleObj, moduleObj.exports);
  const exported = moduleObj.exports as { default?: unknown };
  return (exported.default as React.ComponentType<Record<string, unknown>>) ?? null;
}

/**
 * 生成期"冒烟渲染"：编译并实际渲染一次卡片组件（帧 0 与末帧）。
 * 捕获"能编译但渲染即崩"的运行时错误（如引用未声明变量、render 内抛错），
 * 让上层把这类卡片当作生成失败并触发重试，避免坏卡片落库。
 */
export async function smokeRenderCardTsx(tsx: string): Promise<SmokeRenderResult> {
  const compiled = await compileCardTsx('smoke', tsx);
  if (compiled.error || !compiled.js) {
    return { ok: false, error: compiled.error ?? 'Motion Card 编译产物为空' };
  }

  const frames = [0, SMOKE_DURATION_IN_FRAMES - 1];
  for (const frame of frames) {
    try {
      const Comp = evalCardComponent(compiled.js, frame);
      if (!Comp) {
        return { ok: false, error: 'Motion Card 未导出可渲染组件' };
      }
      // 与 CardHost 渲染契约对齐：注入 cues（空数组走逐句揭示的兜底分支）。
      renderToStaticMarkup(React.createElement(Comp, { cues: [] as number[] }));
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: true };
}

/**
 * 生成期断言卡片可渲染；不可渲染时抛出带"请重新生成"后缀的错误，
 * 由 LLM 重试循环捕获并把错误作为提示反馈给模型。
 */
export async function assertCardRenders(tsx: string): Promise<void> {
  const result = await smokeRenderCardTsx(tsx);
  if (!result.ok) {
    throw new Error(`Motion Card 渲染校验失败：${result.error}；请重新生成`);
  }
}
