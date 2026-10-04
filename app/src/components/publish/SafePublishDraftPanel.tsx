import { useEffect, useRef, useState } from 'react';
import type { AccountV2Dto, CompositionV1BatchDto } from '../../lib/electron-api';
import type { ProductPublishDraftAssignment, ProductPublishDraftDto, ProductPublishDraftPreview } from
  '../../../electron/publish/product-publish-drafts';

const PLATFORM: Record<AccountV2Dto['platform'], string> = {
  douyin: 'douyin', kuaishou: 'kuaishou', tencent: 'wechat-channels',
  xiaohongshu: 'xiaohongshu',
};
const PLATFORM_NAME: Record<AccountV2Dto['platform'], string> = {
  douyin: '抖音', kuaishou: '快手', tencent: '视频号', xiaohongshu: '小红书',
};
type Choice = { version: string; title: string; description: string; tags: string };
const emptyChoice = (): Choice => ({ version: '', title: '', description: '', tags: '' });
const errorText: Record<string, string> = {
  no_project: '请先打开工程。', account_not_ready: '账号登录态未通过检查。',
  review_not_ready: '所选版本尚未通过复核，或复核证据已变化。',
  platform_mismatch: '账号平台与视频版本平台不一致。',
  account_missing: '账号已不存在，请刷新。', invalid_input: '请填写完整标题并检查选项。',
  idempotency_conflict: '已有相同草稿键，但内容不同，请刷新后检查。',
};

/** 安全账号与已审核混剪版本的产品草稿入口；这里没有提交按钮。 */
export function SafePublishDraftPanel({ projectDir }: { projectDir: string | null }) {
  const [accounts, setAccounts] = useState<AccountV2Dto[]>([]);
  const [batches, setBatches] = useState<CompositionV1BatchDto[]>([]);
  const [drafts, setDrafts] = useState<ProductPublishDraftDto[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [preview, setPreview] = useState<{ key: string; value: ProductPublishDraftPreview } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const refreshSerial = useRef(0);

  const refresh = async () => {
    const serial = ++refreshSerial.current;
    setMessage('');
    setPreview(null);
    try {
      const [accountResult, compositionResult, draftResult] = await Promise.all([
        window.accountV2API.list(), window.compositionV1API.list(),
        window.publishV2DraftAPI.listDrafts(),
      ]);
      if (serial !== refreshSerial.current) return;
      if (!accountResult.ok || !compositionResult.ok || !draftResult.ok) {
        setMessage('安全账号、混剪版本或草稿暂不可用。'); return;
      }
      setAccounts(accountResult.accounts);
      setBatches(compositionResult.batches);
      setDrafts(draftResult.drafts);
    } catch { if (serial === refreshSerial.current) setMessage('服务暂不可用，请稍后刷新。'); }
  };
  useEffect(() => {
    refreshSerial.current++;
    setAccounts([]); setBatches([]); setDrafts([]); setChoices({}); setPreview(null); setMessage('');
    if (projectDir) void refresh();
    return () => { refreshSerial.current++; };
  }, [projectDir]);

  const versionsFor = (account: AccountV2Dto) => batches.flatMap((batch) =>
    batch.context?.platform === PLATFORM[account.platform] && !batch.contextMismatch
      ? batch.versions.filter((version) => version.renderState === 'completed' &&
          version.outputSha256).map((version) => ({
          key: `${batch.batchId}:${version.planId}`, batchId: batch.batchId,
          planId: version.planId, summary: version.narrativeSummary,
        })) : []);
  const setChoice = (id: string, patch: Partial<Choice>) => {
    setChoices((current) => ({ ...current, [id]: { ...(current[id] ?? emptyChoice()), ...patch } }));
    setPreview(null);
  };
  const assignments = (): ProductPublishDraftAssignment[] => accounts.flatMap((account) => {
    const choice = choices[account.id];
    if (!choice?.version) return [];
    const selected = versionsFor(account).find((version) => version.key === choice.version);
    if (!selected) return [];
    return [{ accountId: account.id, batchId: selected.batchId, planId: selected.planId,
      metadata: { title: choice.title.trim(), description: choice.description.trim(),
        tags: choice.tags.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean),
        coverRefs: [], scheduleAt: null }, commerceRequest: null }];
  });
  const perform = async (stage: boolean) => {
    const input = assignments();
    if (!input.length || input.some((item) => !item.metadata.title)) {
      setMessage('请至少选择一个账号、匹配版本，并填写标题。'); return;
    }
    const key = JSON.stringify(input);
    if (stage && preview?.key !== key) { setMessage('内容已变化，请重新预览。'); return; }
    setBusy(true);
    try {
      if (stage) {
        const result = await window.publishV2DraftAPI.stage(input);
        if (!result.ok) { setPreview(null); setMessage(errorText[result.code] ?? '草稿操作未完成，请检查当前状态。'); }
        else {
          setPreview(null);
          const list = await window.publishV2DraftAPI.listDrafts();
          if (list.ok) setDrafts(list.drafts);
          setMessage(`已保存 ${result.created} 个草稿，${result.existing} 个已存在；尚未向平台发布。`);
        }
      } else {
        const result = await window.publishV2DraftAPI.preview(input);
        if (!result.ok) { setPreview(null); setMessage(errorText[result.code] ?? '草稿操作未完成，请检查当前状态。'); }
        else { setPreview({ key, value: result }); setMessage('预览通过，请核对重复版本风险后保存草稿。'); }
      }
    } catch { setPreview(null); setMessage('服务暂不可用，请稍后重试。'); }
    finally { setBusy(false); }
  };
  const cancelDraft = async (taskId: string) => {
    setBusy(true);
    try {
      const result = await window.publishV2DraftAPI.cancelDraft(taskId);
      if (!result.ok) { setMessage(errorText[result.code] ?? '取消草稿失败，请刷新后重试。'); return; }
      const list = await window.publishV2DraftAPI.listDrafts();
      if (list.ok) setDrafts(list.drafts);
      setMessage(result.cancelled ? '草稿已取消；未向平台发布。' : '草稿状态已变化，请刷新。');
    } catch { setMessage('取消草稿失败，请稍后重试。'); }
    finally { setBusy(false); }
  };

  return <section aria-label="安全账号发布草稿" style={{ padding: '18px 24px', borderBottom: '1px solid var(--color-border-subtle)' }}>
    <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>安全账号 · 审核版视频草稿</h3>
    <p style={{ margin: '0 0 12px', fontSize: 12 }}>为每个账号选择已渲染并通过人工复核的版本。保存后进入持久草稿队列，不会自动发布。商品挂载接口仍待平台适配。</p>
    <button type="button" disabled={busy || !projectDir} onClick={() => void refresh()}>刷新账号与版本</button>
    {accounts.filter((account) => account.status === 'valid' && account.hasSession).map((account) => {
      const choice = choices[account.id] ?? emptyChoice();
      const versions = versionsFor(account);
      return <div key={account.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(180px, 2fr) minmax(150px, 2fr)', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <span>{PLATFORM_NAME[account.platform]} · {account.displayName}</span>
        <select aria-label={`${account.displayName} 的视频版本`} value={choice.version} onChange={(event) => setChoice(account.id, { version: event.target.value })}>
          <option value="">不加入本次草稿</option>
          {versions.map((version) => <option key={version.key} value={version.key}>{version.summary || version.key}</option>)}
        </select>
        <input aria-label={`${account.displayName} 的标题`} placeholder="该账号的标题" value={choice.title} onChange={(event) => setChoice(account.id, { title: event.target.value })} disabled={!choice.version} />
        {choice.version && <><span />
          <input aria-label={`${account.displayName} 的描述`} placeholder="描述" value={choice.description} onChange={(event) => setChoice(account.id, { description: event.target.value })} />
          <input aria-label={`${account.displayName} 的标签`} placeholder="标签，用逗号分隔" value={choice.tags} onChange={(event) => setChoice(account.id, { tags: event.target.value })} />
        </>}
      </div>;
    })}
    {!!projectDir && accounts.length === 0 && <p>暂无安全账号，请先到设置中添加账号。</p>}
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
      <button type="button" disabled={busy || !projectDir} onClick={() => void perform(false)}>预览配对</button>
      <button type="button" disabled={busy || !preview || preview.key !== JSON.stringify(assignments())} onClick={() => void perform(true)}>保存草稿</button>
    </div>
    {preview && <div role="status" style={{ marginTop: 8 }}>
      <p>将保存 {preview.value.entries.length} 个账号草稿；仅为本地草稿。</p>
      {preview.value.duplicateVersionRisks.map((risk) => <p key={`${risk.batchId}:${risk.planId}`}>
        重复版本提醒：同一视频版本分配给 {risk.accountIds.length} 个账号，平台可能识别为重复内容。
      </p>)}
    </div>}
    <div style={{ marginTop: 14 }}>
      <strong>当前工程草稿（{drafts.length}）</strong>
      {drafts.map((draft) => <div key={draft.taskId} style={{ display: 'flex', gap: 8,
        alignItems: 'center', marginTop: 6 }}>
        <span>{accounts.find((account) => account.id === draft.accountId)?.displayName ?? draft.accountId}
          {' · '}{draft.title}{' · '}{draft.batchId}/{draft.planId}</span>
        <button type="button" disabled={busy} onClick={() => void cancelDraft(draft.taskId)}>
          取消草稿
        </button>
      </div>)}
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}
