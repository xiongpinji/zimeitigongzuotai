/**
 * 工作流：创作流水线工作台。
 *
 * 每条视频拉入后自动「准备素材(抓取+转录) → 爆款拆解」，停在「待确认」等用户送二创。
 * 卡片展示阶段进度、爆款拆解报告，确认后一键送进灵机剪影待创作箱。轮询阶段自动推进。
 */
import { useEffect, useRef, useState } from 'react';
import type { DouyinClient } from '@/client';
import type { ViralInsight, WorkflowItem, WorkflowStage } from '@/domain/models';
import { S } from '@/ui/theme';
import { StanceBadge, useHover } from '@/ui/kit';
import type { WorkbenchData } from './use-data';
import { errText } from './use-data';

/** 流水线主轴（failed 不在轴上，单独红色提示）。 */
const STEPS: Array<{ key: WorkflowStage; label: string }> = [
  { key: 'preparing', label: '准备素材' },
  { key: 'analyzing', label: '拆解' },
  { key: 'ready', label: '待确认' },
  { key: 'pushed', label: '已送二创' },
];

const STEP_INDEX: Record<WorkflowStage, number> = {
  collected: 0,
  preparing: 0,
  analyzing: 1,
  ready: 2,
  pushed: 3,
  failed: -1,
};

const STAGE_TEXT: Record<WorkflowStage, string> = {
  collected: '排队中…',
  preparing: '准备素材中：抓取无水印源并转录…',
  analyzing: '爆款拆解中：分析钩子 / 结构 / 二创角度…',
  ready: '拆解完成，确认后送进灵机剪影二创',
  pushed: '已送到灵机剪影待创作箱 ✓',
  failed: '处理失败',
};

const ACTIVE_STAGES: ReadonlySet<WorkflowStage> = new Set(['collected', 'preparing', 'analyzing']);

export function WorkflowBoard({
  client,
  data,
  onOpen,
  show,
}: {
  client: DouyinClient;
  data: WorkbenchData;
  onOpen: (videoId: string) => void;
  show: (t: string) => void;
}) {
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => client.listWorkflowItems().then(setItems).catch((e) => show(errText(e)));

  useEffect(() => {
    void load();
    // 有条目处于活动阶段时轮询，自动反映流水线推进。
    poll.current = setInterval(() => void load(), 2500);
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      show(errText(e));
    }
  };

  const push = (item: WorkflowItem) =>
    act(async () => {
      const r = await client.pushWorkflowItem(item.id);
      if (!r.pushed) {
        show(
          r.reason === 'disabled'
            ? '请先在「设置 → 灵机剪影联动」连接桌面端'
            : r.reason === 'no-payload'
              ? '该视频暂无转录，无法送出'
              : '送出失败',
        );
      } else if (r.outcome.status === 'unauthorized') {
        show('token 不匹配，请在设置中重新连接');
      } else if (r.outcome.status === 'queued') {
        show('灵机剪影未在线，已暂存，稍后自动补送');
      } else {
        show('已送进灵机剪影待创作箱 ✓');
      }
    });

  const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt);
  const activeCount = items.filter((i) => ACTIVE_STAGES.has(i.stage)).length;

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: S.shell }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '22px 32px 60px' }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 21, fontWeight: 700, color: S.white, letterSpacing: '-.2px' }}>工作流</div>
          <div style={{ fontSize: 12.5, color: S.faint, marginTop: 3 }}>
            创作流水线 · 拉入后自动准备素材并拆解爆款，确认后一键送进灵机剪影二创
            {activeCount > 0 ? ` · ${activeCount} 条处理中` : ''}
          </div>
        </div>

        {sorted.length === 0 ? (
          <div
            style={{
              background: S.card,
              border: '.5px solid rgba(255,255,255,.07)',
              borderRadius: 14,
              padding: '40px 24px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 13.5, color: S.e8, fontWeight: 500 }}>流水线是空的</div>
            <div style={{ fontSize: 12.5, color: S.faint, marginTop: 6, lineHeight: 1.6 }}>
              在视频详情点「拉入工作流」，它会自动转录、拆解这条爆款，
              <br />
              再由你确认送进灵机剪影做二创。
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sorted.map((item) => {
              const v = data.videos.find((x) => x.id === item.videoId);
              return (
                <PipelineCard
                  key={item.id}
                  item={item}
                  title={v?.description || item.videoId}
                  coverUrl={v?.coverUrl}
                  creatorName={v ? data.creators.get(v.creatorId)?.nickname ?? '未知博主' : ''}
                  category={data.analyses[item.videoId]?.category}
                  onOpen={() => onOpen(item.videoId)}
                  onPush={() => void push(item)}
                  onRetry={() => void act(() => client.retryWorkflowItem(item.id))}
                  onRemove={() => void act(() => client.removeWorkflowItem(item.id))}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineCard({
  item,
  title,
  coverUrl,
  creatorName,
  category,
  onOpen,
  onPush,
  onRetry,
  onRemove,
}: {
  item: WorkflowItem;
  title: string;
  coverUrl?: string;
  creatorName: string;
  category?: string;
  onOpen: () => void;
  onPush: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const [h, bind] = useHover();
  const [open, setOpen] = useState(false);
  const failed = item.stage === 'failed';
  const active = ACTIVE_STAGES.has(item.stage);
  const reached = STEP_INDEX[item.stage];

  return (
    <div
      {...bind}
      style={{
        background: S.card,
        border: `.5px solid ${h ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.07)'}`,
        borderRadius: 13,
        padding: 14,
      }}
    >
      <div style={{ display: 'flex', gap: 12 }}>
        {/* 封面缩略 */}
        <button
          type="button"
          onClick={onOpen}
          title="打开视频详情"
          style={{
            flex: 'none',
            width: 88,
            height: 56,
            borderRadius: 8,
            border: 'none',
            cursor: 'pointer',
            background: coverUrl ? `center/cover no-repeat url(${coverUrl})` : '#16202c',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: S.dim }}>{creatorName}</span>
            <StanceBadge category={category} style={{ marginLeft: 'auto' }} />
          </div>
          <div
            onClick={onOpen}
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: S.e8,
              lineHeight: 1.45,
              cursor: 'pointer',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title}
          </div>
        </div>
      </div>

      {/* 阶段进度轴 */}
      {!failed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 12 }}>
          {STEPS.map((step, i) => {
            const done = reached > i || item.stage === 'pushed';
            const isCurrent = reached === i && active;
            const isReadyHere = item.stage === 'ready' && i === STEP_INDEX.ready;
            const on = done || isCurrent || isReadyHere;
            return (
              <div key={step.key} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      background: on ? S.accent : 'rgba(255,255,255,.16)',
                      boxShadow: isCurrent ? `0 0 0 3px rgba(10,132,255,.22)` : 'none',
                    }}
                  />
                  <span style={{ fontSize: 10, color: on ? S.cf : S.faint3, whiteSpace: 'nowrap' }}>{step.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <span style={{ flex: 1, height: 1.5, margin: '0 4px', marginBottom: 14, background: reached > i ? S.accent : 'rgba(255,255,255,.12)' }} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 状态行 + 操作 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: failed ? S.orange : active ? S.accent : S.faint, flex: 1, minWidth: 140 }}>
          {failed ? `处理失败：${item.error ?? '未知原因'}` : STAGE_TEXT[item.stage]}
        </span>

        {item.stage === 'ready' && item.insight && (
          <button onClick={() => setOpen((x) => !x)} style={ghostBtn}>
            {open ? '收起拆解' : '查看拆解'}
          </button>
        )}
        {item.stage === 'ready' && (
          <button onClick={onPush} style={primaryBtn}>
            送进灵机剪影 →
          </button>
        )}
        {item.stage === 'pushed' && item.insight && (
          <button onClick={() => setOpen((x) => !x)} style={ghostBtn}>
            {open ? '收起拆解' : '查看拆解'}
          </button>
        )}
        {failed && (
          <button onClick={onRetry} style={primaryBtn}>
            重试
          </button>
        )}
        <button onClick={onRemove} style={ghostBtn} title="从流水线移除">
          移除
        </button>
      </div>

      {open && item.insight && <InsightView insight={item.insight} />}
    </div>
  );
}

function InsightView({ insight }: { insight: ViralInsight }) {
  return (
    <div style={{ marginTop: 12, background: S.card2, border: '.5px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '14px 16px' }}>
      <Field label="选题角度" text={insight.angle} />
      <Field label="开头钩子" text={insight.hook} />
      <ListField label="内容骨架" items={insight.structure} ordered />
      <ListField label="记忆点 / 金句" items={insight.highlights} />
      <ListField label="数据 / 论据" items={insight.dataPoints} />
      <ListField label="二创建议" items={insight.remixSuggestions} />
    </div>
  );
}

function Field({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={sectionLabel}>{label}</div>
      <div style={{ fontSize: 12.5, color: S.c8, lineHeight: 1.6 }}>{text}</div>
    </div>
  );
}

function ListField({ label, items, ordered }: { label: string; items: string[]; ordered?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={sectionLabel}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {items.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: S.c8, lineHeight: 1.55 }}>
            <span style={{ flex: 'none', color: S.accent, fontFamily: S.mono, fontSize: 11, width: 16, paddingTop: 1 }}>
              {ordered ? `${i + 1}.` : '·'}
            </span>
            <span>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const sectionLabel = {
  fontSize: 10.5,
  fontWeight: 600,
  color: S.faint,
  letterSpacing: '.4px',
  textTransform: 'uppercase',
  marginBottom: 5,
} as const;

const primaryBtn = {
  fontSize: 11.5,
  fontWeight: 500,
  color: '#fff',
  background: S.accent,
  border: 'none',
  borderRadius: 7,
  padding: '6px 12px',
  cursor: 'pointer',
} as const;

const ghostBtn = {
  fontSize: 11.5,
  color: S.cf,
  background: 'rgba(255,255,255,.06)',
  border: '.5px solid rgba(255,255,255,.09)',
  borderRadius: 7,
  padding: '6px 11px',
  cursor: 'pointer',
} as const;
