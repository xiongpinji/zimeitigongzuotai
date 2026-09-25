/** 设置：转录已固定走 bcut（零配置）；本页配置摘要/分析的 LLM Provider（预设 + 多 Provider + 默认选择）。 */
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DouyinClient } from '@/client';
import type { AiSettingsView, LlmProviderInput } from '@/domain/api-types';
import type { LlmProtocol } from '@/domain/models';
import { SonarException } from '@/domain/errors';
import { LLM_PROVIDER_PRESETS, findLlmPreset } from '@/processing/provider-presets';
import { S } from '@/ui/theme';
import { Hover } from '@/ui/kit';

type ProviderRow = {
  id: string;
  name: string;
  protocol: LlmProtocol;
  baseUrl: string;
  models: string[];
  presetId?: string;
  /** 用户新输入的 Key；为空表示沿用既有（hasApiKey 标记是否已存在）。 */
  apiKey: string;
  hasApiKey: boolean;
  apiKeyMasked?: string;
};

function rowsFromView(v: AiSettingsView): ProviderRow[] {
  return v.llm.providers.map((p) => ({
    id: p.id,
    name: p.name,
    protocol: p.protocol,
    baseUrl: p.baseUrl,
    models: p.models,
    apiKey: '',
    hasApiKey: p.hasApiKey,
    ...(p.presetId !== undefined ? { presetId: p.presetId } : {}),
    ...(p.apiKeyMasked !== undefined ? { apiKeyMasked: p.apiKeyMasked } : {}),
  }));
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export function SettingsPanel({ client }: { client: DouyinClient }) {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [temperature, setTemperature] = useState('');
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [presetToAdd, setPresetToAdd] = useState(LLM_PROVIDER_PRESETS[0]?.id ?? '');
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    client.getAiSettings().then((v) => {
      setProviders(rowsFromView(v));
      setDefaultProviderId(v.llm.defaultProviderId ?? v.llm.providers[0]?.id ?? '');
      setDefaultModel(v.llm.defaultModel ?? v.llm.providers[0]?.models[0] ?? '');
      setTemperature(v.llm.temperature !== undefined ? String(v.llm.temperature) : '');
      setAutoAnalyze(v.autoAnalyze);
    });
  useEffect(() => {
    void load();
  }, []);

  const defaultProvider = useMemo(
    () => providers.find((p) => p.id === defaultProviderId) ?? providers[0],
    [providers, defaultProviderId],
  );

  const patchProvider = (id: string, patch: Partial<ProviderRow>) =>
    setProviders((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addPreset = () => {
    const preset = findLlmPreset(presetToAdd);
    if (!preset) return;
    const id = uniqueId(preset.id, new Set(providers.map((p) => p.id)));
    const row: ProviderRow = {
      id,
      name: preset.providerName,
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      models: preset.models,
      presetId: preset.id,
      apiKey: '',
      hasApiKey: false,
    };
    setProviders((list) => [...list, row]);
    if (!defaultProviderId) {
      setDefaultProviderId(id);
      setDefaultModel(preset.models[0] ?? '');
    }
  };

  const addCustom = () => {
    const id = uniqueId('custom', new Set(providers.map((p) => p.id)));
    const row: ProviderRow = {
      id,
      name: '自定义 Provider',
      protocol: 'openai',
      baseUrl: '',
      models: [],
      apiKey: '',
      hasApiKey: false,
    };
    setProviders((list) => [...list, row]);
    if (!defaultProviderId) setDefaultProviderId(id);
  };

  // 编辑某 Provider 的模型列表（逗号/换行分隔 → 去空去重）。若改的是默认 Provider 且当前默认
  // 模型已不在新列表中，回落到首个，避免保存出一个列表里没有的默认模型。
  const setModels = (id: string, raw: string) => {
    const models = Array.from(
      new Set(
        raw
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
    patchProvider(id, { models });
    if (id === (defaultProviderId || providers[0]?.id) && !models.includes(defaultModel)) {
      setDefaultModel(models[0] ?? '');
    }
  };

  const removeProvider = (id: string) => {
    setProviders((list) => {
      const next = list.filter((p) => p.id !== id);
      if (id === defaultProviderId) {
        const fallback = next[0];
        setDefaultProviderId(fallback?.id ?? '');
        setDefaultModel(fallback?.models[0] ?? '');
      }
      return next;
    });
  };

  const chooseDefault = (id: string) => {
    setDefaultProviderId(id);
    const p = providers.find((x) => x.id === id);
    if (p && !p.models.includes(defaultModel)) setDefaultModel(p.models[0] ?? '');
  };

  const save = async () => {
    setMsg(null);
    try {
      const payload: LlmProviderInput[] = providers.map((p) => ({
        id: p.id,
        name: p.name,
        protocol: p.protocol,
        baseUrl: p.baseUrl,
        models: p.models,
        ...(p.presetId !== undefined ? { presetId: p.presetId } : {}),
        ...(p.apiKey ? { apiKey: p.apiKey } : {}),
      }));
      await client.updateAiSettings({
        llm: {
          providers: payload,
          defaultProviderId,
          defaultModel,
          ...(temperature ? { temperature: Number(temperature) } : {}),
        },
        // 已移除显式数据发送确认勾选项：配置并使用即视为知晓数据发送。
        dataSendConsent: true,
        autoAnalyze,
      });
      await load();
      setMsg('已保存');
    } catch (e) {
      setMsg(e instanceof SonarException ? e.error.message : String(e));
    }
  };

  const test = async () => {
    setMsg('测试默认 Provider…（请先保存）');
    try {
      const r = await client.testAiProvider({ target: 'summary' });
      setMsg(r.ok ? `连通正常（${r.latencyMs ?? '?'}ms）` : `失败：${r.error?.message}`);
    } catch (e) {
      setMsg(e instanceof SonarException ? e.error.message : String(e));
    }
  };

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: S.shell }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '22px 32px 60px' }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 21, fontWeight: 700, color: S.white, letterSpacing: '-.2px' }}>
            设置
          </div>
          <div style={{ fontSize: 12.5, color: S.faint, marginTop: 3 }}>
            Provider 与数据发送由你掌控；API Key 仅存本地、不进同步、不写日志。
          </div>
        </div>

        <Section title="转录 ASR">
          <div style={{ fontSize: 12.5, color: S.c8, lineHeight: 1.7 }}>
            转录已内置使用 <b style={{ color: S.f0 }}>必剪（bcut）</b> 免费服务，无需配置。
            音频会上传到 B 站接口完成转录，请在下方知悉并勾选数据发送确认。
          </div>
        </Section>

        <Section
          title="AI Provider（摘要 / 分析）"
          ok={providers.length > 0 && Boolean(defaultProvider?.hasApiKey || defaultProvider?.apiKey)}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <select style={sel} value={presetToAdd} onChange={(e) => setPresetToAdd(e.target.value)}>
              {LLM_PROVIDER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}（{p.protocol}）
                </option>
              ))}
            </select>
            <Hover
              base={addBtn}
              hover={{ background: 'rgba(255,255,255,.12)' }}
              onClick={addPreset}
            >
              + 添加预设
            </Hover>
            <Hover
              base={addBtn}
              hover={{ background: 'rgba(255,255,255,.12)' }}
              onClick={addCustom}
            >
              + 自定义
            </Hover>
          </div>

          {providers.length === 0 && (
            <div style={{ fontSize: 12.5, color: S.faint }}>
              还没有 Provider。从上方选择厂商预设并添加，填入 API Key 即可使用。
            </div>
          )}

          {providers.map((p) => {
            const preset = findLlmPreset(p.presetId);
            const isDefault = p.id === (defaultProviderId || providers[0]?.id);
            return (
              <div key={p.id} style={providerCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      checked={isDefault}
                      onChange={() => chooseDefault(p.id)}
                      style={{ accentColor: S.accent }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 600, color: S.f0 }}>{p.name}</span>
                  </label>
                  <span style={badge}>{p.protocol}</span>
                  {isDefault && <span style={{ fontSize: 11, color: S.green }}>默认</span>}
                  <span style={{ flex: 1 }} />
                  <Hover
                    base={removeBtn}
                    hover={{ color: '#ff6b6b', borderColor: 'rgba(255,107,107,.4)' }}
                    onClick={() => removeProvider(p.id)}
                  >
                    移除
                  </Hover>
                </div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={fieldLabel}>名称</div>
                    <input
                      style={inp}
                      value={p.name}
                      onChange={(e) => patchProvider(p.id, { name: e.target.value })}
                    />
                  </div>
                  <div style={{ width: 150 }}>
                    <div style={fieldLabel}>协议</div>
                    <select
                      style={sel}
                      value={p.protocol}
                      onChange={(e) => patchProvider(p.id, { protocol: e.target.value as LlmProtocol })}
                    >
                      <option value="openai">openai</option>
                      <option value="anthropic">anthropic</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={fieldLabel}>Base URL</div>
                  <input
                    style={inp}
                    value={p.baseUrl}
                    placeholder="https://api.example.com/v1"
                    onChange={(e) => patchProvider(p.id, { baseUrl: e.target.value })}
                  />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={fieldLabel}>模型（逗号或换行分隔，可填多个）</div>
                  <textarea
                    style={{ ...inp, height: 'auto', minHeight: 56, padding: '8px 12px', lineHeight: 1.6, resize: 'vertical', fontFamily: S.mono }}
                    value={p.models.join('\n')}
                    placeholder={preset?.models.join('\n') ?? 'gpt-4o\ngpt-4o-mini'}
                    onChange={(e) => setModels(p.id, e.target.value)}
                  />
                </div>
                <div>
                  <div style={fieldLabel}>API Key</div>
                  <input
                    style={inp}
                    type="password"
                    value={p.apiKey}
                    placeholder={p.apiKeyMasked ?? preset?.apiKeyPlaceholder ?? 'sk-…'}
                    onChange={(e) => patchProvider(p.id, { apiKey: e.target.value })}
                  />
                </div>
              </div>
            );
          })}

          {providers.length > 0 && (
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <div style={{ flex: 1 }}>
                <div style={fieldLabel}>默认模型</div>
                <select
                  style={sel}
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                >
                  {(defaultProvider?.models ?? []).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ width: 140 }}>
                <div style={fieldLabel}>Temperature</div>
                <input
                  style={inp}
                  value={temperature}
                  placeholder="0.3"
                  onChange={(e) => setTemperature(e.target.value)}
                />
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <TestButton onClick={test} />
          </div>
        </Section>

        <Section title="数据与自动化">
          <Check
            checked={autoAnalyze}
            onChange={setAutoAnalyze}
            text="自动分析新视频（需先完成 AI Provider 配置）"
          />
        </Section>

        <BridgeSettingsSection client={client} />

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
          <Hover
            base={{
              height: 36,
              padding: '0 18px',
              background: S.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 9,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            hover={{ filter: 'brightness(1.1)' }}
            onClick={save}
          >
            保存设置
          </Hover>
          {msg && <span style={{ fontSize: 12, color: S.dim }}>{msg}</span>}
        </div>

        <div style={{ fontSize: 11.5, color: S.faint3, lineHeight: 1.7, marginTop: 22 }}>
          监听周期、下载目录模板、存储清理与脱敏诊断日志等配置项，将随后端能力逐步接入本页。
        </div>
      </div>
    </div>
  );
}

function Section({ title, ok, children }: { title: string; ok?: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: S.card,
        border: '.5px solid rgba(255,255,255,.07)',
        borderRadius: 13,
        padding: '16px 18px',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: S.f0 }}>{title}</span>
        {ok && <span style={{ fontSize: 11, color: S.green }}>✓ 已配置</span>}
      </div>
      {children}
    </div>
  );
}

/** 灵机剪影联动（桥）设置：端点 / token / 开关 / 测试连接。独立加载与保存。 */
function BridgeSettingsSection({ client }: { client: DouyinClient }) {
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:19820');
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [tokenMasked, setTokenMasked] = useState<string | undefined>(undefined);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    client.getBridgeSettings().then((v) => {
      setEnabled(v.enabled);
      setEndpoint(v.endpoint);
      setHasToken(v.hasToken);
      setTokenMasked(v.tokenMasked);
      setToken('');
    });
  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    try {
      await client.updateBridgeSettings({ enabled, endpoint, ...(token ? { token } : {}) });
      await load();
      setMsg('已保存');
    } catch (e) {
      setMsg(e instanceof SonarException ? e.error.message : String(e));
    }
  };

  const test = async () => {
    setMsg('测试连接…（请先保存）');
    try {
      const r = await client.testBridge();
      setMsg(r.ok ? `连通正常${r.version ? `（v${r.version}）` : ''}` : '未连通：请确认灵机剪影已启动');
    } catch (e) {
      setMsg(e instanceof SonarException ? e.error.message : String(e));
    }
  };

  const connect = async () => {
    setMsg('正在连接灵机剪影…');
    try {
      const r = await client.autoConnectBridge();
      if (r.ok) {
        setEnabled(r.settings.enabled);
        setEndpoint(r.settings.endpoint);
        setHasToken(r.settings.hasToken);
        setTokenMasked(r.settings.tokenMasked);
        setToken('');
        setMsg('已连接灵机剪影 ✓ 无需手动填写');
      } else {
        setMsg('未检测到灵机剪影：请先启动桌面端（确保已打开应用）');
      }
    } catch (e) {
      setMsg(e instanceof SonarException ? e.error.message : String(e));
    }
  };

  return (
    <Section title="灵机剪影联动" ok={enabled && hasToken}>
      <div style={{ fontSize: 12.5, color: S.c8, lineHeight: 1.7, marginBottom: 12 }}>
        发现并转录新作品后，自动把转录稿推送到灵机剪影「待创作箱」做二创初稿。
        <b style={{ color: S.f0 }}>启动灵机剪影后，点下方「一键连接」即可，无需手动填写。</b>
      </div>
      <div style={{ marginBottom: 14 }}>
        <Hover
          base={{
            height: 38,
            padding: '0 18px',
            background: S.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 9,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
          hover={{ filter: 'brightness(1.1)' }}
          onClick={connect}
        >
          🔗 一键连接灵机剪影
        </Hover>
      </div>
      <div style={{ fontSize: 11.5, color: S.faint, marginBottom: 12 }}>
        手动填写（一般不需要）：端点与 token 也可在灵机剪影欢迎页「待创作箱 → 桥配置」查看。
      </div>
      <Check
        checked={enabled}
        onChange={setEnabled}
        text="开启联动（转录完成后推送到灵机剪影）"
      />
      <div style={{ marginBottom: 10 }}>
        <div style={fieldLabel}>端点</div>
        <input
          style={inp}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="http://127.0.0.1:19820"
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={fieldLabel}>
          Token{hasToken ? `（已保存 ${tokenMasked ?? ''}，留空不变）` : ''}
        </div>
        <input
          style={inp}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={hasToken ? '••••（留空沿用既有）' : '从灵机剪影复制 token'}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Hover
          base={{
            height: 32,
            padding: '0 15px',
            background: S.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
          }}
          hover={{ filter: 'brightness(1.1)' }}
          onClick={save}
        >
          保存
        </Hover>
        <TestButton onClick={test} />
        {msg && <span style={{ fontSize: 12, color: S.dim }}>{msg}</span>}
      </div>
    </Section>
  );
}

function TestButton({ onClick }: { onClick: () => void }) {
  return (
    <Hover
      base={{
        height: 30,
        padding: '0 13px',
        background: 'rgba(255,255,255,.06)',
        color: S.cf,
        border: '.5px solid rgba(255,255,255,.09)',
        borderRadius: 8,
        fontSize: 12,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
      }}
      hover={{ background: 'rgba(255,255,255,.12)' }}
      onClick={onClick}
    >
      测试连通
    </Hover>
  );
}

function Check({
  checked,
  onChange,
  text,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  text: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 9,
        alignItems: 'center',
        fontSize: 13,
        color: S.c8,
        marginBottom: 10,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: S.accent }}
      />
      {text}
    </label>
  );
}

const fieldLabel: CSSProperties = { fontSize: 12, color: S.dim, marginBottom: 6 };
const inp: CSSProperties = {
  width: '100%',
  height: 36,
  background: S.inputBg,
  border: '.5px solid rgba(255,255,255,.12)',
  borderRadius: 9,
  color: S.white,
  fontSize: 13,
  padding: '0 12px',
  outline: 'none',
  boxSizing: 'border-box',
};
const sel: CSSProperties = { ...inp, flex: 1, appearance: 'none' };
const addBtn: CSSProperties = {
  height: 36,
  padding: '0 14px',
  background: 'rgba(255,255,255,.06)',
  color: S.cf,
  border: '.5px solid rgba(255,255,255,.09)',
  borderRadius: 9,
  fontSize: 12.5,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  whiteSpace: 'nowrap',
};
const providerCard: CSSProperties = {
  background: 'rgba(255,255,255,.03)',
  border: '.5px solid rgba(255,255,255,.08)',
  borderRadius: 10,
  padding: '12px 14px',
  marginBottom: 12,
};
const badge: CSSProperties = {
  fontSize: 10.5,
  color: S.dim,
  border: '.5px solid rgba(255,255,255,.12)',
  borderRadius: 5,
  padding: '1px 6px',
};
const removeBtn: CSSProperties = {
  fontSize: 11.5,
  color: S.dim,
  background: 'transparent',
  border: '.5px solid rgba(255,255,255,.12)',
  borderRadius: 7,
  padding: '3px 9px',
  cursor: 'pointer',
};
