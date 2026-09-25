/** 旧 HyperFrames（HTML+GSAP）卡片的降级占位，提示用户重新生成为 Remotion 卡片。 */
export function LegacyCard({ title }: { title?: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        background: '#101827',
        color: '#f6f8fb',
        textAlign: 'center',
        padding: 40,
        gap: 12,
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 700 }}>{title || '旧版卡片'}</div>
      <div style={{ fontSize: 20, opacity: 0.7 }}>
        此卡片为旧 HyperFrames 格式，需重新生成为 Remotion 卡片
      </div>
    </div>
  );
}
