/** 添加到监听库：双 Tab（添加博主 / 粘贴视频链接），1:1 还原原型。 */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { DouyinClient } from '@/client';
import { S } from '@/ui/theme';
import { Hover } from '@/ui/kit';
import { InfoIcon } from '@/ui/icons';
import { errText } from './use-data';

type Tab = 'blogger' | 'link';

function secUidFromUrl(text: string): string | null {
  try {
    const u = new URL(text.trim());
    const seg = u.pathname.split('/');
    const i = seg.indexOf('user');
    if (i >= 0 && seg[i + 1]) return seg[i + 1];
  } catch {
    /* 非 URL */
  }
  return null;
}

export function AddModal({
  client,
  initialTab = 'blogger',
  onClose,
  onDone,
  show,
}: {
  client: DouyinClient;
  initialTab?: Tab;
  onClose: () => void;
  onDone: (sel?: string) => void;
  show: (t: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (tab === 'blogger') {
        const secUid = secUidFromUrl(handle) ?? handle.trim();
        const creator = await client.getCreatorBySecUid(secUid);
        if (!creator) {
          setErr('未采集到该博主资料。请先在抖音打开其主页（内容脚本会自动采集），再回来添加。');
          return;
        }
        await client.followCreator({ creator, intervalMinutes: 30, note: note.trim() || undefined });
        show(`已开始监听 ${note.trim() || creator.nickname}`);
        onDone();
      } else {
        const v = link.trim();
        const resolved = await client.resolveVideo({ shareUrl: v, pageUrl: v });
        show('链接已入库 · 正在解析');
        onDone(resolved.video.id);
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460, background: S.modal, border: '.5px solid rgba(255,255,255,.12)', borderRadius: 16, boxShadow: '0 30px 80px rgba(0,0,0,.6)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 0' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: S.white }}>添加到监听库</span>
          <div style={{ flex: 1 }} />
          <Hover
            base={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(255,255,255,.08)', color: '#a1a1a6', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            hover={{ background: 'rgba(255,255,255,.16)' }}
            onClick={onClose}
          >
            ✕
          </Hover>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: '14px 20px 0' }}>
          {(['blogger', 'link'] as const).map((t) => {
            const on = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{ fontSize: 13, fontWeight: 600, padding: '7px 4px', border: 'none', background: 'none', cursor: 'pointer', borderBottom: `2px solid ${on ? S.accent : 'transparent'}`, color: on ? S.white : S.mute, marginBottom: -1 }}
              >
                {t === 'blogger' ? '添加博主' : '粘贴视频链接'}
              </button>
            );
          })}
        </div>
        <div style={{ height: '.5px', background: 'rgba(255,255,255,.08)', marginTop: 12 }} />

        {tab === 'blogger' ? (
          <div style={{ padding: 20 }}>
            <div style={fieldLabel}>博主主页链接或抖音号</div>
            <input style={modalInput} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="https://www.douyin.com/user/... 或 @抖音号" />
            <div style={{ ...fieldLabel, margin: '16px 0 7px' }}>备注名称（可选）</div>
            <input style={modalInput} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：硬核财经分析" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, padding: '11px 13px', background: 'rgba(10,132,255,.08)', border: '.5px solid rgba(10,132,255,.18)', borderRadius: 9 }}>
              <InfoIcon />
              <span style={{ fontSize: 11.5, color: '#9fb8d8', lineHeight: 1.5 }}>
                请先在目标博主主页使用「加入灵机采风监听」；扩展会滚动采集全部公开可见作品并显示实时进度，之后每 30 分钟检查更新。
              </span>
            </div>
          </div>
        ) : (
          <div style={{ padding: 20 }}>
            <div style={fieldLabel}>抖音视频分享链接</div>
            <input style={modalInput} value={link} onChange={(e) => setLink(e.target.value)} placeholder="粘贴形如 https://v.douyin.com/xxxx/ 的链接" />
            <div style={{ fontSize: 11.5, color: S.faint, lineHeight: 1.6, marginTop: 13 }}>
              解析后会提取标题、封面、数据指标与字幕转录，并归入对应博主的视频库；若博主未在监听列表，将提示一并添加。
            </div>
          </div>
        )}

        {err && <div style={{ padding: '0 20px', fontSize: 12, color: S.orange, lineHeight: 1.5 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 10, padding: '14px 20px 20px' }}>
          <Hover base={{ ...modalBtn, flex: 1, background: 'rgba(255,255,255,.07)', color: S.cf, border: '.5px solid rgba(255,255,255,.09)' }} hover={{ background: 'rgba(255,255,255,.12)' }} onClick={onClose}>
            取消
          </Hover>
          <Hover base={{ ...modalBtn, flex: 1.4, background: S.accent, color: '#fff', border: 'none', opacity: busy ? 0.6 : 1 }} hover={{ filter: 'brightness(1.1)' }} onClick={busy ? () => {} : submit}>
            {busy ? '处理中…' : tab === 'blogger' ? '开始监听' : '解析并入库'}
          </Hover>
        </div>
      </div>
    </div>
  );
}

const fieldLabel: CSSProperties = { fontSize: 12, color: S.dim, marginBottom: 7 };
const modalInput: CSSProperties = {
  width: '100%',
  height: 38,
  background: S.inputBg,
  border: '.5px solid rgba(255,255,255,.12)',
  borderRadius: 9,
  color: S.white,
  fontSize: 13,
  padding: '0 12px',
  outline: 'none',
  boxSizing: 'border-box',
};
const modalBtn: CSSProperties = {
  height: 38,
  borderRadius: 9,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
