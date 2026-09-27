import { useCallback, useEffect, useState } from 'react';
import type { AssetLibraryRecordDto } from '../../../electron/assets/asset-library-ipc';
import type { AssetUsageContext, BrollRecommendation, RightsEvidenceKind } from '../../../electron/assets/asset-rights';
import type { AssetImportMetadata } from '../../../electron/assets/local-asset-library';
import { PRODUCTION_PLATFORMS, type ProductionPlatform } from '../../types/production-contracts';
import styles from './AssetLibraryWorkbench.module.css';

const PLATFORM_LABELS: Record<ProductionPlatform, string> = {
  douyin: '抖音', kuaishou: '快手', 'wechat-channels': '视频号', xiaohongshu: '小红书',
};
const EVIDENCE_LABELS: Record<RightsEvidenceKind, string> = {
  'purchase-record': '购买记录', 'license-document': '授权文件', contract: '合同',
  'platform-permission': '平台许可', 'written-approval': '书面同意',
  'public-domain': '公有领域证明', other: '其他证据',
};

function issue(code: string): string {
  const text: Record<string, string> = {
    forbidden: '当前窗口无权操作素材库。', busy: '正在处理素材，请稍后重试。',
    invalid_request: '输入无效，请检查描述和授权信息。', invalid_metadata: '素材描述或授权字段无效。',
    invalid_selection: '所选文件无效。', selection_required: '请先通过系统对话框选择素材。',
    invalid_media: '媒体文件无法校验或读取时长。', invalid_source: '请选择受支持的普通媒体文件。',
    rights_blocked: '该素材未获得当前平台、地区和用途的有效授权。',
    media_changed: '素材字节已变化，请重新导入。',
    index_unavailable: '本地语义索引不可用，请确认 Ollama 和 nomic-embed-text-v2-moe 已安装运行。',
    stale_index: '索引已过期，请重新建立索引。',
    invalid_response: '本地模型返回了无效向量。',
    store_corrupt: '本地素材目录损坏，已停止使用。',
  };
  return text[code] ?? `操作失败：${code}`;
}

export function AssetLibraryWorkbench({ active, onImportAsset }: {
  active: boolean;
  onImportAsset: (path: string, type: 'video' | 'image' | 'audio', durationMs?: number) => void;
}) {
  const api = typeof window === 'undefined' ? undefined : window.assetLibraryAPI;
  const [records, setRecords] = useState<AssetLibraryRecordDto[]>([]);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [source, setSource] = useState('');
  const [rightsHolder, setRightsHolder] = useState('');
  const [license, setLicense] = useState('');
  const [usageScope, setUsageScope] = useState('');
  const [autoUse, setAutoUse] = useState(false);
  const [grantPlatforms, setGrantPlatforms] = useState<ProductionPlatform[]>([]);
  const [grantRegion, setGrantRegion] = useState('cn');
  const [evidenceKind, setEvidenceKind] = useState<RightsEvidenceKind>('license-document');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [queryText, setQueryText] = useState('');
  const [queryPlatform, setQueryPlatform] = useState<ProductionPlatform>('douyin');
  const [queryRegion, setQueryRegion] = useState('cn');
  const [minScore, setMinScore] = useState('0.55');
  const [recommendations, setRecommendations] = useState<readonly BrollRecommendation[]>([]);
  const [recommendStatus, setRecommendStatus] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!api) return;
    const result = await api.list();
    if (result.ok) setRecords(result.records);
    else setMessage(issue(result.code));
  }, [api]);

  useEffect(() => {
    if (active) void refresh().catch(() => setMessage('素材列表读取失败。'));
  }, [active, refresh]);

  function context(): AssetUsageContext {
    return {
      platform: queryPlatform, region: queryRegion.trim() || 'cn',
      usedAt: new Date().toISOString(), commercialShortVideo: true,
    };
  }

  async function choose() {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.choose();
      if (result.ok) { setSelectedLabel(result.label); setMessage(`已选择：${result.label}`); }
      else setMessage(issue(result.code));
    } catch { setMessage('文件选择失败。'); }
    finally { setBusy(false); }
  }

  async function importSelected() {
    if (!api || busy) return;
    if (!selectedLabel || !description.trim() || !source.trim() || !rightsHolder.trim() ||
        !license.trim() || !usageScope.trim()) {
      setMessage('请先选择素材，并填写描述、来源、权利人、许可和使用范围。');
      return;
    }
    const hasGrant = grantPlatforms.length > 0 && evidenceRef.trim().length > 0 && grantRegion.trim().length > 0;
    if (autoUse && !hasGrant) {
      setMessage('自动使用必须填写授权平台、地区和证据引用。');
      return;
    }
    const metadata: AssetImportMetadata = {
      semanticText: description.trim(), tags: tags.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean),
      transcript: null, source: source.trim(), rightsHolder: rightsHolder.trim(),
      license: license.trim(), usageScope: usageScope.trim(), authorizedForAutoUse: autoUse,
      rightsGrant: hasGrant ? {
        platforms: grantPlatforms, regions: [grantRegion.trim()], commercialShortVideoUse: 'allowed',
        validFrom: validFrom ? `${validFrom}T00:00:00.000Z` : null,
        validUntil: validUntil ? `${validUntil}T23:59:59.999Z` : null,
        evidence: [{ kind: evidenceKind, ref: evidenceRef.trim(),
          collectedAt: new Date().toISOString(), note: null }],
      } : null,
    };
    setBusy(true);
    try {
      const result = await api.importSelected(metadata);
      if (result.ok) {
        setSelectedLabel('');
        setMessage(`已导入素材 ${result.record.id.slice(0, 18)}…`);
        await refresh();
      } else setMessage(issue(result.code));
    } catch { setMessage('素材导入失败。'); }
    finally { setBusy(false); }
  }

  async function indexAssets() {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.index();
      if (result.ok) setMessage(`本地文本语义索引已更新：${result.indexedCount} 项。`);
      else setMessage(issue(result.code));
    } catch { setMessage('本地模型索引失败。'); }
    finally { setBusy(false); }
  }

  async function recommend() {
    if (!api || busy || !queryText.trim()) return;
    const score = Number(minScore);
    if (!Number.isFinite(score) || score < 0 || score > 1) { setMessage('相似度阈值必须在 0 到 1 之间。'); return; }
    setBusy(true);
    try {
      const result = await api.recommend({ text: queryText.trim(), maxResults: 10, minScore: score }, context());
      if (result.ok) {
        setRecommendations(result.result.recommendations);
        setRecommendStatus(result.result.message ?? `找到 ${result.result.recommendations.length} 条匹配。`);
        if (result.result.status === 'index_unavailable') setMessage('本地索引不可用，请重新建立索引。');
      } else setMessage(issue(result.code));
    } catch { setMessage('语义检索失败。'); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.revoke(id);
      if (result.ok) { setMessage('已撤销该素材的自动使用资格。'); await refresh(); setRecommendations([]); }
      else setMessage(issue(result.code));
    } catch { setMessage('撤销授权失败。'); }
    finally { setBusy(false); }
  }

  async function useInEditor(id: string) {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.useInEditor(id, context());
      if (result.ok) {
        if (result.mediaType === 'subtitle') { setMessage('字幕素材暂不支持加入剪辑台。'); return; }
        onImportAsset(result.path, result.mediaType, result.durationMs ?? undefined);
      }
      else setMessage(issue(result.code));
    } catch { setMessage('素材验证失败，无法加入剪辑台。'); }
    finally { setBusy(false); }
  }

  return (
    <main className={styles.root}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>LOCAL MATERIAL LIBRARY</span>
            <h1>授权素材库</h1>
            <p>保存本地素材与授权记录，使用本机 Ollama 对手填描述做文本语义匹配。结果仍需人工审片；这里不识别视频画面，也不保证平台原创判定。</p>
          </div>
        </header>
        {message && <div className={styles.notice} role="status">{message}</div>}
        <section className={styles.card}>
          <h2>1. 导入素材与授权</h2>
          <div className={styles.row}><button type="button" onClick={() => void choose()} disabled={busy}>选择本地文件</button><span>{selectedLabel || '尚未选择文件'}</span></div>
          <div className={styles.fields}>
            <label className={styles.wide}>画面描述（由你填写，供文本匹配）<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4096} /></label>
            <label>标签（逗号分隔）<input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
            <label>素材来源<input value={source} onChange={(event) => setSource(event.target.value)} /></label>
            <label>权利持有人<input value={rightsHolder} onChange={(event) => setRightsHolder(event.target.value)} /></label>
            <label>许可类型<input value={license} onChange={(event) => setLicense(event.target.value)} /></label>
            <label>使用范围说明<input value={usageScope} onChange={(event) => setUsageScope(event.target.value)} /></label>
            <label>授权地区<input value={grantRegion} onChange={(event) => setGrantRegion(event.target.value)} /></label>
            <label>有效起始日<input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label>
            <label>有效截止日<input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
            <label>证据类型<select value={evidenceKind} onChange={(event) => setEvidenceKind(event.target.value as RightsEvidenceKind)}>{Object.entries(EVIDENCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className={styles.wide}>授权证据引用<input value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder="合同编号、本地记录编号等；不要粘贴密钥" /></label>
          </div>
          <div className={styles.platforms}>{PRODUCTION_PLATFORMS.map((platform) => <label key={platform}><input type="checkbox" checked={grantPlatforms.includes(platform)} onChange={(event) => setGrantPlatforms((current) => event.target.checked ? [...current, platform] : current.filter((item) => item !== platform))} />{PLATFORM_LABELS[platform]}</label>)}</div>
          <label className={styles.check}><input type="checkbox" checked={autoUse} onChange={(event) => setAutoUse(event.target.checked)} />我确认上述平台和地区允许将此素材用于商业短视频，并允许系统自动推荐</label>
          <button type="button" className={styles.primary} onClick={() => void importSelected()} disabled={busy}>导入素材</button>
        </section>
        <section className={styles.card}>
          <h2>2. 本地文本匹配</h2>
          <p>需要本机已安装并运行 Ollama 的 nomic-embed-text-v2-moe 多语言模型。索引仅发送描述与标签到 127.0.0.1，不会自动下载模型。</p>
          <div className={styles.row}><button type="button" onClick={() => void indexAssets()} disabled={busy || records.length === 0}>建立／更新索引</button><span>当前目录 {records.length} 项</span></div>
          <div className={styles.fields}>
            <label className={styles.wide}>寻找什么画面<input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="例如：夜晚城市霓虹街景" /></label>
            <label>目标平台<select value={queryPlatform} onChange={(event) => setQueryPlatform(event.target.value as ProductionPlatform)}>{PRODUCTION_PLATFORMS.map((platform) => <option key={platform} value={platform}>{PLATFORM_LABELS[platform]}</option>)}</select></label>
            <label>目标地区<input value={queryRegion} onChange={(event) => setQueryRegion(event.target.value)} /></label>
            <label>最低相似度<input type="number" min="0" max="1" step="0.05" value={minScore} onChange={(event) => setMinScore(event.target.value)} /></label>
          </div>
          <button type="button" className={styles.primary} onClick={() => void recommend()} disabled={busy || !queryText.trim()}>按授权范围推荐</button>
          {recommendStatus && <p className={styles.status}>{recommendStatus}</p>}
          <div className={styles.list}>{recommendations.map((item) => <article className={styles.item} key={item.assetId}>
            <div><strong>{item.assetId.slice(0, 20)}… · {(item.similarity * 100).toFixed(1)}%</strong><small>{item.source} · {item.rightsHolder} · 证据 {item.evidenceRefs.join('、')}</small></div>
            <button type="button" onClick={() => void useInEditor(item.assetId)} disabled={busy}>加入剪辑台</button>
          </article>)}</div>
        </section>
        <section className={styles.card}>
          <h2>素材与授权记录</h2>
          <div className={styles.list}>{records.length === 0 ? <p>暂无素材。</p> : records.map((item) => <article className={styles.item} key={item.id}>
            <div><strong>{item.semanticText}</strong><small>{item.mediaType} · {item.source} · {item.rightsHolder} · {item.authorizedForAutoUse ? '允许自动使用' : '未授权自动使用'}</small><small>{item.id}</small></div>
            {item.authorizedForAutoUse && <button type="button" onClick={() => void revoke(item.id)} disabled={busy}>撤销自动使用</button>}
          </article>)}</div>
        </section>
      </div>
    </main>
  );
}
