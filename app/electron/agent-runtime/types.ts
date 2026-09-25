import type { ResolvedAgentSkill } from '../acp/types';

export type StreamFormat = 'pi-rpc';

export interface BuildArgsCtx {
  prompt: string;
  cwd?: string;
  model?: string;
  /** 思考程度（reasoning effort）；'default' 表示跟随 CLI 默认，不透传。 */
  reasoning?: string;
  resumeSessionId?: string | null;
  isResuming?: boolean;
  /** 连接期解析出的启用 skills（pi --skill 用）。 */
  skills?: ResolvedAgentSkill[];
}

export interface AgentModel {
  id: string;
  label: string;
}

export interface RuntimeAgentDef {
  id: string; // 'pi'
  name: string;
  bin: string;
  /**
   * 进程内 agent：直接在主进程用 SDK 跑（无子进程 / 无需安装探测）。
   * pi 已切换为 in-process（@earendil-works/pi-coding-agent SDK），preflight 视其恒可用。
   */
  inProcess?: boolean;
  /**
   * @deprecated 旧内置 Node 入口（子进程时代用，如 'resources/pi/dist/cli.js'）。
   * in-process 后不再使用。
   */
  bundledNodeEntry?: string;
  fallbackBins?: string[];
  versionArgs: string[];
  /** @deprecated 子进程 CLI 参数组装；in-process agent 不再使用。 */
  buildArgs?: (ctx: BuildArgsCtx) => string[];
  /** @deprecated 子进程流式协议；in-process agent 不再使用。 */
  streamFormat?: StreamFormat;
  resumesSessionViaCli?: boolean;
  env?: Record<string, string>;
  defaultModel?: string;
  /** Static model list for UI selectors (settings + composer chip). */
  models?: AgentModel[];

  /** 思考程度可选项（UI 切换用）；为空表示该 agent 不支持思考程度切换。 */
  reasoningOptions?: AgentModel[];
  /** 默认思考程度 id（一般为 'default'）。 */
  defaultReasoning?: string;

  // ─── 动态模型拉取（renderer 安全：纯数据 + 纯函数；exec 全在 main 完成）───
  /** 拉取失败 / 不可用时的兜底模型列表（优于只剩 default）。 */
  fallbackModels?: AgentModel[];
  /** 拉取模型列表的 CLI 参数（如 pi 的 `['--list-models']`）。配合 parseModels 使用。 */
  listModelsArgs?: string[];
  /** 模型列表输出所在的流；部分 CLI（pi）打印到 stderr。默认 'stdout'。 */
  modelsOutputStream?: 'stdout' | 'stderr';
  /** 纯解析函数：把 CLI 输出解析为模型列表；无法解析返回 null。 */
  parseModels?: (raw: string) => AgentModel[] | null;
}
