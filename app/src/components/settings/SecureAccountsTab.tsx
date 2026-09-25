/**
 * A2-S3：安全账号独立设置页（account-v2）。
 *
 * 边界声明：
 * - 本页只调用 `window.accountV2API`（新安全桥）；绝不调用旧 `window.publishAPI`，
 *   也绝不把新 UUID 传给旧发布链。新账号尚未接入发布工作台。
 * - 创建与登录分两步：create 成功立即出现独立 UUID 行；login 失败保留 unknown
 *   账号供续登或删除。
 * - 每次登录由本组件在 invoke 前生成 `requestId` 并先订阅二维码事件：只接收
 *   accountId + requestId 双匹配且 sequence 递增的事件；Promise 落定 / 卸载都
 *   真实退订并清除 data URL。二维码只存在于组件内存，绝不写 store / 持久化。
 * - 显示名可能来自主进程既有数据，只经 React 转义文本渲染；方向控制符净化后
 *   展示，并始终附带 UUID 身份，不改变后端账号身份。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogIn, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  ConfirmDialog,
  Divider,
  Field,
  Input,
  Select,
  SettingsPageHeader,
  Switch,
} from '../../ui';
import type { SelectOption } from '../../ui';
import { Spinner } from '../../ui/primitives/Spinner';
import { ACCOUNT_V2_ERROR_TEXT, useAccountsV2Store } from '../../store/accounts-v2';
import type { AccountV2Dto, AccountV2Platform } from '../../lib/electron-api';
import styles from './SecureAccountsTab.module.css';

const PLATFORM_OPTIONS: SelectOption[] = [
  { value: 'douyin', label: '抖音' },
  { value: 'kuaishou', label: '快手' },
  { value: 'tencent', label: '视频号' },
  { value: 'xiaohongshu', label: '小红书' },
];

/** 四平台固定展示名（与 A1 vault 白名单一致，不含 B 站）。 */
const PLATFORM_LABEL: Record<AccountV2Platform, string> = {
  douyin: '抖音',
  kuaishou: '快手',
  tencent: '视频号',
  xiaohongshu: '小红书',
};

/** C0/C1 控制符 + BiDi 方向控制/隔离符：显示时替换为 U+FFFD，避免视觉混淆。 */
const UNSAFE_DISPLAY_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g;

function safeDisplayText(value: string): string {
  return value.replace(UNSAFE_DISPLAY_RE, '\uFFFD');
}

function statusVariant(status: AccountV2Dto['status']): 'success' | 'warning' | 'secondary' {
  switch (status) {
    case 'valid':
      return 'success';
    case 'expired':
      return 'warning';
    default:
      return 'secondary';
  }
}

function statusLabel(status: AccountV2Dto['status']): string {
  switch (status) {
    case 'valid':
      return '有效';
    case 'expired':
      return '已过期';
    default:
      return '未知';
  }
}

function formatLastChecked(ts: number | null): string {
  if (!ts) return '从未检查';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** requestId 仅用于本次登录的事件关联；优先 Web Crypto，缺失时回退到 UUID v4 形状。 */
function generateRequestId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

type PendingKind = 'login' | 'check' | 'delete';

interface RowFeedback {
  text: string;
  tone: 'info' | 'error' | 'success';
}

function feedbackClass(tone: RowFeedback['tone']): string {
  if (tone === 'error') return styles.feedbackError;
  if (tone === 'success') return styles.feedbackSuccess;
  return '';
}

interface SecureAccountsTabProps {
  onRegisterLeaveGuard?: (guard: (() => Promise<boolean>) | null) => void;
}

export function SecureAccountsTab({ onRegisterLeaveGuard }: SecureAccountsTabProps = {}) {
  const accounts = useAccountsV2Store((state) => state.accounts);
  const loading = useAccountsV2Store((state) => state.loading);
  const loadAccounts = useAccountsV2Store((state) => state.load);
  const createAccount = useAccountsV2Store((state) => state.create);
  const loginAccount = useAccountsV2Store((state) => state.login);
  const checkAccount = useAccountsV2Store((state) => state.check);
  const removeAccount = useAccountsV2Store((state) => state.remove);

  const [platform, setPlatform] = useState<AccountV2Platform>('douyin');
  const [displayName, setDisplayName] = useState('');
  const [owner, setOwner] = useState('');
  const [creating, setCreating] = useState(false);
  const [headedLogin, setHeadedLogin] = useState(false);
  const [pending, setPending] = useState<Partial<Record<string, PendingKind>>>({});
  const [feedback, setFeedback] = useState<Partial<Record<string, RowFeedback>>>({});
  const [createFeedback, setCreateFeedback] = useState<RowFeedback | null>(null);
  const [qrcode, setQrcode] = useState<{ accountId: string; dataUrl: string } | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const qrcodeUnsubRef = useRef<(() => void) | null>(null);
  const activeLoginRef = useRef<{ accountId: string; requestId: string } | null>(null);
  const lastQrSequenceRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void loadAccounts();
    return () => {
      mountedRef.current = false;
      // 卸载时真实退订并清除二维码引用（data URL 只在组件内存）。
      qrcodeUnsubRef.current?.();
      qrcodeUnsubRef.current = null;
      activeLoginRef.current = null;
      lastQrSequenceRef.current = 0;
    };
  }, [loadAccounts]);

  const setRowFeedback = useCallback((accountId: string, entry: RowFeedback) => {
    setFeedback((prev) => ({ ...prev, [accountId]: entry }));
  }, []);

  useEffect(() => {
    if (!onRegisterLeaveGuard) return;
    onRegisterLeaveGuard(async () => {
      const active = activeLoginRef.current;
      if (!active) return true;
      setRowFeedback(active.accountId, {
        text: '当前账号正在登录，请完成扫码或等待结果后再离开。',
        tone: 'info',
      });
      return false;
    });
    return () => onRegisterLeaveGuard(null);
  }, [onRegisterLeaveGuard, setRowFeedback]);

  const clearPending = useCallback((accountId: string) => {
    setPending((prev) => {
      const next = { ...prev };
      delete next[accountId];
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    const name = displayName.trim();
    if (!name) {
      setCreateFeedback({ text: '请输入账号名称。', tone: 'error' });
      return;
    }
    const trimmedOwner = owner.trim();
    setCreating(true);
    setCreateFeedback(null);
    const result = await createAccount(
      platform,
      name,
      trimmedOwner.length > 0 ? trimmedOwner : undefined,
    );
    if (!mountedRef.current) return;
    setCreating(false);
    if (result.ok) {
      setCreateFeedback({
        text: `已创建账号（ID ${result.account.id}）。请点击该行「登录」扫码完成首次登录。`,
        tone: 'success',
      });
      setDisplayName('');
      setOwner('');
    } else {
      setCreateFeedback({ text: result.message, tone: 'error' });
    }
  }, [createAccount, displayName, owner, platform]);

  const handleLogin = useCallback(
    async (account: AccountV2Dto) => {
      // React 状态在下一次渲染才生效；ref 同步阻止同一批次的重复点击。
      if (activeLoginRef.current) return;
      const api = typeof window === 'undefined' ? null : window.accountV2API;
      if (!api) {
        setRowFeedback(account.id, { text: ACCOUNT_V2_ERROR_TEXT.internal_error, tone: 'error' });
        return;
      }
      if (qrcodeUnsubRef.current) {
        qrcodeUnsubRef.current();
        qrcodeUnsubRef.current = null;
      }
      const requestId = generateRequestId();
      activeLoginRef.current = { accountId: account.id, requestId };
      lastQrSequenceRef.current = 0;
      setQrcode(null);
      setRowFeedback(account.id, { text: '正在等待扫码，二维码仅用于本次登录。', tone: 'info' });
      // 必须先订阅再 invoke：Promise 落定前到达的二维码事件才能按 requestId 关联。
      qrcodeUnsubRef.current = api.onQrcode((event) => {
        const active = activeLoginRef.current;
        if (!active) return;
        if (event.accountId !== active.accountId || event.requestId !== active.requestId) return;
        if (!Number.isInteger(event.sequence) || event.sequence <= lastQrSequenceRef.current) return;
        lastQrSequenceRef.current = event.sequence;
        if (!mountedRef.current) return;
        // 二维码 data URL 只进组件内存，绝不写 store / localStorage。
        setQrcode({ accountId: active.accountId, dataUrl: event.imageDataUrl });
      });
      setPending((prev) => ({ ...prev, [account.id]: 'login' }));
      try {
        const result = await loginAccount(account.id, requestId, !headedLogin);
        if (!mountedRef.current) return;
        setRowFeedback(account.id, result.ok
          ? { text: '登录成功，会话已加密保存。', tone: 'success' }
          : { text: result.message, tone: 'error' });
      } finally {
        // Promise 落定即真实退订并清除二维码展示。
        const unsubscribe = qrcodeUnsubRef.current;
        qrcodeUnsubRef.current = null;
        activeLoginRef.current = null;
        lastQrSequenceRef.current = 0;
        unsubscribe?.();
        if (mountedRef.current) {
          setQrcode(null);
          clearPending(account.id);
        }
      }
    },
    [clearPending, headedLogin, loginAccount, setRowFeedback],
  );

  const handleCheck = useCallback(
    async (account: AccountV2Dto) => {
      setPending((prev) => ({ ...prev, [account.id]: 'check' }));
      const result = await checkAccount(account.id);
      if (!mountedRef.current) return;
      clearPending(account.id);
      if (result.ok) {
        setRowFeedback(account.id, {
          text: result.valid ? '会话检查通过，登录仍然有效。' : '会话检查未通过，状态已标记为过期。',
          tone: result.valid ? 'success' : 'error',
        });
      } else {
        setRowFeedback(account.id, { text: result.message, tone: 'error' });
      }
    },
    [checkAccount, clearPending, setRowFeedback],
  );

  const handleConfirmDelete = useCallback(async () => {
    const accountId = deleteTargetId;
    if (!accountId) return;
    setDeleteTargetId(null);
    setPending((prev) => ({ ...prev, [accountId]: 'delete' }));
    const result = await removeAccount(accountId);
    if (!mountedRef.current) return;
    clearPending(accountId);
    if (!result.ok) {
      setRowFeedback(accountId, { text: result.message, tone: 'error' });
      return;
    }
    setFeedback((prev) => {
      const next = { ...prev };
      delete next[accountId];
      return next;
    });
    setQrcode((prev) => (prev && prev.accountId === accountId ? null : prev));
  }, [clearPending, deleteTargetId, removeAccount, setRowFeedback]);

  const loginAccountId = useMemo(
    () => accounts.find((account) => pending[account.id] === 'login')?.id ?? null,
    [accounts, pending],
  );

  const deleteTarget = deleteTargetId
    ? accounts.find((account) => account.id === deleteTargetId) ?? null
    : null;

  return (
    <div className={styles.container}>
      <SettingsPageHeader
        title="安全账号"
        description="独立加密存储的四平台新账号体系；UUID 是唯一身份，支持同平台同名多账号"
        leading={<ShieldCheck size={24} className={styles.platformIcon} />}
      />

      <div className={styles.boundaryNotice} role="note">
        本页管理新的安全账号（独立加密存储）；新安全账号暂未接入发布，旧发布工作台仍使用旧账号体系。
      </div>

      {accounts.length === 0 ? (
        <p className={styles.emptyState}>
          {loading ? '正在载入安全账号…' : '暂无安全账号，请先创建。'}
        </p>
      ) : (
        <div className={styles.accountList}>
          {accounts.map((account) => {
            const rowPending = pending[account.id];
            const rowFeedback = feedback[account.id];
            const loginBlocked = rowPending !== undefined || loginAccountId !== null;
            const qrcodeForRow =
              qrcode && qrcode.accountId === account.id ? qrcode.dataUrl : null;
            return (
              <div key={account.id} className={styles.accountRow} data-account-id={account.id}>
                <div className={styles.accountInfo}>
                  <span className={styles.accountName}>
                    {PLATFORM_LABEL[account.platform]} · {safeDisplayText(account.displayName)}
                  </span>
                  <span className={styles.accountId}>ID：{account.id}</span>
                  <span className={styles.accountMeta}>
                    归属：{account.owner ? safeDisplayText(account.owner) : '未填写'} · 会话：
                    {account.hasSession ? '已保存' : '未保存'} · 上次检查：
                    {formatLastChecked(account.lastCheckedAt)}
                  </span>
                </div>
                <Badge variant={statusVariant(account.status)}>{statusLabel(account.status)}</Badge>
                <div className={styles.accountActions}>
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    aria-label="扫码登录或续登"
                    onClick={() => void handleLogin(account)}
                    disabled={loginBlocked}
                    leftIcon={
                      rowPending === 'login' ? (
                        <Spinner size={12} className={styles.spinning} />
                      ) : (
                        <LogIn size={12} />
                      )
                    }
                  >
                    {account.hasSession ? '续登' : '登录'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-label="检查会话"
                    onClick={() => void handleCheck(account)}
                    disabled={loginBlocked}
                    leftIcon={
                      rowPending === 'check' ? (
                        <Spinner size={12} className={styles.spinning} />
                      ) : (
                        <RefreshCw size={12} />
                      )
                    }
                  >
                    检查
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    aria-label="删除账号"
                    onClick={() => setDeleteTargetId(account.id)}
                    disabled={loginBlocked}
                    leftIcon={<Trash2 size={12} />}
                  >
                    删除
                  </Button>
                </div>
                {qrcodeForRow ? (
                  <div className={styles.qrcodeWrap}>
                    <span className={styles.qrcodeLabel}>
                      请使用对应平台 App 扫描二维码（仅本次登录有效）：
                    </span>
                    <img src={qrcodeForRow} alt="登录二维码" className={styles.qrcodeImg} />
                  </div>
                ) : null}
                {rowFeedback ? (
                  <p className={`${styles.feedback} ${feedbackClass(rowFeedback.tone)}`}>
                    {rowFeedback.text}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <Divider label="创建账号（第一步）" />
      <div className={styles.addSection}>
        <div className={styles.addRow}>
          <div className={styles.addSelectWrap}>
            <Field label="平台">
              <Select
                options={PLATFORM_OPTIONS}
                value={platform}
                onChange={(event) => setPlatform(event.target.value as AccountV2Platform)}
                disabled={creating}
              />
            </Field>
          </div>
          <div className={styles.addInputWrap}>
            <Field label="账号名称（备注，可同名）">
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例如：主账号"
                aria-label="新账号名称"
                disabled={creating}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreate();
                }}
              />
            </Field>
          </div>
          <div className={styles.addInputWrap}>
            <Field label="归属人（可选）">
              <Input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="例如：运营 A"
                aria-label="归属人（可选）"
                disabled={creating}
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleCreate()}
            disabled={creating}
            leftIcon={
              creating ? <Spinner size={13} className={styles.spinning} /> : <Plus size={13} />
            }
          >
            {creating ? '创建中…' : '创建账号'}
          </Button>
        </div>
        <p className={styles.hint}>
          创建与登录分两步：创建成功立即生成独立 UUID 账号；再点击该行「登录」扫码完成首登或续登。
        </p>
        {createFeedback ? (
          <p className={`${styles.feedback} ${feedbackClass(createFeedback.tone)}`}>
            {createFeedback.text}
          </p>
        ) : null}
      </div>

      <Divider label="登录方式" />
      <div className={styles.loginModeRow}>
        <Switch
          checked={headedLogin}
          onChange={setHeadedLogin}
          label="登录使用有头浏览器"
        />
        <span className={styles.loginModeHint}>
          默认无头模式，二维码显示在本页；无头登录失败时可打开此项改用浏览器窗口扫码。
        </span>
      </div>

      <ConfirmDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null);
        }}
        title="确认删除安全账号？"
        description={
          deleteTarget
            ? `将删除「${PLATFORM_LABEL[deleteTarget.platform]} · ${safeDisplayText(deleteTarget.displayName)}」（ID ${deleteTarget.id}）的本地加密会话，无法恢复。`
            : '确认删除此账号？'
        }
        confirmText="确认删除"
        confirmVariant="destructive"
        onConfirm={() => handleConfirmDelete()}
      />
    </div>
  );
}
