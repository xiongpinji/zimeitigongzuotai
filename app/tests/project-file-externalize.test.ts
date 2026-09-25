import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadProjectFile, saveProjectSection } from '../electron/project-file';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lingji-ext-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const timelineWithCard = {
  overlays: [
    { id: 'ovA', type: 'image', startMs: 0, durationMs: 1000,
      aiCardData: { renderMode: 'motion-card', motionCard: { tsx: 'export default ()=>null', compiledAt: 1, prompt: 'p', retryCount: 0 } } },
  ],
};

describe('project-file 外置 roundtrip', () => {
  it('保存 timeline 时把 tsx 写到独立文件、project.json 只留 tsxPath', async () => {
    await saveProjectSection(dir, 'timeline', JSON.stringify(timelineWithCard));
    const tsxFile = await fs.readFile(path.join(dir, 'ai-cards/ovA/motionCard.tsx'), 'utf-8');
    expect(tsxFile).toBe('export default ()=>null');
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf-8'));
    const card = raw.timeline.overlays[0].aiCardData.motionCard;
    expect(card.tsx).toBeUndefined();
    expect(card.tsxPath).toBe('ai-cards/ovA/motionCard.tsx');
  });

  it('加载时据 tsxPath 读回 tsx', async () => {
    await saveProjectSection(dir, 'timeline', JSON.stringify(timelineWithCard));
    const loaded = await loadProjectFile(dir);
    const card = (loaded.timeline as never as { overlays: { aiCardData: { motionCard: { tsx?: string } } }[] }).overlays[0].aiCardData.motionCard;
    expect(card.tsx).toBe('export default ()=>null');
  });

  it('迁移：内嵌 tsx 的旧 project.json 加载后外置（再次落盘后文件出现）', async () => {
    const legacy = { version: 1, createdAt: 'x', updatedAt: 'x', timeline: timelineWithCard,
      aiAnalysis: { analysisResult: null, coverCandidates: [] },
      script: { templateId: 'news-broadcast', annotations: [], reviewState: 'idle', lastReviewedDocVersion: 0 } };
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(legacy), 'utf-8');
    const loaded = await loadProjectFile(dir);
    const card = (loaded.timeline as never as { overlays: { aiCardData: { motionCard: { tsx?: string; tsxPath?: string } } }[] }).overlays[0].aiCardData.motionCard;
    expect(card.tsx).toBe('export default ()=>null');
    expect(card.tsxPath).toBe('ai-cards/ovA/motionCard.tsx');
  });
});
