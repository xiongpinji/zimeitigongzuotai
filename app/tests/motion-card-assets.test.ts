import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectMotionCardAssets,
  extractMotionCardAssetReferences,
  externalizeMotionCardDataUris,
  materializePreviewMotionCardDataUris,
  rewriteMotionCardAssetReferences,
} from '../electron/remotion/motion-card-assets';

describe('motion card export assets', () => {
  it('extracts unique local CSS url references', () => {
    const refs = extractMotionCardAssetReferences(`
      const bg = "url('ai-cards/backgrounds/a.png')";
      const duplicate = 'url("ai-cards/backgrounds/a.png")';
      const remote = "url(https://example.com/b.png)";
      const inline = "url(data:image/png;base64,abc)";
    `);
    expect(refs).toEqual(['ai-cards/backgrounds/a.png']);
  });

  it('rewrites only local CSS urls to the Remotion public prefix', () => {
    expect(rewriteMotionCardAssetReferences(`url('ai-cards/backgrounds/a.png')`))
      .toBe(`url('/public/ai-cards/backgrounds/a.png')`);
    expect(rewriteMotionCardAssetReferences(`url("https://example.com/b.png")`))
      .toBe(`url("https://example.com/b.png")`);
    expect(rewriteMotionCardAssetReferences(`url(data:image/png;base64,abc)`))
      .toBe(`url(data:image/png;base64,abc)`);
  });

  it('extracts cardAsset() relative references alongside CSS urls', () => {
    const refs = extractMotionCardAssetReferences(`
      const a = cardAsset('assets/codex-visuals/x.png');
      const b = cardAsset("assets/codex-visuals/x.png");
      const css = "url('ai-cards/bg.png')";
      const remote = cardAsset('https://example.com/y.png');
      const abs = cardAsset('/Users/x/y.png');
    `);
    expect([...refs].sort()).toEqual(['ai-cards/bg.png', 'assets/codex-visuals/x.png']);
  });

  describe('externalizeMotionCardDataUris', () => {
    it('replaces large base64 image literals with cardAsset() refs and emits decoded bytes', () => {
      const base64 = Buffer.from('x'.repeat(20000)).toString('base64');
      const tsx = `const bg = 'data:image/png;base64,${base64}';\nexport default () => <Img src={bg} />;`;
      const emitted: { ext: string; len: number }[] = [];
      const out = externalizeMotionCardDataUris(tsx, {
        minBytes: 1024,
        write: (bytes, ext) => {
          emitted.push({ ext, len: bytes.length });
          return `card-assets/hash.${ext}`;
        },
      });
      expect(out).toContain("cardAsset('card-assets/hash.png')");
      expect(out).not.toContain('data:image/png;base64,');
      expect(emitted).toEqual([{ ext: 'png', len: 20000 }]);
    });

    it('preserves the original quote style and maps jpeg/svg extensions', () => {
      const jpeg = Buffer.from('j'.repeat(4000)).toString('base64');
      const tsx = `const a = "data:image/jpeg;base64,${jpeg}";`;
      const out = externalizeMotionCardDataUris(tsx, {
        minBytes: 1024,
        write: (_bytes, ext) => `card-assets/h.${ext}`,
      });
      expect(out).toBe(`const a = cardAsset("card-assets/h.jpg");`);
    });

    it('keeps small data URIs inline (below threshold)', () => {
      const tsx = `const i = 'data:image/svg+xml;base64,YWJj';`;
      const out = externalizeMotionCardDataUris(tsx, { minBytes: 1024, write: () => 'x' });
      expect(out).toBe(tsx);
    });

    it('does not touch data URIs inside CSS url()', () => {
      const base64 = Buffer.from('y'.repeat(20000)).toString('base64');
      const tsx = `const s = "url(data:image/png;base64,${base64})";`;
      const out = externalizeMotionCardDataUris(tsx, {
        minBytes: 1024,
        write: () => 'card-assets/h.png',
      });
      expect(out).toBe(tsx);
    });
  });

  it('materializes large preview data URIs into hidden project cache files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lingji-preview-card-assets-'));
    try {
      const base64 = Buffer.from('z'.repeat(20000)).toString('base64');
      const tsx = `const bg = 'data:image/png;base64,${base64}';\nexport default () => <Img src={bg} />;`;
      const out = await materializePreviewMotionCardDataUris(tsx, {
        projectDir: dir,
        overlayId: 'card-1',
        minBytes: 1024,
      });
      const match = out.match(/cardAsset\('([^']+)'\)/);
      expect(match?.[1]).toMatch(
        /^\.lingji\/preview-card-assets\/card-1\/[0-9a-f]{16}\.png$/,
      );
      const written = await readFile(path.join(dir, match![1]), 'utf8').catch(() => null);
      expect(written).not.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('collects existing assets referenced by external motion cards', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lingji-card-assets-'));
    try {
      const cardDir = path.join(dir, 'ai-cards', 'card-1');
      const backgroundDir = path.join(dir, 'ai-cards', 'backgrounds');
      await mkdir(cardDir, { recursive: true });
      await mkdir(backgroundDir, { recursive: true });
      await writeFile(path.join(backgroundDir, 'hero.png'), 'image');
      await writeFile(
        path.join(cardDir, 'motionCard.tsx'),
        `export default () => <div style={{background:"url('ai-cards/backgrounds/hero.png')"}} />`,
      );

      const timeline = {
        overlays: [{
          id: 'card-1',
          aiCardData: {
            motionCard: { tsxPath: 'ai-cards/card-1/motionCard.tsx' },
          },
        }],
      } as never;

      await expect(collectMotionCardAssets(timeline, dir)).resolves.toEqual([{
        sourcePath: path.join(backgroundDir, 'hero.png'),
        publicPath: 'ai-cards/backgrounds/hero.png',
      }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
