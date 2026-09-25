import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';

export interface CardAssetMeta {
  cardId: string;
  mediaType: 'image' | 'video';
  prompt: string;
  negativePrompt?: string;
  providerId: string | null;
  model: string | null;
  aspectRatio: string;
  durationSeconds?: number;
  mediaDurationMs?: number;
  width?: number;
  height?: number;
  generatedAt: number;
  extras?: Record<string, unknown>;
}

function cardDir(projectDir: string, cardId: string): string {
  return path.join(projectDir, 'ai-cards', cardId);
}

export async function ensureCardAssetDir(projectDir: string, cardId: string): Promise<string> {
  const dir = cardDir(projectDir, cardId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeCardImage(
  projectDir: string,
  cardId: string,
  data: Buffer | Uint8Array,
): Promise<string> {
  await ensureCardAssetDir(projectDir, cardId);
  const abs = path.join(cardDir(projectDir, cardId), 'image.png');
  await writeFile(abs, data);
  return path.relative(projectDir, abs);
}

export async function writeCardVideo(
  projectDir: string,
  cardId: string,
  data: Buffer | Uint8Array,
): Promise<string> {
  await ensureCardAssetDir(projectDir, cardId);
  const abs = path.join(cardDir(projectDir, cardId), 'video.mp4');
  await writeFile(abs, data);
  return path.relative(projectDir, abs);
}

export async function writeCardPoster(
  projectDir: string,
  cardId: string,
  data: Buffer | Uint8Array,
): Promise<string> {
  await ensureCardAssetDir(projectDir, cardId);
  const abs = path.join(cardDir(projectDir, cardId), 'poster.jpg');
  await writeFile(abs, data);
  return path.relative(projectDir, abs);
}

export async function writeCardMeta(
  projectDir: string,
  cardId: string,
  meta: CardAssetMeta,
): Promise<void> {
  await ensureCardAssetDir(projectDir, cardId);
  const abs = path.join(cardDir(projectDir, cardId), 'meta.json');
  await writeFile(abs, JSON.stringify(meta, null, 2), 'utf8');
}

export async function readCardMeta(
  projectDir: string,
  cardId: string,
): Promise<CardAssetMeta | null> {
  try {
    const abs = path.join(cardDir(projectDir, cardId), 'meta.json');
    await access(abs);
    return JSON.parse(await readFile(abs, 'utf8')) as CardAssetMeta;
  } catch {
    return null;
  }
}

export async function deleteCardAssets(projectDir: string, cardId: string): Promise<void> {
  await rm(cardDir(projectDir, cardId), { recursive: true, force: true });
}
