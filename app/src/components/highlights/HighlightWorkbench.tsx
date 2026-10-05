import { useCallback, useEffect, useState } from 'react';
import type { HighlightArtifactBundle } from '../../../electron/highlights/highlight-batch-artifacts';
import type { HighlightV1TaskDto, HighlightV1Result } from '../../../electron/highlights/product-highlight-ipc';
import type { ReviewedClipReceipt } from '../../../electron/highlights/reviewed-clip-receipts';
import styles from './HighlightWorkbench.module.css';

const ERROR_TEXT: Record<string, string> = {
  forbidden: '当前窗口没有操作权限。',
  busy: '当前有高光任务或文件选择正在进行。',
  stopped: '高光服务正在关闭，请稍后重启应用。',
  invalid_request: '参数无效，请检查填写内容。',
  invalid_selection: '所选文件不符合要求，请重新选择。',
  selection_required: '请先完成对应的文件选择。',
  consent_required: '运行前请确认本地模型下载许可。',
  model_path_unavailable: '无法创建本地模型的英文路径入口。请检查用户数据目录和本机临时目录的写入权限。',
  authorization_expired: '请先在设置中授权智能体高光检测。',
  project_changed: '当前工程已变化，请重新选择和准备参数。',
  recording_already_bound: '该录屏任务已归属其他工程，请回到原工程处理。',
  source_unavailable: '录屏源文件已变化或无法读取，请重新选择。',
  root_mismatch: '排队任务包含其他目录的录屏。请先选择原目录，或取消这些任务。',
  review_required: '请先人工审核并确认所选片段。',
  invalid_configuration: '本地 FFmpeg 或 ffprobe 未就绪。',
  candidate_not_found: '高光候选不存在，请重新读取任务。',
  source_hash_mismatch: '录屏内容已变化，请重新导入并分析。',
  invalid_media: '视频无法读取或导出的切片无效。',
  invalid_timecode: '切片时间超出录屏时长，或短于 0.5 秒。',
  render_failed: '切片渲染失败，请检查 FFmpeg 与源视频。',
  render_timeout: '切片渲染超时。',
  cancelled: '切片导出已取消。',
  output_conflict: '已有切片与收据不一致，已停止覆盖。',
  output_missing: '切片文件不存在。',
  receipt_corrupt: '切片收据损坏，已停止使用。',
  receipt_write_failed: '切片收据写入失败。',
  task_not_found: '候选产物不存在或尚未完成。',
  invalid_transition: '当前任务状态不支持这个操作。',
  attempt_limit_reached: '已达到该任务的重试次数上限。',
  internal_error: '操作失败，请检查本地运行环境。',
};

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function stateLabel(state: HighlightV1TaskDto['state']): string {
  return {
    queued: '排队中', running: '分析中', interrupted: '已中断',
    completed: '候选待审核', failed: '失败', cancelled: '已取消',
  }[state];
}

type ClipSelectionState = { selected: boolean; startMs: number; endMs: number };

export function HighlightWorkbench({ active, onImportClip }: {
  active: boolean;
  onImportClip?: (path: string, durationMs: number) => void;
}) {
  const api = typeof window === 'undefined' ? undefined : window.highlightV1API;
  const [tasks, setTasks] = useState<HighlightV1TaskDto[]>([]);
  const [queueBusy, setQueueBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [runInProgress, setRunInProgress] = useState(false);
  const [message, setMessage] = useState('');
  const [rootLabel, setRootLabel] = useState('');
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [selectedSubtitleNames, setSelectedSubtitleNames] = useState<string[]>([]);
  const [nodeLabel, setNodeLabel] = useState('');
  const [hotClipLabel, setHotClipLabel] = useState('');
  const [maxClips, setMaxClips] = useState(3);
  const [concurrency, setConcurrency] = useState(1);
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [timeoutMinutes, setTimeoutMinutes] = useState(30);
  const [llmBaseUrl, setLlmBaseUrl] = useState('http://127.0.0.1:11434/v1');
  const [llmModel, setLlmModel] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [allowModelDownload, setAllowModelDownload] = useState(false);
  const [artifacts, setArtifacts] = useState<HighlightArtifactBundle[]>([]);
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [clipSelections, setClipSelections] = useState<Record<string, ClipSelectionState>>({});
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [reviewedClips, setReviewedClips] = useState<ReviewedClipReceipt[]>([]);

  const refreshClips = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.listReviewed();
      if (result.ok) setReviewedClips(result.clips);
      else setMessage(ERROR_TEXT[result.code] || '切片列表读取失败。');
    } catch { setMessage('切片列表读取失败。'); }
  }, [api]);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.list();
      if (result.ok) {
        setTasks(result.tasks);
        setQueueBusy(result.busy);
      } else setMessage(ERROR_TEXT[result.code]);
    } catch { setMessage('任务列表读取失败。'); }
  }, [api]);

  useEffect(() => {
    if (!active || !api) return;
    void refresh();
    void refreshClips();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [active, api, refresh, refreshClips]);

  async function select<T>(operation: () => Promise<HighlightV1Result<T>>, onSuccess: (value: T) => void) {
    setActionBusy(true);
    setMessage('');
    try {
      const result = await operation();
      if (result.ok) onSuccess(result);
      else setMessage(ERROR_TEXT[result.code]);
    } catch { setMessage('文件选择失败。'); }
    finally { setActionBusy(false); }
  }

  async function importRecordings() {
    if (!api) return;
    setActionBusy(true);
    setMessage('');
    try {
      const result = await api.importRecordings({ maxClips });
      if (result.ok) {
        setSelectedNames([]);
        setSelectedSubtitleNames([]);
        setMessage(`已导入 ${result.tasks.length} 个录屏任务。`);
        await refresh();
      } else setMessage(ERROR_TEXT[result.code]);
    } catch { setMessage('导入失败，请检查录屏文件。'); }
    finally { setActionBusy(false); }
  }

  async function run() {
    if (!api) return;
    setRunInProgress(true);
    setMessage('正在分析排队录屏；可切换工作台，任务由主进程继续运行。');
    try {
      const result = await api.run({
        llmBaseUrl: llmBaseUrl.trim(), llmModel: llmModel.trim(),
        ...(llmApiKey ? { llmApiKey } : {}),
        timeoutMs: timeoutMinutes * 60_000, concurrency, maxAttempts,
        allowModelDownload,
      });
      if (result.ok) setMessage('本轮分析结束。候选仍需人工审核。');
      else setMessage(ERROR_TEXT[result.code]);
      await refresh();
    } catch { setMessage('运行失败，请检查本地运行环境。'); }
    finally { setRunInProgress(false); setAllowModelDownload(false); }
  }

  async function prepareAgentRun() {
    if (!api) return;
    setActionBusy(true);
    setMessage('');
    try {
      const result = await api.prepareAgentRun({
        llmBaseUrl: llmBaseUrl.trim(), llmModel: llmModel.trim(),
        ...(llmApiKey ? { llmApiKey } : {}),
        timeoutMs: timeoutMinutes * 60_000, concurrency, maxAttempts,
        allowModelDownload,
      });
      setMessage(result.ok
        ? '已为当前工程准备一次智能体高光分析；只会处理当前工程已绑定的指定任务。'
        : ERROR_TEXT[result.code] || '准备高光参数失败。');
    } catch { setMessage('准备高光参数失败。'); }
    finally { setActionBusy(false); }
  }

  async function taskAction(operation: () => Promise<HighlightV1Result<unknown>>) {
    setMessage('');
    try {
      const result = await operation();
      if (!result.ok) setMessage(ERROR_TEXT[result.code]);
      await refresh();
    } catch { setMessage('任务操作失败。'); }
  }

  async function viewArtifact(id: string) {
    if (!api) return;
    setArtifactBusy(true);
    setArtifacts([]);
    setReviewConfirmed(false);
    try {
      const result = await api.read(id);
      if (result.ok) {
        setArtifacts([result.artifact]);
        setClipSelections(Object.fromEntries(result.artifact.highlights.map((item) => [item.id, {
          selected: false, startMs: item.startMs, endMs: item.endMs,
        }])));
        setReviewConfirmed(false);
      }
      else setMessage(ERROR_TEXT[result.code]);
    } catch { setMessage('候选读取失败。'); }
    finally { setArtifactBusy(false); }
  }

  async function viewAllArtifacts() {
    if (!api) return;
    setArtifactBusy(true);
    setArtifacts([]);
    setReviewConfirmed(false);
    setMessage('正在读取已完成录屏的候选。');
    try {
      const completed = tasks.filter((task) => task.state === 'completed').slice(0, 100);
      const results = await Promise.allSettled(completed.map((task) => api.read(task.id)));
      const loaded = results.flatMap((result) => result.status === 'fulfilled' && result.value.ok
        ? [result.value.artifact] : []);
      setArtifacts(loaded);
      setClipSelections(Object.fromEntries(loaded.flatMap((bundle) => bundle.highlights.map((item) =>
        [item.id, { selected: false, startMs: item.startMs, endMs: item.endMs }] as const))));
      setReviewConfirmed(false);
      setMessage(`已载入 ${loaded.length} 条录屏的候选；${results.length - loaded.length} 条读取失败。`);
    } catch { setMessage('批量候选读取失败。'); }
    finally { setArtifactBusy(false); }
  }

  function editSelection(id: string, change: Partial<ClipSelectionState>) {
    setClipSelections((current) => ({ ...current, [id]: { ...current[id], ...change } }));
    setReviewConfirmed(false);
  }

  async function exportReviewed() {
    if (!api || !artifacts.length) return;
    const selections = artifacts.flatMap((bundle) => bundle.highlights.flatMap((item) => {
      const choice = clipSelections[item.id];
      return choice?.selected ? [{ taskId: bundle.taskId, highlightId: item.id,
        startMs: choice.startMs, endMs: choice.endMs }] : [];
    }));
    setExportBusy(true);
    setMessage('正在生成所选切片；可留在当前工作台查看结果。');
    try {
      const result = await api.exportReviewed({ reviewConfirmed: true, selections, concurrency: 2 });
      if (!result.ok) setMessage(ERROR_TEXT[result.code] || '切片导出失败。');
      else {
        const completed = result.results.filter((item) => item.status === 'completed').length;
        const failed = result.results.filter((item) => item.status === 'failed').length;
        const cancelled = result.results.filter((item) => item.status === 'cancelled').length;
        setMessage(`本轮切片：完成 ${completed}，失败 ${failed}，取消 ${cancelled}。请人工检查成片。`);
        await refreshClips();
      }
    } catch { setMessage('切片导出失败，请检查本地运行环境。'); }
    finally { setExportBusy(false); setReviewConfirmed(false); }
  }

  async function importClip(id: string) {
    if (!api || !onImportClip) return;
    setMessage('');
    try {
      const result = await api.verifiedOutput(id);
      if (!result.ok) setMessage(ERROR_TEXT[result.code] || '切片验证失败。');
      else {
        onImportClip(result.path, result.durationMs);
        setMessage('已加入剪辑台素材，请继续人工剪辑和审片。');
      }
    } catch { setMessage('切片导入失败。'); }
  }

  const queued = tasks.some((task) => task.state === 'queued');
  const canRun = !!api && queued && !!rootLabel && !!nodeLabel && !!hotClipLabel &&
    !!llmBaseUrl.trim() && !!llmModel.trim() && allowModelDownload &&
    !queueBusy && !runInProgress && !actionBusy;
  const reviewedCandidates = artifacts.flatMap((bundle) => bundle.highlights);
  const selectedClips = reviewedCandidates.filter((item) => clipSelections[item.id]?.selected);
  const validClips = selectedClips.length > 0 && selectedClips.every((item) => {
    const choice = clipSelections[item.id];
    return Number.isSafeInteger(choice.startMs) && Number.isSafeInteger(choice.endMs) &&
      choice.startMs >= 0 && choice.endMs - choice.startMs >= 500 &&
      choice.endMs - choice.startMs <= 30 * 60_000;
  });
  const canExport = !!api && !!rootLabel && validClips && selectedClips.length <= 100 && reviewConfirmed &&
    !exportBusy && !actionBusy && !artifactBusy;

  return (
    <main className={styles.root}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>本地批量分析</span>
            <h1>直播高光</h1>
            <p>导入已授权直播录屏，批量生成带时间码和来源摘要的高光候选。</p>
          </div>
          <span className={styles.reviewBadge}>待人工审核</span>
        </header>

        {!api && <p role="alert" className={styles.notice}>高光服务尚未就绪，请重启桌面应用。</p>}
        {message && <p role="status" className={styles.notice}>{message}</p>}

        <section className={styles.card}>
          <div className={styles.sectionHeader}><span className={styles.step}>01</span><h2>录屏来源</h2></div>
          <p>目录和文件都通过系统对话框选择；每次最多导入 100 个视频。已有字幕可选同目录、同文件名的 SRT；未选择的录屏由 HotClip 转写。</p>
          <div className={styles.row}>
            <button type="button" onClick={() => api && void select(api.chooseRoot, (result) => {
              setRootLabel(result.label); setSelectedNames([]); setSelectedSubtitleNames([]);
              setArtifacts([]); setClipSelections({}); setReviewConfirmed(false);
            })} disabled={!api || actionBusy}>选择录屏目录</button>
            <span>{rootLabel || '未选择目录'}</span>
          </div>
          <div className={styles.row}>
            <button type="button" onClick={() => {
              if (!api) return;
              setSelectedNames([]); setSelectedSubtitleNames([]);
              void select(api.chooseRecordings, (result) => setSelectedNames(result.names));
            }}
              disabled={!api || !rootLabel || actionBusy}>选择录屏文件</button>
            <span>{selectedNames.length ? `已选择 ${selectedNames.length} 个：${selectedNames.slice(0, 3).join('、')}` : '未选择录屏'}</span>
          </div>
          <div className={styles.row}>
            <button type="button" onClick={() => {
              if (!api) return;
              setSelectedSubtitleNames([]);
              void select(api.chooseSubtitles, (result) => setSelectedSubtitleNames(result.names));
            }} disabled={!api || !selectedNames.length || actionBusy}>选择已有 SRT 字幕</button>
            <span>{selectedSubtitleNames.length
              ? `已配对 ${selectedSubtitleNames.length} 份：${selectedSubtitleNames.slice(0, 3).join('、')}`
              : '未选择字幕'}</span>
          </div>
          <div className={styles.row}>
            <label>每条最多候选 <input aria-label="每条最多候选" type="number" min="1" max="12" value={maxClips}
              onChange={(event) => setMaxClips(Number(event.target.value))} /></label>
            <button type="button" onClick={() => void importRecordings()}
              disabled={!api || !selectedNames.length || actionBusy || queueBusy}>导入录屏</button>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.sectionHeader}><span className={styles.step}>02</span><h2>分析环境</h2></div>
          <p>HotClip 需另行安装。分析可能访问所填 AI 服务；首次运行可能下载本地语音模型。</p>
          <div className={styles.row}>
            <button type="button" onClick={() => api && void select(api.chooseNode, (result) => setNodeLabel(result.label))}
              disabled={!api || actionBusy}>选择 Node.js</button><span>{nodeLabel || '未选择'}</span>
            <button type="button" onClick={() => api && void select(api.chooseHotClip, (result) => setHotClipLabel(result.label))}
              disabled={!api || actionBusy}>选择 HotClip</button><span>{hotClipLabel || '未选择'}</span>
          </div>
          <div className={styles.fields}>
            <label>AI 服务地址<input aria-label="AI 服务地址" value={llmBaseUrl} onChange={(event) => setLlmBaseUrl(event.target.value)} /></label>
            <label>模型名称<input aria-label="模型名称" value={llmModel} onChange={(event) => setLlmModel(event.target.value)} placeholder="例如 qwen3:8b" /></label>
            <label>API Key（仅当前会话）<input aria-label="API Key" type="password" value={llmApiKey} onChange={(event) => setLlmApiKey(event.target.value)} autoComplete="off" /></label>
          </div>
          <div className={styles.fields}>
            <label>并发数<input aria-label="并发数" type="number" min="1" max="4" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} /></label>
            <label>最多尝试<input aria-label="最多尝试" type="number" min="1" max="5" value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))} /></label>
            <label>单条超时（分钟）<input aria-label="单条超时分钟" type="number" min="1" max="360" value={timeoutMinutes} onChange={(event) => setTimeoutMinutes(Number(event.target.value))} /></label>
          </div>
          <label className={styles.consent}><input type="checkbox" aria-label="允许本次运行下载本地模型"
            checked={allowModelDownload} onChange={(event) => setAllowModelDownload(event.target.checked)} />
            允许本次运行按需下载本地模型</label>
          <button type="button" data-testid="run-highlights" className={styles.primary} disabled={!canRun}
            onClick={() => void run()}>运行排队任务</button>
          <button type="button" disabled={!canRun || actionBusy}
            onClick={() => void prepareAgentRun()}>准备智能体高光参数</button>
          <p>请先在设置中授权高光检测 30 分钟，再准备智能体参数；模型配置仅用于当前会话。</p>
        </section>

        <section className={styles.card}>
          <div className={styles.sectionHeader}><span className={styles.step}>03</span><h2>任务与候选</h2>
            <button type="button" onClick={() => void refresh()} disabled={!api}>刷新</button>
            <button type="button" onClick={() => void viewAllArtifacts()}
              disabled={!api || artifactBusy || !tasks.some((task) => task.state === 'completed')}>
              汇总已完成候选</button></div>
          {tasks.length === 0 ? <p>暂无任务。先选择并导入录屏。</p> : (
            <div className={styles.taskList}>
              {tasks.map((task) => (
                <div className={styles.task} key={task.id}>
                  <div><strong>{task.name}</strong><small>{task.sourceSha256.slice(0, 12)} · {stateLabel(task.state)} · 候选 {task.candidateCount}</small></div>
                  <div className={styles.row}>
                    {task.state === 'completed' && <button type="button" onClick={() => void viewArtifact(task.id)}
                      disabled={artifactBusy}>查看候选</button>}
                    {(task.state === 'queued' || task.state === 'running') &&
                      <button type="button" onClick={() => api && void taskAction(() => api.cancel(task.id))}>取消</button>}
                    {(task.state === 'failed' || task.state === 'interrupted') &&
                      <button type="button" onClick={() => api && void taskAction(() => api.retry(task.id, maxAttempts))}>重试</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {artifacts.length > 0 && <section className={styles.card}>
          <div className={styles.sectionHeader}><h2>高光候选</h2><button type="button" onClick={() => setArtifacts([])}>关闭</button></div>
          <p>候选仅供审核。逐段复核并调整时间码后，才会在本地生成切片；不会自动发布。</p>
          {reviewedCandidates.length === 0 ? <p>所选录屏没有符合条件的高光候选。</p> :
            artifacts.flatMap((bundle) => bundle.highlights.map((highlight) => {
              const index = reviewedCandidates.findIndex((item) => item.id === highlight.id);
              const sourceName = tasks.find((task) => task.id === bundle.taskId)?.name ?? '录屏';
              return <div className={styles.candidate} key={highlight.id}>
              <label><input type="checkbox" aria-label={`选择高光片段 ${index + 1}`}
                checked={clipSelections[highlight.id]?.selected ?? false}
                onChange={(event) => editSelection(highlight.id, { selected: event.target.checked })} />
                <strong>{formatTime(highlight.startMs)} – {formatTime(highlight.endMs)}</strong></label>
              <span>{sourceName} · {highlight.topic || '未命名片段'} · 评分 {highlight.score ?? '—'}</span>
              <label>开始毫秒<input aria-label={`片段 ${index + 1} 开始毫秒`} type="number" min="0" step="1"
                value={clipSelections[highlight.id]?.startMs ?? highlight.startMs}
                onChange={(event) => editSelection(highlight.id, { startMs: Number(event.target.value) })} /></label>
              <label>结束毫秒<input aria-label={`片段 ${index + 1} 结束毫秒`} type="number" min="0" step="1"
                value={clipSelections[highlight.id]?.endMs ?? highlight.endMs}
                onChange={(event) => editSelection(highlight.id, { endMs: Number(event.target.value) })} /></label>
            </div> }))}
          {reviewedCandidates.length > 0 && <>
            <label className={styles.consent}><input type="checkbox" aria-label="确认已人工审核所选片段"
              checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
              我已人工审核所选片段及时间边界</label>
            <div className={styles.row}>
              <button type="button" data-testid="export-reviewed" className={styles.primary}
                disabled={!canExport} onClick={() => void exportReviewed()}>生成所选切片</button>
              {exportBusy && <button type="button" onClick={() => api && void api.cancelExport()}>取消导出</button>}
              <span>已选 {selectedClips.length} 段；单批最多 100 段，同时最多导出 2 段。</span>
            </div>
          </>}
        </section>}

        <section className={styles.card}>
          <div className={styles.sectionHeader}><span className={styles.step}>04</span><h2>已复核切片</h2>
            <button type="button" onClick={() => void refreshClips()} disabled={!api}>刷新</button></div>
          <p>仅显示本地导出收据。加入剪辑台前会再次校验 MP4 摘要。</p>
          {reviewedClips.length === 0 ? <p>暂无已导出切片。</p> :
            <div className={styles.taskList}>{reviewedClips.map((clip) => <div className={styles.task} key={clip.id}>
              <div><strong>{formatTime(clip.startMs)} – {formatTime(clip.endMs)}</strong>
                <small>候选 {clip.highlightId.slice(0, 16)} · 输出 {clip.outputSha256.slice(0, 12)}</small></div>
              <button type="button" onClick={() => void importClip(clip.id)} disabled={!onImportClip}>加入剪辑台</button>
            </div>)}</div>}
        </section>
      </div>
    </main>
  );
}
