import { useCallback, useEffect, useState } from 'react';
import type { HighlightArtifactBundle } from '../../../electron/highlights/highlight-batch-artifacts';
import type { HighlightV1TaskDto, HighlightV1Result } from '../../../electron/highlights/product-highlight-ipc';
import styles from './HighlightWorkbench.module.css';

const ERROR_TEXT: Record<string, string> = {
  forbidden: '当前窗口没有操作权限。',
  busy: '当前有高光任务或文件选择正在进行。',
  stopped: '高光服务正在关闭，请稍后重启应用。',
  invalid_request: '参数无效，请检查填写内容。',
  invalid_selection: '所选文件不符合要求，请重新选择。',
  selection_required: '请先完成对应的文件选择。',
  consent_required: '运行前请确认本地模型下载许可。',
  source_unavailable: '录屏源文件已变化或无法读取，请重新选择。',
  root_mismatch: '排队任务包含其他目录的录屏。请先选择原目录，或取消这些任务。',
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

export function HighlightWorkbench({ active }: { active: boolean }) {
  const api = typeof window === 'undefined' ? undefined : window.highlightV1API;
  const [tasks, setTasks] = useState<HighlightV1TaskDto[]>([]);
  const [queueBusy, setQueueBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [runInProgress, setRunInProgress] = useState(false);
  const [message, setMessage] = useState('');
  const [rootLabel, setRootLabel] = useState('');
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
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
  const [artifact, setArtifact] = useState<HighlightArtifactBundle | null>(null);

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
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [active, api, refresh]);

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
    try {
      const result = await api.read(id);
      if (result.ok) setArtifact(result.artifact);
      else setMessage(ERROR_TEXT[result.code]);
    } catch { setMessage('候选读取失败。'); }
  }

  const queued = tasks.some((task) => task.state === 'queued');
  const canRun = !!api && queued && !!rootLabel && !!nodeLabel && !!hotClipLabel &&
    !!llmBaseUrl.trim() && !!llmModel.trim() && allowModelDownload &&
    !queueBusy && !runInProgress && !actionBusy;

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
          <p>目录和文件都通过系统对话框选择；每次最多导入 100 个视频。</p>
          <div className={styles.row}>
            <button type="button" onClick={() => api && void select(api.chooseRoot, (result) => {
              setRootLabel(result.label); setSelectedNames([]);
            })} disabled={!api || actionBusy}>选择录屏目录</button>
            <span>{rootLabel || '未选择目录'}</span>
          </div>
          <div className={styles.row}>
            <button type="button" onClick={() => {
              if (!api) return;
              setSelectedNames([]);
              void select(api.chooseRecordings, (result) => setSelectedNames(result.names));
            }}
              disabled={!api || !rootLabel || actionBusy}>选择录屏文件</button>
            <span>{selectedNames.length ? `已选择 ${selectedNames.length} 个：${selectedNames.slice(0, 3).join('、')}` : '未选择录屏'}</span>
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
        </section>

        <section className={styles.card}>
          <div className={styles.sectionHeader}><span className={styles.step}>03</span><h2>任务与候选</h2>
            <button type="button" onClick={() => void refresh()} disabled={!api}>刷新</button></div>
          {tasks.length === 0 ? <p>暂无任务。先选择并导入录屏。</p> : (
            <div className={styles.taskList}>
              {tasks.map((task) => (
                <div className={styles.task} key={task.id}>
                  <div><strong>{task.name}</strong><small>{task.sourceSha256.slice(0, 12)} · {stateLabel(task.state)} · 候选 {task.candidateCount}</small></div>
                  <div className={styles.row}>
                    {task.state === 'completed' && <button type="button" onClick={() => void viewArtifact(task.id)}>查看候选</button>}
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

        {artifact && <section className={styles.card}>
          <div className={styles.sectionHeader}><h2>高光候选</h2><button type="button" onClick={() => setArtifact(null)}>关闭</button></div>
          <p>候选仅供审核，尚未生成切片视频，也不会自动发布。</p>
          {artifact.highlights.length === 0 ? <p>该录屏没有符合条件的高光候选。</p> :
            artifact.highlights.map((highlight) => <div className={styles.candidate} key={highlight.id}>
              <strong>{formatTime(highlight.startMs)} – {formatTime(highlight.endMs)}</strong>
              <span>{highlight.topic || '未命名片段'} · 评分 {highlight.score ?? '—'}</span>
            </div>)}
        </section>}
      </div>
    </main>
  );
}
