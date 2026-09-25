import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  SaveCoverEditArgs,
  SaveCoverEditResult,
} from '../src/lib/cover-editor/contracts';

const DATA_URL_RE = /^data:image\/(png|jpeg);base64,(.+)$/;

function parseDataUrl(dataUrl: string): Buffer {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new Error('saveCoverEdit: 无法解析 dataUrl');
  }
  return Buffer.from(match[2], 'base64');
}

export async function saveCoverEdit(args: SaveCoverEditArgs): Promise<SaveCoverEditResult> {
  const buffer = parseDataUrl(args.dataUrl);
  const coversDir = path.join(args.projectDir, 'covers');
  await fs.mkdir(coversDir, { recursive: true });

  if (args.mode === 'append') {
    const id = randomUUID();
    const outPath = path.join(coversDir, `edited-${id}.png`);
    await fs.writeFile(outPath, buffer);
    return {
      candidateId: id,
      imageUrl: outPath,
      editedFrom: args.sourceCandidateId,
      createdAt: Date.now(),
    };
  }

  // overwrite：写入来源文件，id 保持不变
  await fs.writeFile(args.sourceImageUrl, buffer);
  return {
    candidateId: args.sourceCandidateId,
    imageUrl: args.sourceImageUrl,
    replacedId: args.sourceCandidateId,
    createdAt: Date.now(),
  };
}
