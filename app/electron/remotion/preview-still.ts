import { randomUUID } from 'node:crypto';
import type { SrtEntry, TimelineData } from '../../src/types';

export interface ExactPreviewInput {
  timeline: TimelineData;
  srtEntries: SrtEntry[];
  projectDir: string;
}

export interface ExactPreviewResource {
  durationInFrames: number;
  fps: number;
  render: (frame: number) => Promise<Uint8Array>;
  dispose: () => Promise<void>;
}

interface Session {
  id: string;
  owner: number;
  resource: ExactPreviewResource;
  sequence: number;
  closed: boolean;
  tail: Promise<void>;
  cached: Map<number, Uint8Array>;
}

/** 主进程会话属主与最新帧门槛；资源工厂在测试中可注入合成渲染器。 */
export function createExactPreviewController(factory: (input: ExactPreviewInput) => Promise<ExactPreviewResource>) {
  const sessions = new Map<string, Session>();
  const byOwner = new Map<number, string>();
  const generations = new Map<number, number>();

  const nextGeneration = (owner: number) => {
    const next = (generations.get(owner) ?? 0) + 1;
    generations.set(owner, next);
    return next;
  };

  const release = async (owner: number, sessionId: string): Promise<void> => {
    const session = sessions.get(sessionId);
    if (!session) return;
    if (session.owner !== owner) throw new Error('preview_session_owner_mismatch');
    session.closed = true;
    session.sequence += 1;
    sessions.delete(sessionId);
    if (byOwner.get(owner) === sessionId) byOwner.delete(owner);
    await session.tail;
    await session.resource.dispose();
  };

  return {
    async prepare(owner: number, input: ExactPreviewInput) {
      if (!Number.isSafeInteger(owner) || owner < 0 || !input?.timeline || !Array.isArray(input.srtEntries) ||
          typeof input.projectDir !== 'string' || !input.projectDir.trim()) {
        throw new Error('preview_invalid_input');
      }
      const generation = nextGeneration(owner);
      const prior = byOwner.get(owner);
      if (prior) await release(owner, prior);
      const resource = await factory(input);
      if (generations.get(owner) !== generation) {
        await resource.dispose();
        throw new Error('preview_superseded');
      }
      if (!Number.isSafeInteger(resource.durationInFrames) || resource.durationInFrames < 1 ||
          !Number.isFinite(resource.fps) || resource.fps <= 0) {
        await resource.dispose();
        throw new Error('preview_invalid_composition');
      }
      const sessionId = randomUUID();
      sessions.set(sessionId, {
        id: sessionId, owner, resource, sequence: 0, closed: false,
        tail: Promise.resolve(), cached: new Map(),
      });
      byOwner.set(owner, sessionId);
      return { sessionId, durationInFrames: resource.durationInFrames, fps: resource.fps };
    },

    async render(owner: number, sessionId: string, frame: number) {
      const session = sessions.get(sessionId);
      if (!session || session.closed || session.owner !== owner) throw new Error('preview_invalid_session');
      if (!Number.isSafeInteger(frame) || frame < 0 || frame >= session.resource.durationInFrames) {
        throw new Error('preview_invalid_frame');
      }
      const sequence = ++session.sequence;
      const cached = session.cached.get(frame);
      if (cached) return { sessionId, frame, png: cached.slice() };
      const pending = session.tail.then(async () => {
        if (session.closed || sequence !== session.sequence) throw new Error('preview_superseded');
        const png = await session.resource.render(frame);
        if (session.closed || sequence !== session.sequence) throw new Error('preview_superseded');
        if (!(png instanceof Uint8Array) || png.byteLength === 0) throw new Error('preview_render_failed');
        session.cached.set(frame, png.slice());
        if (session.cached.size > 4) session.cached.delete(session.cached.keys().next().value!);
        return { sessionId, frame, png: png.slice() };
      });
      session.tail = pending.then(() => undefined, () => undefined);
      return pending;
    },

    release,

    async releaseOwner(owner: number): Promise<void> {
      nextGeneration(owner);
      const current = byOwner.get(owner);
      if (current) await release(owner, current);
    },
  };
}

/** 使用导出同一 composition/素材准备链生成暂停帧；只在 Electron 主进程调用。 */
export async function createRemotionExactPreviewResource(input: ExactPreviewInput): Promise<ExactPreviewResource> {
  const [{ app }, fs, path, { bundle }, renderer, assets, cards, { collectMotionCards }] = await Promise.all([
    import('electron'), import('node:fs/promises'), import('node:path'), import('@remotion/bundler'),
    import('@remotion/renderer'), import('./render-video-headless'), import('./compile-card-node'),
    import('../../src/remotion/collect-cards'),
  ]);
  if (!path.isAbsolute(input.projectDir) ||
      !(await fs.stat(input.projectDir).then((entry) => entry.isDirectory(), () => false))) {
    throw new Error('preview_invalid_project');
  }
  const { timeline: renderTimeline, publicDir } = await assets.createRenderPublicDir(input.timeline, input.projectDir);
  let serveDir: string | null = null;
  const browserRef: { current: Awaited<ReturnType<typeof renderer.openBrowser>> | null } = { current: null };
  try {
    const prepared = await assets.hydrateAndExternalizeRenderCards(renderTimeline, publicDir, input.projectDir);
    const cardSources = collectMotionCards(prepared.timeline);
    const compiledCards = await cards.compileCards(cardSources);
    if (Object.keys(compiledCards).length !== cardSources.length) throw new Error('preview_card_compile_failed');
    const inputProps = { timeline: prepared.timeline, srtEntries: input.srtEntries, compiledCards };
    let serveUrl: string;
    if (app.isPackaged) {
      serveDir = await assets.prepareServeUrlFromPrebuilt(publicDir);
      serveUrl = serveDir;
    } else {
      serveUrl = await bundle({
        entryPoint: path.join(app.getAppPath(), 'src', 'remotion', 'index.ts'),
        publicDir,
        webpackOverride: (config) => config,
      });
    }
    const composition = await assets.withPackagedRemotionCwd(async () => {
      browserRef.current = await renderer.openBrowser('chrome', { chromiumOptions: { gl: 'angle' }, logLevel: 'error' });
      return renderer.selectComposition({
        serveUrl, id: 'lingji-composition', inputProps, puppeteerInstance: browserRef.current,
        binariesDirectory: assets.resolveRemotionBinariesDirectory() ?? null,
        chromiumOptions: { gl: 'angle' }, logLevel: 'error',
      });
    });
    const ownedBrowser = browserRef.current!;
    return {
      durationInFrames: composition.durationInFrames,
      fps: composition.fps,
      async render(frame) {
        const result = await assets.withPackagedRemotionCwd(() => renderer.renderStill({
          composition, serveUrl, frame, inputProps, puppeteerInstance: ownedBrowser,
          imageFormat: 'png', output: null, chromiumOptions: { gl: 'angle' }, logLevel: 'error',
        }));
        if (!result.buffer) throw new Error('preview_render_failed');
        return new Uint8Array(result.buffer);
      },
      async dispose() {
        try {
          await ownedBrowser.close({ silent: true });
        } finally {
          await fs.rm(publicDir, { recursive: true, force: true });
          if (serveDir) await fs.rm(serveDir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    if (browserRef.current) await browserRef.current.close({ silent: true }).catch(() => undefined);
    await fs.rm(publicDir, { recursive: true, force: true });
    if (serveDir) await fs.rm(serveDir, { recursive: true, force: true });
    throw error;
  }
}
