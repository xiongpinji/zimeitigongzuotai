/**
 * 卡片图片资源解析器。注入到 Motion Card 运行时（CardHost）的全局 `cardAsset`，
 * 让同一份卡片 TSX 在预览与导出两种环境下都能正确加载项目内图片：
 * - 导出（renderMedia，isRendering=true）：相对路径 → staticFile（已 materialize 到 bundle public）。
 * - 预览（@remotion/player）：相对路径 → file://<projectDir>/<rel>（webSecurity 关闭可读本地文件）。
 *
 * 卡片里统一写 `cardAsset('assets/xxx.png')`（项目相对路径），不写绝对路径、不内联巨型 base64。
 */
export function makeCardAssetResolver(opts: {
  isRendering: boolean;
  projectDir?: string | null;
  staticFile: (rel: string) => string;
  toFileSrc: (abs: string) => string;
}): (rel: string) => string {
  return (rel: string): string => {
    if (!rel) return rel;
    if (/^(?:https?:|file:|data:)/i.test(rel)) return rel;
    const normalized = rel.replace(/\\/g, '/').replace(/^\.?\//, '');
    if (!opts.isRendering && opts.projectDir) {
      const root = opts.projectDir.replace(/[\\/]+$/, '');
      return opts.toFileSrc(`${root}/${normalized}`);
    }
    return opts.staticFile(normalized);
  };
}
