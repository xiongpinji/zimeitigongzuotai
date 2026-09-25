import type { PreflightCheck } from './types';
import { BinaryManager } from './binary-manager';
import type { AgentConfig } from './config';
import { normalizeAgentId } from './config';
import { getAgentDef } from '../agent-runtime/registry';
import { detectAgent, createDetectionDeps } from '../agent-runtime/detection';

/**
 * 多协议 preflight：基于 RuntimeAgentDef + detection 探测 agent CLI 是否可用。
 *
 * 返回 PreflightCheck[] 契约不变（UI 不崩）：
 *   - Node.js / npx：保留原检查（npm 托管安装/升级仍依赖它们）。
 *   - <agent bin>：用 detection.detectAgent(def, ...) 检查 CLI 是否在 PATH/可探测版本。
 *   - API Key：仅对显式配置 custom_api authMode 的 agent 提示（subscription/未配置不阻断）。
 *
 * agentId 可传旧键（claude-acp/pi-acp），内部 normalize 到 claude/codex/pi。
 */
export async function runPreflight(
  binaryManager: BinaryManager,
  config: AgentConfig,
  agentId: string,
): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  const normalizedId = normalizeAgentId(agentId);
  const def = getAgentDef(normalizedId);

  // 1. Node.js
  const nodeVersion = await binaryManager.getNodeVersion();
  if (nodeVersion) {
    checks.push({ label: 'Node.js', status: 'pass', message: nodeVersion });
  } else {
    checks.push({
      label: 'Node.js',
      status: 'fail',
      message: '未安装 Node.js',
      fixAction: 'install',
    });
  }

  // 2. npx
  const npxPath = await binaryManager.findNpxPath();
  if (npxPath) {
    checks.push({ label: 'npx', status: 'pass', message: npxPath });
  } else {
    checks.push({
      label: 'npx',
      status: 'fail',
      message: '未找到 npx',
      fixAction: 'install',
    });
  }

  // 3. Agent 探测：in-process agent（pi）内置于应用，恒可用，无需 CLI 探测。
  if (def) {
    const agentLabel = def.bin;
    if (def.inProcess) {
      checks.push({ label: agentLabel, status: 'pass', message: '内置（无需安装）' });
    } else {
      const detection = await detectAgent(def, createDetectionDeps(binaryManager));
      if (detection.installed) {
        const versionSuffix = detection.version ? ` ${detection.version}` : '';
        checks.push({
          label: agentLabel,
          status: 'pass',
          message: `${detection.binPath ?? '已安装'}${versionSuffix}`,
        });
      } else {
        checks.push({
          label: agentLabel,
          status: 'fail',
          message: `未找到 ${agentLabel}，请确认已安装并在 PATH 中`,
          fixAction: 'install',
        });
      }
    }

    // 4. API Key（仅 custom_api 模式提示；subscription/默认不阻断）
    const configData = await config.load();
    const agentEntry = configData.agents[normalizedId];
    if (agentEntry?.authMode === 'custom_api') {
      const apiKey = await config.getApiKey(normalizedId);
      if (apiKey) {
        checks.push({ label: 'API Key', status: 'pass', message: '已配置' });
      } else {
        checks.push({ label: 'API Key', status: 'warn', message: '未设置 API Key' });
      }
    } else {
      checks.push({ label: 'API Key', status: 'pass', message: '使用官方订阅 / CLI 自带凭证' });
    }
  }

  return checks;
}
