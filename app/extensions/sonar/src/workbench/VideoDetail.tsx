/** 视频详情面板（动态流右栏）：封面、指标、工作流操作、下载/水印、AI 摘要、要点、字幕。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DouyinClient } from '@/client';
import type {
  DownloadTask,
  ProcessingStage,
  ProcessingTask,
  TranscriptDocument,
  Video,
  VideoAnalysis,
  VideoSource,
} from '@/domain/models';
import type { ResolvedVideo } from '@/domain/api-types';
import { matchFreshSource } from '@/resolver/source-ranker';
import { S } from '@/ui/theme';
import { Avatar, Hover, useHover } from '@/ui/kit';
import { SparkIcon, PlayTriangle } from '@/ui/icons';
import { formatCount, formatDuration, formatDateTime, srtTimeToLabel } from '@/ui/format';
import type { CreatorView } from './use-data';
import { errText } from './use-data';
import { STAGE_LABEL as PROC_LABEL, isProcessingActive } from './use-processing';

const flagBtnBase: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 13px',
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 500,
  cursor: 'pointer',
};

function watermarkLabel(src?: VideoSource): { text: string; color: string; bg: string } {
  if (!src) return { text: '未解析', color: S.faint, bg: 'rgba(255,255,255,.06)' };
  if (src.watermark === 'none' && src.watermarkConfidence === 'high')
    return { text: '高置信度无水印', color: S.green, bg: 'rgba(48,209,88,.14)' };
  if (src.watermark === 'none')
    return { text: '可能无水印', color: S.orange, bg: 'rgba(255,159,10,.14)' };
  if (src.watermark === 'unknown')
    return { text: '水印未知', color: S.orange, bg: 'rgba(255,159,10,.14)' };
  return { text: '仅找到带水印版本', color: S.faint, bg: 'rgba(255,255,255,.08)' };
}

function qualityLabel(src: VideoSource): string {
  const h = src.height;
  const res = h ? (h >= 2160 ? '2160p' : h >= 1080 ? '1080p' : h >= 720 ? '720p' : `${h}p`) : '未知清晰度';
  return [res, src.codec, src.mimeType?.split('/')[1]].filter(Boolean).join(' · ');
}

export function VideoDetail({
  client,
  video,
  creator,
  analysis,
  flagged,
  onToggleFlag,
  show,
  onAnalysisChange,
  onProcess,
  processingStage,
  processingError,
  onNavigateSettings,
}: {
  client: DouyinClient;
  video: Video;
  creator?: CreatorView;
  analysis: VideoAnalysis | null;
  flagged: boolean;
  onToggleFlag: () => void;
  show: (t: string) => void;
  onAnalysisChange: (videoId: string) => void;
  onProcess: (videoId: string, task: ProcessingTask) => void;
  processingStage?: ProcessingStage;
  processingError?: string;
  onNavigateSettings: () => void;
}) {
  const [transcript, setTranscript] = useState<TranscriptDocument | null>(null);
  const [resolved, setResolved] = useState<ResolvedVideo | null>(null);
  const [resolving, setResolving] = useState(false);
  const [selSrc, setSelSrc] = useState<string | null>(null);
  const [dl, setDl] = useState<DownloadTask | null>(null);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [playLoading, setPlayLoading] = useState(false);
  const [playErr, setPlayErr] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  // null = 未知（加载中），用于区分「确实未配置」与「尚未读取」，避免误报提示。
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  // 字幕跟随播放：当前播放毫秒数 + 待跳转毫秒（视频未加载时点字幕，加载后补跳）。
  const [currentMs, setCurrentMs] = useState(0);
  const pendingSeekMs = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setTranscript(null);
    setResolved(null);
    setSelSrc(null);
    setDl(null);
    setDlErr(null);
    setPlayUrl(null);
    setPlayLoading(false);
    setPlayErr(null);
    setCurrentMs(0);
    pendingSeekMs.current = null;
    client.getTranscript(video.id).then(setTranscript).catch(() => setTranscript(null));
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [client, video.id]);

  // AI 配置状态：决定「未分析」卡片是引导生成摘要还是引导去设置配置模型。
  useEffect(() => {
    let alive = true;
    client
      .getAiSettings()
      .then((s) => alive && setAiConfigured(s.llm.configured))
      .catch(() => alive && setAiConfigured(false));
    return () => {
      alive = false;
    };
  }, [client]);

  // 后台分析（fire-and-forget）完成时回填字幕与摘要：处理同步等待已移除，
  // 改为监听阶段从「进行中」跃迁到 completed 后再拉取最新结果。
  const prevStage = useRef<ProcessingStage | undefined>(undefined);
  useEffect(() => {
    if (isProcessingActive(prevStage.current) && processingStage === 'completed') {
      client.getTranscript(video.id).then(setTranscript).catch(() => {});
      onAnalysisChange(video.id);
    }
    prevStage.current = processingStage;
  }, [processingStage, client, video.id, onAnalysisChange]);

  const resolve = useCallback(async () => {
    setResolving(true);
    setDlErr(null);
    try {
      const r = await client.resolveVideo({ videoId: video.id, pageUrl: video.sourcePageUrl });
      setResolved(r);
      setSelSrc(r.sources[0]?.url ?? null);
    } catch (e) {
      setDlErr(errText(e));
    } finally {
      setResolving(false);
    }
  }, [client, video]);

  const startDownload = useCallback(async () => {
    const src = resolved?.sources.find((s) => s.url === selSrc) ?? resolved?.sources[0];
    setDlErr(null);
    try {
      const task = await client.downloadVideo(video.id, {
        preferredSourceUrl: src?.url,
        allowWatermarkFallback: src?.watermark === 'present',
      });
      setDl(task);
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        try {
          const t = await client.getDownloadTask(task.id);
          setDl(t);
          if (['completed', 'failed', 'cancelled'].includes(t.status) && poll.current) {
            clearInterval(poll.current);
            poll.current = null;
          }
        } catch {
          /* 任务尚不可查 */
        }
      }, 700);
    } catch (e) {
      setDlErr(errText(e));
    }
  }, [client, video.id, resolved, selSrc]);

  // 在线播放 / 复制地址都必须用「现解析」的新鲜签名地址：UI 候选来自缓存解析，签名可能已过期，
  // 直接喂给 <video> 或粘到别处会 403（下载成 html）。这里强制 preferFresh 重新解析。
  const freshSources = useCallback(async () => {
    const r = await client.resolveVideo({ videoId: video.id, pageUrl: video.sourcePageUrl, preferFresh: true });
    return r.sources;
  }, [client, video.id, video.sourcePageUrl]);

  const startPlayback = useCallback(async () => {
    setPlayErr(null);
    setPlayLoading(true);
    try {
      const prefer = resolved?.sources.find((s) => s.url === selSrc) ?? resolved?.sources[0];
      const pick = matchFreshSource(await freshSources(), prefer);
      if (!pick) throw new Error('未找到可在线播放的视频源（图文 / 动态作品可能没有视频流）');
      setPlayUrl(pick.url);
    } catch (e) {
      setPlayErr(errText(e));
    } finally {
      setPlayLoading(false);
    }
  }, [freshSources, resolved, selSrc]);

  const copyAddress = useCallback(async () => {
    setCopying(true);
    try {
      const prefer = resolved?.sources.find((s) => s.url === selSrc) ?? resolved?.sources[0];
      const pick = matchFreshSource(await freshSources(), prefer);
      if (!pick) throw new Error('未找到可复制的视频地址');
      await navigator.clipboard?.writeText(pick.url);
      show(
        pick.watermark === 'present'
          ? '已复制带水印地址（签名链接，有效期有限）'
          : '已复制无水印地址（签名链接，有效期有限）',
      );
    } catch (e) {
      show(errText(e));
    } finally {
      setCopying(false);
    }
  }, [freshSources, resolved, selSrc, show]);

  // 字幕跟随：当前高亮段 = 最后一个已开始（startMs <= 当前时间）的段。
  const segments = transcript?.segments ?? [];
  let activeIdx = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].startMs <= currentMs) activeIdx = i;
    else break;
  }

  // 点字幕跳转到对应时间：视频已加载直接 seek，否则记下待跳并触发解析播放，加载后补跳。
  const seekTo = useCallback(
    (ms: number) => {
      const el = videoRef.current;
      if (el && playUrl) {
        el.currentTime = ms / 1000;
        void el.play().catch(() => {});
        setCurrentMs(ms);
      } else {
        pendingSeekMs.current = ms;
        void startPlayback();
      }
    },
    [playUrl, startPlayback],
  );

  // 高亮段滚动到字幕容器可视区（仅在容器内滚动，不带动整页）。
  useEffect(() => {
    const root = transcriptScrollRef.current;
    if (!root || activeIdx < 0) return;
    const el = root.querySelector<HTMLElement>(`[data-seg="${activeIdx}"]`);
    if (!el) return;
    const top = el.offsetTop - root.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < root.scrollTop || bottom > root.scrollTop + root.clientHeight) {
      root.scrollTo({ top: top - root.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' });
    }
  }, [activeIdx]);

  const stats = video.statistics ?? {};
  const metrics: Array<[string, string]> = [
    ['点赞', formatCount(stats.likeCount)],
    ['评论', formatCount(stats.commentCount)],
    ['收藏', formatCount(stats.collectCount)],
    ['转发', formatCount(stats.shareCount)],
    ['时长', formatDuration(video.durationMs)],
  ];
  const seed = video.id;
  const selectedSource = resolved?.sources.find((s) => s.url === selSrc) ?? resolved?.sources[0];
  const wm = watermarkLabel(selectedSource);
  const pct =
    dl?.totalBytes && dl.receivedBytes ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : null;
  const busy = isProcessingActive(processingStage);
  // 仅在确知未配置（已读取设置且 configured=false）且非进行中时，才把「未分析」卡片切到配置引导。
  const needsConfig = aiConfigured === false && !busy;

  // 入队处理：requireSummary=true 表示用户要 AI 摘要（未配置则后端抛 SUMMARY_NOT_CONFIGURED）；
  // false 表示只转录字幕（零配置，便于未配置模型时仍能拿到字幕跟随播放）。
  const runAnalyze = useCallback(
    async (requireSummary: boolean) => {
      if (busy) return;
      try {
        const task = await client.processVideo(video.id, { requireSummary });
        onProcess(video.id, task);
        show(requireSummary ? '已开始分析，可在此查看进度' : '已开始转录字幕');
      } catch (e) {
        show(errText(e));
      }
    },
    [busy, client, video.id, onProcess, show],
  );

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 32px 60px' }}>
      {/* 封面 / 在线播放 */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16/9',
          borderRadius: 14,
          overflow: 'hidden',
          background: video.coverUrl ? `center/cover no-repeat url(${video.coverUrl})` : undefined,
          backgroundColor: '#16202c',
          boxShadow: '0 8px 30px rgba(0,0,0,.4)',
        }}
      >
        {playUrl ? (
          // 抖音 CDN 校验 Referer：扩展页面的 <video> media 请求由 declarativeNetRequest 注入
          // Referer（见 referer-rule.ts），故可直接在线播放无水印源，无需另开标签页。
          <video
            ref={videoRef}
            src={playUrl}
            poster={video.coverUrl}
            controls
            autoPlay
            playsInline
            onLoadedMetadata={() => {
              // 视频未加载时点击的字幕：元数据就绪后补跳到目标时间。
              const el = videoRef.current;
              if (el && pendingSeekMs.current != null) {
                el.currentTime = pendingSeekMs.current / 1000;
                void el.play().catch(() => {});
                pendingSeekMs.current = null;
              }
            }}
            onTimeUpdate={() => {
              const el = videoRef.current;
              if (el) setCurrentMs(Math.round(el.currentTime * 1000));
            }}
            onError={() => {
              setPlayUrl(null);
              setPlayErr('播放失败：地址可能已过期，请重试');
            }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000', objectFit: 'contain' }}
          />
        ) : (
          <>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.5))' }} />
            <button
              type="button"
              onClick={startPlayback}
              disabled={playLoading}
              aria-label="在线播放"
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%,-50%)',
                width: 54,
                height: 54,
                borderRadius: '50%',
                background: 'rgba(0,0,0,.4)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                border: '1px solid rgba(255,255,255,.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: playLoading ? 'progress' : 'pointer',
                padding: 0,
              }}
            >
              {playLoading ? (
                <span style={{ fontSize: 11, color: '#fff', fontFamily: S.mono }}>…</span>
              ) : (
                <PlayTriangle w={18} />
              )}
            </button>
            <span style={{ position: 'absolute', left: 14, top: 13, fontSize: 10, fontFamily: S.mono, color: 'rgba(255,255,255,.55)', letterSpacing: 1 }}>
              {playErr ? '播放失败' : playLoading ? '解析中 · RESOLVING' : '点击在线播放 · PLAY'}
            </span>
            <span style={{ position: 'absolute', right: 13, bottom: 12, fontSize: 12, fontFamily: S.mono, color: '#fff', background: 'rgba(0,0,0,.5)', padding: '3px 7px', borderRadius: 5 }}>
              {formatDuration(video.durationMs)}
            </span>
          </>
        )}
      </div>
      {playErr && <div style={{ fontSize: 12, color: S.orange, marginTop: 8 }}>{playErr}</div>}

      {/* 标题 */}
      <h1 style={{ fontSize: 23, fontWeight: 700, color: S.white, lineHeight: 1.32, margin: '18px 0 0', letterSpacing: '-.2px' }}>
        {video.description || '（无标题）'}
      </h1>

      {/* 博主行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 14 }}>
        <Avatar seed={creator?.id ?? seed} initial={creator?.initial ?? '?'} url={creator?.avatarUrl} size={38} radius={11} fontSize={15} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: S.e8 }}>{creator?.nickname ?? '未知博主'}</div>
          <div style={{ fontSize: 11.5, color: S.faint, fontFamily: S.mono, marginTop: 1 }}>
            {creator?.handle ?? ''} · {formatDateTime(video.publishedAt)}
          </div>
        </div>
        <OpenButton url={video.sourcePageUrl} />
      </div>

      {/* 指标网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 9, marginTop: 18 }}>
        {metrics.map(([k, v]) => (
          <div key={k} style={{ background: S.card2, border: '.5px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '11px 10px' }}>
            <div style={{ fontSize: 11, color: S.faint }}>{k}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: S.f0, fontFamily: S.mono, marginTop: 3 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* 工作流操作条 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <Hover
          base={
            flagged
              ? { ...flagBtnBase, border: '.5px solid rgba(255,214,10,.4)', color: S.yellow, background: 'rgba(255,214,10,.12)' }
              : { ...flagBtnBase, border: '.5px solid rgba(255,255,255,.09)', color: S.cf, background: S.btn2 }
          }
          hover={{ filter: 'brightness(1.1)' }}
          onClick={() => {
            onToggleFlag();
            show(flagged ? '已取消标记' : '已标记为重点 ★');
          }}
        >
          ★ {flagged ? '取消标记' : '标记重点'}
        </Hover>
        <Hover
          base={{ ...flagBtnBase, border: '.5px solid rgba(255,255,255,.09)', color: S.cf, background: S.btn2 }}
          hover={{ background: S.btn2Hover }}
          onClick={async () => {
            try {
              await client.exportMarkdown({ videoIds: [video.id] });
              show('摘要已导出为 Markdown');
            } catch (e) {
              show(errText(e));
            }
          }}
        >
          ↧ 导出摘要
        </Hover>
        <Hover
          base={{ ...flagBtnBase, border: '.5px solid rgba(255,255,255,.09)', color: S.cf, background: S.btn2 }}
          hover={{ background: S.btn2Hover }}
          onClick={async () => {
            try {
              await client.addToWorkflow({ videoId: video.id });
              show('已拉入工作流，开始自动转录与爆款拆解');
            } catch (e) {
              show(errText(e));
            }
          }}
        >
          <span style={{ fontSize: 14 }}>＋</span> 拉入工作流
        </Hover>
        <Hover
          base={
            transcript
              ? { ...flagBtnBase, border: '.5px solid rgba(10,132,255,.4)', color: '#fff', background: S.accent }
              : { ...flagBtnBase, border: '.5px solid rgba(255,255,255,.09)', color: S.faint, background: S.btn2, cursor: 'not-allowed' }
          }
          hover={transcript ? { filter: 'brightness(1.1)' } : {}}
          onClick={async () => {
            if (!transcript) {
              show('请先转录该视频，再推送二创');
              return;
            }
            try {
              const r = await client.pushVideoToBridge(video.id);
              if (!r.pushed) {
                show(
                  r.reason === 'disabled'
                    ? '请先在「设置 → 灵机剪影联动」填入端点与 token'
                    : r.reason === 'no-payload'
                      ? '该视频暂无转录，无法推送'
                      : '推送失败',
                );
              } else if (r.outcome.status === 'unauthorized') {
                show('token 不匹配，请在设置中重新填写');
              } else if (r.outcome.status === 'queued') {
                show('灵机剪影未在线，已暂存，稍后自动补推');
              } else {
                show('已推送到灵机剪影待创作箱 ✓');
              }
            } catch (e) {
              show(errText(e));
            }
          }}
        >
          ⇪ 推送二创
        </Hover>
        <div style={{ flex: 1 }} />
        {flagged && (
          <span style={{ fontSize: 11, fontWeight: 600, color: S.yellow, background: 'rgba(255,214,10,.14)', padding: '4px 9px', borderRadius: 6 }}>
            ● 已标记重点
          </span>
        )}
      </div>

      {/* 下载 / 水印（补全主设计文档 §7.3） */}
      <div style={{ marginTop: 22, background: S.aiCard, border: '.5px solid rgba(255,255,255,.07)', borderRadius: 13, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
          <span style={{ width: 3, height: 13, background: S.accent, borderRadius: 2 }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: S.f0, letterSpacing: '.3px' }}>下载原片</span>
          {selectedSource && (
            <span style={{ fontSize: 10, fontWeight: 600, color: wm.color, background: wm.bg, padding: '2px 8px', borderRadius: 5 }}>{wm.text}</span>
          )}
          <div style={{ flex: 1 }} />
          <Hover
            base={{ fontSize: 11.5, color: S.mute, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', gap: 4 }}
            hover={{ color: S.cf }}
            onClick={copyAddress}
          >
            {copying ? '解析中…' : '⧉ 复制地址'}
          </Hover>
          {!resolved && (
            <Hover
              base={{ fontSize: 11.5, color: S.mute, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', gap: 4, marginLeft: 12 }}
              hover={{ color: S.cf }}
              onClick={resolve}
            >
              {resolving ? '解析中…' : '解析候选源'}
            </Hover>
          )}
        </div>

        {!resolved && !resolving && (
          <div style={{ fontSize: 12.5, color: S.faint, lineHeight: 1.6 }}>
            点「解析候选源」获取清晰度 / 编码与无水印判断；默认不下载带水印版本，需你明确选择。
          </div>
        )}

        {resolved && resolved.sources.length === 0 && (
          <div style={{ fontSize: 12.5, color: S.orange }}>未找到可下载源，请刷新视频页后重试。</div>
        )}

        {resolved && resolved.sources.length > 0 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {resolved.sources.map((src) => {
                const w = watermarkLabel(src);
                const on = (selSrc ?? resolved.sources[0].url) === src.url;
                return (
                  <label
                    key={src.url}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 11px',
                      borderRadius: 9,
                      cursor: 'pointer',
                      border: on ? `.5px solid ${S.accentLine}` : '.5px solid rgba(255,255,255,.07)',
                      background: on ? S.accentTint : 'rgba(255,255,255,.03)',
                    }}
                  >
                    <input type="radio" name="src" checked={on} onChange={() => setSelSrc(src.url)} style={{ accentColor: S.accent }} />
                    <span style={{ fontSize: 12.5, color: S.e2, fontFamily: S.mono, flex: 1 }}>{qualityLabel(src)}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: w.color, background: w.bg, padding: '2px 8px', borderRadius: 5 }}>{w.text}</span>
                  </label>
                );
              })}
            </div>
            {selectedSource && selectedSource.watermarkEvidence.length > 0 && (
              <div style={{ fontSize: 11, color: S.faint, lineHeight: 1.6, marginTop: 9 }}>
                判断依据：{selectedSource.watermarkEvidence.join('；')}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 13 }}>
              <Hover
                base={{ ...flagBtnBase, background: S.accent, color: '#fff', border: 'none' }}
                hover={{ filter: 'brightness(1.1)' }}
                onClick={startDownload}
              >
                {selectedSource?.watermark === 'present' ? '确认下载带水印版本' : '下载原片'}
              </Hover>
              {dl && (
                <span style={{ fontSize: 12, color: S.b4, fontFamily: S.mono }}>
                  {DL_LABEL[dl.status]}
                  {pct !== null ? ` · ${pct}%` : ''}
                </span>
              )}
              {dl && (dl.status === 'downloading' || dl.status === 'resolving') && (
                <Hover
                  base={{ fontSize: 11.5, color: S.mute, background: 'none', border: 'none', cursor: 'pointer' }}
                  hover={{ color: S.cf }}
                  onClick={() => void client.cancelDownload(dl.id)}
                >
                  取消
                </Hover>
              )}
            </div>
            {pct !== null && (
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)', marginTop: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: S.accent, transition: 'width .3s' }} />
              </div>
            )}
          </>
        )}
        {(dlErr || dl?.error) && <div style={{ fontSize: 12, color: S.orange, marginTop: 9 }}>{dlErr || dl?.error?.message}</div>}
      </div>

      {/* AI 摘要 */}
      {analysis ? (
        <div style={{ marginTop: 22, background: S.aiCard, border: '.5px solid rgba(255,255,255,.07)', borderRadius: 13, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
            <SparkIcon />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: S.f0, letterSpacing: '.3px' }}>AI 摘要</span>
            <span style={{ fontSize: 10, color: S.faint, background: 'rgba(255,255,255,.06)', padding: '2px 7px', borderRadius: 5 }}>已分析</span>
            <div style={{ flex: 1 }} />
            <Hover
              base={{ fontSize: 11.5, color: S.mute, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', gap: 4 }}
              hover={{ color: S.cf }}
              onClick={async () => {
                try {
                  const task = await client.regenerateAnalysis(video.id);
                  onProcess(video.id, task);
                  show('正在重新提取要点…');
                  onAnalysisChange(video.id);
                } catch (e) {
                  show(errText(e));
                }
              }}
            >
              ↻ 重新提取
            </Hover>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.75, color: S.c8, margin: 0 }}>{analysis.summary}</p>
        </div>
      ) : (
        <div style={{ marginTop: 22, background: S.aiCard, border: '.5px solid rgba(255,255,255,.07)', borderRadius: 13, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
            <SparkIcon color={S.faint} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: S.f0 }}>AI 摘要</span>
            <span
              style={{
                fontSize: 10,
                color: busy ? S.accent : processingError ? S.red : needsConfig ? S.orange : S.faint,
                background: busy
                  ? 'rgba(10,132,255,.14)'
                  : processingError
                    ? 'rgba(255,69,58,.14)'
                    : needsConfig
                      ? 'rgba(255,159,10,.14)'
                      : 'rgba(255,255,255,.06)',
                padding: '2px 7px',
                borderRadius: 5,
              }}
            >
              {busy ? '分析中' : processingError ? '分析失败' : needsConfig ? '未配置模型' : '未分析'}
            </span>
          </div>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.7,
              color: processingError && !busy ? S.red : needsConfig ? S.orange : S.faint,
              margin: '0 0 12px',
            }}
          >
            {busy
              ? `处理中：${PROC_LABEL[processingStage!]}…（约需十几秒到一分钟，可离开本页）`
              : processingError
                ? `分析失败：${processingError}`
                : needsConfig
                  ? '尚未配置 AI 模型，无法生成摘要。请先在设置中添加 LLM Provider 并填写 API Key；字幕转录无需配置，可单独生成。'
                  : transcript
                    ? '字幕已就绪，可直接生成 AI 摘要（复用现有字幕，不会重新下载或转录）。'
                    : '尚未生成摘要。点下方按钮入队转录与摘要；未配置 Provider 时不影响下载。'}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {needsConfig ? (
              <>
                <Hover
                  base={{ ...flagBtnBase, background: S.accent, color: '#fff', border: 'none' }}
                  hover={{ filter: 'brightness(1.1)' }}
                  onClick={onNavigateSettings}
                >
                  前往配置 AI 模型
                </Hover>
                {!transcript && (
                  <Hover
                    base={{ ...flagBtnBase, background: S.btn2, color: S.cf, border: '.5px solid rgba(255,255,255,.09)' }}
                    hover={{ background: S.btn2Hover }}
                    onClick={() => void runAnalyze(false)}
                  >
                    仅转录字幕
                  </Hover>
                )}
              </>
            ) : (
              <Hover
                base={{
                  ...flagBtnBase,
                  background: busy ? 'rgba(255,255,255,.12)' : S.accent,
                  color: '#fff',
                  border: 'none',
                  cursor: busy ? 'default' : 'pointer',
                  opacity: busy ? 0.75 : 1,
                }}
                hover={busy ? {} : { filter: 'brightness(1.1)' }}
                onClick={() => {
                  if (busy) return;
                  void runAnalyze(true);
                }}
              >
                {busy
                  ? `${PROC_LABEL[processingStage!]}…`
                  : processingError
                    ? '重试分析'
                    : transcript
                      ? '生成 AI 摘要'
                      : '分析此视频'}
              </Hover>
            )}
          </div>
        </div>
      )}

      {/* 关键要点 */}
      {analysis && analysis.keyPoints.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: S.f0, letterSpacing: '.3px', marginBottom: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 3, height: 13, background: S.accent, borderRadius: 2 }} />
            关键要点
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {analysis.keyPoints.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: S.accent, fontFamily: S.mono, flex: 'none', width: 20, paddingTop: 1 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ fontSize: 13.5, lineHeight: 1.6, color: S.c8 }}>{p}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 标签 */}
      {analysis && analysis.tags.length > 0 && (
        <div style={{ marginTop: 22, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {analysis.tags.map((t) => (
            <span key={t} style={{ fontSize: 12, color: S.dim2, background: 'rgba(255,255,255,.06)', border: '.5px solid rgba(255,255,255,.05)', padding: '4px 11px', borderRadius: 7 }}>
              {t.startsWith('#') ? t : `#${t}`}
            </span>
          ))}
        </div>
      )}

      {/* 字幕转录 */}
      <div style={{ marginTop: 26, background: S.transcript, border: '.5px solid rgba(255,255,255,.06)', borderRadius: 13, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px', borderBottom: '.5px solid rgba(255,255,255,.06)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: S.f0, letterSpacing: '.3px' }}>字幕转录</span>
          {transcript && (
            <span style={{ fontSize: 10, color: S.faint, background: 'rgba(255,255,255,.06)', padding: '2px 7px', borderRadius: 5 }}>
              全文 {transcript.segments.length} 段
            </span>
          )}
          <div style={{ flex: 1 }} />
          {transcript && (
            <Hover
              base={{ fontSize: 11.5, color: S.mute, background: 'none', border: 'none', cursor: 'pointer' }}
              hover={{ color: S.cf }}
              onClick={() => {
                void navigator.clipboard?.writeText(transcript.fullText);
                show('已复制全文');
              }}
            >
              复制全文
            </Hover>
          )}
          {transcript && (
            <Hover
              base={{ fontSize: 11.5, color: S.mute, background: 'none', border: 'none', cursor: 'pointer', marginLeft: 12 }}
              hover={{ color: S.cf }}
              onClick={async () => {
                try {
                  const task = await client.regenerateTranscript(video.id);
                  onProcess(video.id, task);
                  show('已入队重新转录');
                } catch (e) {
                  show(errText(e));
                }
              }}
            >
              重新转录
            </Hover>
          )}
        </div>
        {transcript ? (
          // 限制最大高度并内部滚动，避免长字幕把详情页拉得很长；点任意段跳转视频到该时间，
          // 播放时当前段自动高亮并滚入可视区，便于对照文案核对逻辑。
          <div ref={transcriptScrollRef} style={{ padding: '6px 0', maxHeight: 360, overflowY: 'auto' }}>
            {transcript.segments.map((seg, i) => {
              const active = i === activeIdx;
              return (
                <button
                  key={i}
                  type="button"
                  data-seg={i}
                  onClick={() => seekTo(seg.startMs)}
                  title="跳转到该处播放"
                  style={{
                    display: 'flex',
                    gap: 14,
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 18px',
                    border: 'none',
                    borderLeft: active ? `2px solid ${S.accent}` : '2px solid transparent',
                    background: active ? S.accentTint : 'transparent',
                    cursor: 'pointer',
                    font: 'inherit',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11.5,
                      color: S.accent,
                      fontFamily: S.mono,
                      flex: 'none',
                      width: 42,
                      paddingTop: 1,
                      opacity: active ? 1 : 0.85,
                      fontWeight: active ? 700 : 400,
                    }}
                  >
                    {srtTimeToLabel(seg.startMs)}
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.65, color: active ? S.white : S.b4 }}>{seg.text}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: '16px 18px', fontSize: 12.5, color: S.faint }}>
            暂无字幕。转录失败不影响下载与详情；可在上方「分析此视频」入队转录。
          </div>
        )}
      </div>
    </div>
  );
}

const DL_LABEL: Record<DownloadTask['status'], string> = {
  queued: '排队中',
  resolving: '解析中',
  downloading: '下载中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function OpenButton({ url }: { url: string }) {
  const [h, bind] = useHover();
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      {...bind}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 30,
        padding: '0 12px',
        background: h ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.06)',
        color: S.cf,
        border: '.5px solid rgba(255,255,255,.09)',
        borderRadius: 8,
        fontSize: 12.5,
        textDecoration: 'none',
        flex: 'none',
      }}
    >
      打开原视频 <span style={{ fontSize: 13 }}>↗</span>
    </a>
  );
}
