import { useMemo } from 'react';
import gsapScript from 'gsap/dist/gsap.min.js?raw';

interface StylePresetPreviewProps {
  motionHtml?: string;
  className?: string;
}

const BOOTSTRAP = `
<script>
  window.__lingjiMotionTimelines = window.__lingjiMotionTimelines || [];
  window.addEventListener('load', function () {
    try {
      var master = gsap.timeline({ repeat: -1, repeatDelay: 0.8 });
      (window.__lingjiMotionTimelines || []).forEach(function (tl) {
        tl.progress(0).play();
        master.add(tl, 0);
      });
      master.play();
    } catch (e) {}
  });
</script>`;

export function StylePresetPreview({ motionHtml, className }: StylePresetPreviewProps) {
  const srcDoc = useMemo(() => {
    if (!motionHtml) return '';
    return [
      '<!doctype html><html><head><meta charset="utf-8" />',
      '<style>html,body{margin:0;height:100%;background:#0E0E10;overflow:hidden}',
      '#root{width:100%;height:100%}</style>',
      `<script>${gsapScript}</script>`,
      '</head><body><div id="root">',
      motionHtml,
      '</div>',
      BOOTSTRAP,
      '</body></html>',
    ].join('\n');
  }, [motionHtml]);

  if (!motionHtml) {
    return <div className={className} aria-label="无 Motion 预览" />;
  }
  return (
    <iframe
      className={className}
      title="风格预览"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
    />
  );
}
