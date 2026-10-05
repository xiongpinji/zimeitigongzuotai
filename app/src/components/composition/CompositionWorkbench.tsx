import { useCallback, useEffect, useState } from 'react';
import type { CompositionV1BatchDto } from '../../lib/electron-api';
import type { CompositionReviewReport, HumanReviewDecision } from '../../../electron/composition/review';
import styles from './CompositionWorkbench.module.css';

const ERROR_TEXT: Record<string, string> = {
  no_project: '请先打开工程。', forbidden: '当前窗口没有操作权限。',
  invalid_input: '操作参数无效。', not_found: '找不到该版本工程。',
  review_required: '来源或时间线已修改，需要重新核对。',
  rights_blocked: '素材授权不允许当前用途。', media_changed: '素材内容已变化。',
  clip_unavailable: '已审核切片不可用，请回到直播高光检查。',
  source_mismatch: '来源与版本记录不一致。', source_changed: '来源已变化，请重新建立版本。',
  source_unavailable: '所选切片或素材已变化，或授权不符合当前用途。',
  duplicate_receipt: '同一高光只能选择一份审核切片。',
  model_unavailable: '当前默认 AI 模型不可用，请检查模型设置。',
  invalid_model_output: 'AI 没有生成符合要求的三个版本，请检查已审核摘要后重试。',
  insufficient_plans: 'AI 生成的独立版本不足三份。',
  duplicate_plans: '候选版本的叙事和证据过于重复，请调整输入后重试。',
  output_conflict: '成片文件与渲染记录不一致，已停止复用。',
  render_not_complete: '请先完成全部版本的渲染。',
  stale_evidence: '复核证据已过期，请重新分析。',
  batch_busy: '该批次正在运行。', internal_error: '本地操作失败，请检查工程和素材。',
  authorization_expired: '请先到设置授权智能体混剪生成，再返回这里准备；授权过期后也需重新授权。',
};
const RATING_LABELS = [
  ['independentClarity', '表达独立性'], ['appeal', '吸引力'], ['boundaries', '剪辑边界'],
  ['audiovisual', '视听质量'], ['factual', '事实准确性'],
] as const;
const DEFAULT_RATINGS: HumanReviewDecision['ratings'] = {
  independentClarity: 4, appeal: 4, boundaries: 4, audiovisual: 4, factual: 4,
};
const VETO_LABELS: Record<HumanReviewDecision['vetoReasons'][number], string> = {
  rights: '授权问题', misleading: '误导表达', privacy: '隐私问题',
  incorrect_product: '商品信息错误', broken_clip: '画面或音频损坏',
};

export function CompositionWorkbench({ active, projectDir, returnProjectDir,
  onOpenVersion, onReturnProject }: {
  active: boolean;
  projectDir: string | null;
  returnProjectDir: string | null;
  onOpenVersion: (path: string) => Promise<void>;
  onReturnProject: (path: string) => Promise<void>;
}) {
  const api = typeof window === 'undefined' ? undefined : window.compositionV1API;
  const [batches, setBatches] = useState<CompositionV1BatchDto[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [report, setReport] = useState<CompositionReviewReport | null>(null);
  const [resources, setResources] = useState<{ receipts: Array<{ id: string; highlightId: string;
    startMs: number; endMs: number; topic: string }>; assets: Array<{
      id: string; description: string; mediaType: 'video' | 'image' }> }>({ receipts: [], assets: [] });
  const [selectedReceipts, setSelectedReceipts] = useState<string[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [anonymousTopics, setAnonymousTopics] = useState<Record<string, string>>({});
  const [anonymousAssets, setAnonymousAssets] = useState<Record<string, string>>({});
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [platform, setPlatform] = useState<'douyin' | 'kuaishou' | 'wechat-channels' | 'xiaohongshu'>('douyin');
  const [region, setRegion] = useState('cn');
  const [commercialShortVideo, setCommercialShortVideo] = useState(false);
  const [approvedForModel, setApprovedForModel] = useState(false);
  const [reviewerId, setReviewerId] = useState('');
  const [reviewPlanId, setReviewPlanId] = useState('');
  const [ratings, setRatings] = useState(DEFAULT_RATINGS);
  const [veto, setVeto] = useState<HumanReviewDecision['vetoReasons'][number] | ''>('');
  const isInVersion = !!returnProjectDir && projectDir !== returnProjectDir;
  const selected = batches.find((batch) => batch.batchId === selectedBatchId) ?? batches[0];

  const refresh = useCallback(async () => {
    if (!api || isInVersion) return;
    try {
      const result = await api.list();
      if (!result.ok) { setMessage(ERROR_TEXT[result.code] ?? '版本列表读取失败。'); return; }
      setBatches(result.batches);
      setSelectedBatchId((current) => result.batches.some((batch) => batch.batchId === current)
        ? current : result.batches[0]?.batchId ?? '');
    } catch { setMessage('版本列表读取失败。'); }
  }, [api, isInVersion]);

  const refreshResources = useCallback(async () => {
    if (!api || isInVersion) return;
    try {
      const result = await api.resources();
      if (result.ok) setResources({ receipts: result.receipts, assets: result.assets });
      else setMessage(ERROR_TEXT[result.code] ?? '可用切片和素材读取失败。');
    } catch { setMessage('可用切片和素材读取失败。'); }
  }, [api, isInVersion]);

  useEffect(() => { if (active) { void refresh(); void refreshResources(); } },
    [active, projectDir, refresh, refreshResources]);

  const action = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try { await operation(); }
    catch { setMessage('本地操作失败，请检查工程和素材。'); }
    finally { setBusy(false); }
  };

  const render = () => action(async () => {
    if (!api || !selected || !selected.context || selected.contextMismatch) return;
    const result = await api.render({ batchId: selected.batchId,
      planIds: selected.versions.map((version) => version.planId),
      ...selected.context, resolution: '480p', quality: 'speed' });
    setMessage(result.ok ? `渲染结束：${result.versions.filter((version) => version.state === 'completed').length}/${result.versions.length} 版完成，仍需复核。`
      : ERROR_TEXT[result.code] ?? '渲染失败。');
    await refresh();
  });

  const prepareAgentRender = () => action(async () => {
    if (!api || !selected || !selected.context || selected.contextMismatch) return;
    const result = await api.prepareAgentRender({ batchId: selected.batchId,
      planIds: selected.versions.map((version) => version.planId),
      ...selected.context, resolution: '480p', quality: 'speed', approvedForRender: true });
    setMessage(result.ok ? '已为当前工程准备一次智能体渲染；生成成片后仍需人工审核。'
      : ERROR_TEXT[result.code] ?? '准备渲染失败，请检查批次、素材与授权。');
  });

  const create = () => action(async () => {
    if (!api || !approvedForModel || !selectedReceipts.length) return;
    const result = await api.create({ aspectRatio, platform, region,
      commercialShortVideo,
      selectedReceipts: selectedReceipts.map((receiptId) => ({ receiptId,
        anonymousTopic: anonymousTopics[receiptId]?.trim() ?? '',
        approvedTranscriptExcerpt: null })),
      selectedAssets: selectedAssets.map((assetId) => ({ assetId,
        anonymousDescription: anonymousAssets[assetId]?.trim() ?? '' })),
    });
    if (result.ok) {
      setMessage(`已建立 ${result.plans.length} 个待审版本；先打开时间线核对，再批量渲染。`);
      setSelectedBatchId(result.batchId);
      setReport(null);
      setApprovedForModel(false);
      await refresh();
    } else setMessage(ERROR_TEXT[result.code] ?? '版本生成失败。');
  });

  const prepareAgentBuild = () => action(async () => {
    if (!api || !approvedForModel || !selectedReceipts.length) return;
    const result = await api.prepareAgentBuild({ aspectRatio, platform, region,
      commercialShortVideo, approvedForModel: true,
      selectedReceipts: selectedReceipts.map((receiptId) => ({ receiptId,
        anonymousTopic: anonymousTopics[receiptId]?.trim() ?? '', approvedTranscriptExcerpt: null })),
      selectedAssets: selectedAssets.map((assetId) => ({ assetId,
        anonymousDescription: anonymousAssets[assetId]?.trim() ?? '' })),
    });
    setMessage(result.ok ? '已为当前工程准备一次智能体混剪生成；授权有效期内可触发，生成后仍要人工复核。'
      : ERROR_TEXT[result.code] ?? '准备失败，请检查当前工程、素材与授权。');
    if (result.ok) setApprovedForModel(false);
  });

  const recommend = () => action(async () => {
    if (!api) return;
    const query = selectedReceipts.map((id) => anonymousTopics[id]?.trim()).filter(Boolean).join('；');
    if (!query) { setMessage('请先填写所选高光的匿名摘要。'); return; }
    const result = await api.recommend({ query, platform, region, commercialShortVideo });
    if (!result.ok) { setMessage(ERROR_TEXT[result.code] ?? '素材推荐失败。'); return; }
    if (result.status !== 'ok' || !result.recommendations.length) {
      setMessage(result.status === 'index_unavailable' ? '本地语义索引尚未就绪，请先到“授权素材”建立索引。'
        : '当前用途下没有可推荐的授权素材。');
      return;
    }
    const ids = result.recommendations.map((item) => item.assetId);
    setSelectedAssets(ids);
    setAnonymousAssets((current) => ({ ...current, ...Object.fromEntries(ids.map((id) =>
      [id, resources.assets.find((asset) => asset.id === id)?.description ?? ''])) }));
    setApprovedForModel(false);
    setMessage(`找到 ${ids.length} 个符合当前用途的素材，请核对描述和授权后再生成。`);
  });

  const analyze = () => action(async () => {
    if (!api || !selected) return;
    const result = await api.analyze(selected.batchId, selected.versions.map((version) => version.planId));
    if (result.ok) { setReport(result.report); setReviewPlanId(result.report.versions[0]?.planId ?? '');
      setMessage('相似度分析完成。全部版本仍需人工复核。'); }
    else setMessage(ERROR_TEXT[result.code] ?? '分析失败。');
  });

  const review = () => action(async () => {
    if (!api || !report || !selected || !reviewPlanId || !reviewerId.trim()) {
      setMessage('请先完成分析并填写复核者代号。'); return;
    }
    const result = await api.review(selected.batchId, {
      planId: reviewPlanId, reviewerId: reviewerId.trim(), evidenceSha256: report.evidenceSha256,
      ratings, vetoReasons: veto ? [veto] : [],
    });
    setMessage(result.ok ? `已记录复核：${result.result.reviewStatus}。平台原创状态仍未核实。`
      : ERROR_TEXT[result.code] ?? '复核记录失败。');
  });

  return <main className={styles.root} aria-label="多版本混剪工作台">
    <header className={styles.header}>
      <div><h1>多版本混剪</h1><p>每版是独立剪辑工程；成片、相似度与人工复核分开记录。</p></div>
      <button type="button" onClick={() => void refresh()} disabled={busy || isInVersion}>刷新</button>
    </header>
    {isInVersion ? <section className={styles.empty}>
      <h2>正在编辑独立版本</h2>
      <p>保存时间线后返回批次工程，再检查该版本是否需要重新审核。</p>
      <button type="button" onClick={() => void onReturnProject(returnProjectDir!)}>返回批次工程</button>
    </section> : <>
      {!projectDir && <p className={styles.notice}>请先打开工程。</p>}
      {projectDir && <section className={styles.create}>
        <h2>从已审核素材生成版本</h2>
        <p>选择已导出的高光切片，并检查发送给当前默认 AI 的匿名摘要。素材授权会在生成和渲染时重新核对。</p>
        <div className={styles.controls}>
          <label>画幅 <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)}>
            <option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option>
          </select></label>
          <label>平台 <select value={platform} onChange={(event) => setPlatform(event.target.value as typeof platform)}>
            <option value="douyin">抖音</option><option value="kuaishou">快手</option>
            <option value="wechat-channels">视频号</option><option value="xiaohongshu">小红书</option>
          </select></label>
          <label>地区 <input aria-label="素材使用地区" value={region} maxLength={2}
            onChange={(event) => setRegion(event.target.value.toLowerCase())} /></label>
          <label><input type="checkbox" checked={commercialShortVideo}
            onChange={(event) => setCommercialShortVideo(event.target.checked)} />商业短视频用途</label>
        </div>
        <div className={styles.resourceList}>
          {resources.receipts.length ? resources.receipts.map((receipt) => <label key={receipt.id} className={styles.resource}>
            <input type="checkbox" checked={selectedReceipts.includes(receipt.id)} onChange={(event) => {
              setSelectedReceipts((current) => event.target.checked ? [...current, receipt.id] :
                current.filter((id) => id !== receipt.id));
              setApprovedForModel(false);
            }} />
            <span>高光 {receipt.startMs / 1000}–{receipt.endMs / 1000} 秒 · {receipt.topic || '未命名'}</span>
            {selectedReceipts.includes(receipt.id) && <input aria-label={`匿名摘要 ${receipt.id}`} maxLength={500}
              placeholder="给 AI 的匿名主题，不含姓名、账号或隐私"
              value={anonymousTopics[receipt.id] ?? ''}
              onChange={(event) => { setAnonymousTopics((current) => ({ ...current,
                [receipt.id]: event.target.value })); setApprovedForModel(false); }} />}
          </label>) : <p>还没有已审核并导出的切片，请先去“直播高光”完成审核与导出。</p>}
        </div>
        {!!resources.assets.length && <details><summary>可选授权素材</summary>
          <div className={styles.resourceList}>{resources.assets.map((asset) => <label key={asset.id} className={styles.resource}>
            <input type="checkbox" checked={selectedAssets.includes(asset.id)} onChange={(event) => {
              setSelectedAssets((current) => event.target.checked ? [...current, asset.id] :
                current.filter((id) => id !== asset.id)); setApprovedForModel(false);
            }} />
            <span>{asset.mediaType === 'video' ? '视频' : '图片'} · {asset.description}</span>
            {selectedAssets.includes(asset.id) && <input aria-label={`匿名素材描述 ${asset.id}`} maxLength={500}
              placeholder="给 AI 的匿名素材描述" value={anonymousAssets[asset.id] ?? ''}
              onChange={(event) => { setAnonymousAssets((current) => ({ ...current,
                [asset.id]: event.target.value })); setApprovedForModel(false); }} />}
          </label>)}</div>
        </details>}
        <button type="button" disabled={busy || !selectedReceipts.length ||
          selectedReceipts.some((id) => !anonymousTopics[id]?.trim()) || !/^[a-z]{2}$/.test(region)}
        onClick={() => void recommend()}>按匿名摘要智能推荐素材</button>
        <label><input type="checkbox" checked={approvedForModel}
          onChange={(event) => setApprovedForModel(event.target.checked)} />我已检查上述摘要可发送给当前默认 AI 模型</label>
        <button type="button" disabled={busy || !approvedForModel || !selectedReceipts.length ||
          selectedReceipts.some((id) => !anonymousTopics[id]?.trim()) ||
          selectedAssets.some((id) => !anonymousAssets[id]?.trim()) || !/^[a-z]{2}$/.test(region)}
        onClick={() => void create()}>用当前 AI 生成至少三版</button>
        <button type="button" disabled={busy || !approvedForModel || !selectedReceipts.length ||
          selectedReceipts.some((id) => !anonymousTopics[id]?.trim()) ||
          selectedAssets.some((id) => !anonymousAssets[id]?.trim()) || !/^[a-z]{2}$/.test(region)}
        onClick={() => void prepareAgentBuild()}>准备供智能体生成一次</button>
      </section>}
      {projectDir && !batches.length && <section className={styles.empty}>
        <h2>当前工程还没有混剪版本</h2>
        <p>完成上面的素材选择与匿名摘要后，生成三份待审独立时间线。</p>
      </section>}
      {selected && <>
        <div className={styles.controls}>
          <label>批次 <select value={selected.batchId} onChange={(event) => {
            setSelectedBatchId(event.target.value); setReport(null);
          }}>{batches.map((batch) => <option key={batch.batchId} value={batch.batchId}>{batch.batchId}</option>)}</select></label>
          <span>平台：{selected.context?.platform ?? '未记录'} · 地区：{selected.context?.region ?? '未记录'}</span>
          {selected.contextMismatch && <span className={styles.warning}>版本用途不一致，请分别核对。</span>}
          <button type="button" disabled={busy || selected.versions.length < 3 || selected.contextMismatch}
            onClick={() => void render()}>批量渲染</button>
          <button type="button" disabled={busy || selected.versions.length < 3 || selected.contextMismatch}
            onClick={() => void prepareAgentRender()}>准备供智能体渲染一次</button>
          <button type="button" disabled={busy} onClick={() => void api?.cancel(selected.batchId).then(() => refresh())}>取消渲染</button>
          <button type="button" disabled={busy || selected.versions.length < 3}
            onClick={() => void analyze()}>分析相似度</button>
        </div>
        <div className={styles.grid}>{selected.versions.map((version) => <article className={styles.card} key={version.planId}>
          <h2>{version.planId}</h2><p>{version.narrativeSummary}</p>
          <span>渲染：{version.renderState ?? '未开始'}</span>
          {version.timelineModified && <span className={styles.warning}>时间线已修改，需重新核对来源</span>}
          {version.renderError && <span className={styles.warning}>{ERROR_TEXT[version.renderError] ?? version.renderError}</span>}
          <button type="button" disabled={busy} onClick={() => void action(async () => {
            if (!api) return;
            const result = await api.open(selected.batchId, version.planId);
            if (result.ok) await onOpenVersion(result.projectDir);
            else setMessage(ERROR_TEXT[result.code] ?? '打开版本失败。');
          })}>打开独立时间线</button>
        </article>)}</div>
      </>}
      {report && <section className={styles.review}>
        <h2>相似度证据 · 人工复核必需</h2>
        <p>画面、音频与来源分数只提示可能重复；不能推断平台原创认定。</p>
        {report.pairs.map((pair) => <div key={pair.planIds.join(':')} className={styles.pair}>
          {pair.planIds.join(' / ')} · 文本 {pair.textSimilarity} · 来源 {pair.sourceOverlap}
          · 画面 {pair.visualSimilarity ?? '不可用'} · 音频 {pair.audioSimilarity ?? '不可用'}
          {pair.flags.length > 0 && <strong> · 提醒：{pair.flags.join('、')}</strong>}
        </div>)}
        <div className={styles.form}>
          <label>版本 <select value={reviewPlanId} onChange={(event) => setReviewPlanId(event.target.value)}>
            {report.versions.map((version) => <option key={version.planId} value={version.planId}>{version.planId}</option>)}
          </select></label>
          <label>复核者代号 <input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} maxLength={128} /></label>
          {RATING_LABELS.map(([key, label]) => <label key={key}>{label}
            <select value={ratings[key]} onChange={(event) => setRatings((current) => ({
              ...current, [key]: Number(event.target.value),
            }))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select>
          </label>)}
          <label>否决原因 <select value={veto} onChange={(event) =>
            setVeto(event.target.value as typeof veto)}><option value="">无</option>
            {Object.entries(VETO_LABELS).map(([key, label]) =>
              <option key={key} value={key}>{label}</option>)}</select></label>
          <button type="button" disabled={busy} onClick={() => void review()}>记录人工复核</button>
        </div>
        <p className={styles.notice}>不同代号不等于已验证的独立审片人。最终验收仍需真实授权素材和双人盲审。</p>
      </section>}
    </>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
  </main>;
}
