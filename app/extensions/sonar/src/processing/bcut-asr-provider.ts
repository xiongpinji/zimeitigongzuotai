/**
 * Bcut（B 站必剪）ASR Provider —— 浏览器/Service Worker 版本（零配置转录）。
 *
 * 迁移自桌面端 electron/video-import/bcut-asr.ts，但去掉了 Node 依赖（fs/Buffer），
 * 直接消费扩展处理链路里的音频 Blob：
 *   create → 分片 PUT 上传（Blob.slice）→ complete → 创建任务 → 轮询结果。
 * 返回标准化的 TranscriptDocument（语言固定 zh，provider 标记为 'bcut'）。
 *
 * 注意（MV3 跨域）：
 * - bcut 接口与分片上传 URL 必须落在 manifest host_permissions 内。主接口域为
 *   member.bilibili.com；实测分片域包括 *.biliapi.net / *.hdslb.com。
 * - 接口可能返回 http 预签名分片 URL，上传前统一升级为 https，避免扩展页混合内容失败。
 * - 浏览器会忽略对 User-Agent 等 forbidden header 的设置，这里不再手动设置 UA。
 */
import type { TranscriptDocument, TranscriptSegment } from '@/domain/models';
import { SonarException, makeError } from '@/domain/errors';
import type { AsrProvider } from './asr-provider';
import { segmentsToSrt } from './transcript';

const API_BASE_URL = 'https://member.bilibili.com/x/bcut/rubick-interface';
const API_REQ_UPLOAD = `${API_BASE_URL}/resource/create`;
const API_COMMIT_UPLOAD = `${API_BASE_URL}/resource/create/complete`;
const API_CREATE_TASK = `${API_BASE_URL}/task`;
const API_QUERY_RESULT = `${API_BASE_URL}/task/result`;

const JSON_HEADERS = { 'Content-Type': 'application/json' };
/** bcut 模型 id：上传/任务用 8，结果查询用 7（沿用桌面端实现）。 */
const MODEL_ID_UPLOAD = '8';
const MODEL_ID_RESULT = '7';

export interface BcutAsrDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollLimit?: number;
  pollIntervalMs?: number;
  now?: () => number;
}

export interface BcutUtterance {
  transcript?: string;
  start_time?: number;
  end_time?: number;
}

interface BcutUploadInitResponse {
  data?: {
    in_boss_key?: string;
    resource_id?: string;
    upload_id?: string;
    upload_urls?: string[];
    per_size?: number;
  };
}

interface BcutCommitResponse {
  data?: { download_url?: string };
}

interface BcutTaskResponse {
  data?: { task_id?: string };
}

interface BcutQueryResponse {
  data?: { state?: number; result?: string };
}

/** 把 bcut 的 utterances 整形成标准化、按时间排序、去空的片段。纯逻辑，可单测。 */
export function bcutUtterancesToSegments(utterances: BcutUtterance[]): TranscriptSegment[] {
  return utterances
    .map((item) => ({
      text: String(item.transcript ?? '').trim(),
      startMs: Number(item.start_time ?? 0),
      endMs: Number(item.end_time ?? 0),
    }))
    .filter((item) => item.text.length > 0)
    .sort((a, b) => a.startMs - b.startMs);
}

async function requestJson<T>(fetchImpl: typeof fetch, input: string, init: RequestInit): Promise<T> {
  const response = await fetchImpl(input, init);
  if (!response.ok) {
    throw new Error(`Bcut 请求失败: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function uploadAudio(fetchImpl: typeof fetch, audio: Blob): Promise<string> {
  const isWav = /(?:audio\/wav|audio\/x-wav)/i.test(audio.type);
  const extension = isWav ? 'wav' : 'mp3';
  const init = await requestJson<BcutUploadInitResponse>(fetchImpl, API_REQ_UPLOAD, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      type: 2,
      name: `audio.${extension}`,
      size: audio.size,
      ResourceFileType: extension,
      model_id: MODEL_ID_UPLOAD,
    }),
  });

  const inBossKey = init.data?.in_boss_key;
  const resourceId = init.data?.resource_id;
  const uploadId = init.data?.upload_id;
  const uploadUrls = init.data?.upload_urls ?? [];
  const perSize = init.data?.per_size ?? 0;

  if (!inBossKey || !resourceId || !uploadId || uploadUrls.length === 0 || !perSize) {
    throw new Error('Bcut 上传初始化失败');
  }

  const etags: string[] = [];
  for (let index = 0; index < uploadUrls.length; index += 1) {
    const part = audio.slice(index * perSize, (index + 1) * perSize);
    // 分片走预签名 URL，不带自定义 header（让浏览器自行处理 content-type）。
    const uploadUrl = uploadUrls[index].replace(/^http:/i, 'https:');
    const partResponse = await fetchImpl(uploadUrl, { method: 'PUT', body: part });
    if (!partResponse.ok) {
      throw new Error(`Bcut 分片上传失败: ${partResponse.status}`);
    }
    const etag = partResponse.headers.get('Etag');
    if (etag) {
      etags.push(etag);
    }
  }

  const commit = await requestJson<BcutCommitResponse>(fetchImpl, API_COMMIT_UPLOAD, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      InBossKey: inBossKey,
      ResourceId: resourceId,
      Etags: etags.join(','),
      UploadId: uploadId,
      model_id: MODEL_ID_UPLOAD,
    }),
  });

  const downloadUrl = commit.data?.download_url;
  if (!downloadUrl) {
    throw new Error('Bcut 上传提交失败');
  }
  return downloadUrl;
}

async function createTask(fetchImpl: typeof fetch, downloadUrl: string): Promise<string> {
  const response = await requestJson<BcutTaskResponse>(fetchImpl, API_CREATE_TASK, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ resource: downloadUrl, model_id: MODEL_ID_UPLOAD }),
  });
  const taskId = response.data?.task_id;
  if (!taskId) {
    throw new Error('Bcut 任务创建失败');
  }
  return taskId;
}

async function queryTaskResult(
  fetchImpl: typeof fetch,
  taskId: string,
): Promise<BcutQueryResponse['data']> {
  const url = `${API_QUERY_RESULT}?model_id=${MODEL_ID_RESULT}&task_id=${encodeURIComponent(taskId)}`;
  const response = await requestJson<BcutQueryResponse>(fetchImpl, url, {
    method: 'GET',
    headers: JSON_HEADERS,
  });
  return response.data;
}

/**
 * 创建零配置的 bcut ASR Provider。错误归类：
 * - 轮询超时 → ASR_FAILED（可重试）
 * - 其它（网络/上传/接口失败）→ ASR_UPLOAD_FAILED（可重试）
 */
export function createBcutAsrProvider(deps: BcutAsrDeps = {}): AsrProvider {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());
  const pollLimit = deps.pollLimit ?? 500;
  const pollIntervalMs = deps.pollIntervalMs ?? 1000;

  return {
    async transcribe(audio, opts): Promise<TranscriptDocument> {
      try {
        const downloadUrl = await uploadAudio(fetchImpl, audio);
        const taskId = await createTask(fetchImpl, downloadUrl);

        for (let attempt = 0; attempt < pollLimit; attempt += 1) {
          const task = await queryTaskResult(fetchImpl, taskId);
          if (task?.state === 4) {
            const payload =
              typeof task.result === 'string'
                ? (JSON.parse(task.result) as { utterances?: BcutUtterance[] })
                : { utterances: [] };
            const segments = bcutUtterancesToSegments(payload.utterances ?? []);
            if (segments.length === 0) {
              throw new SonarException(
                makeError('ASR_FAILED', 'Bcut 未返回有效字幕', { retryable: true }),
              );
            }
            return {
              videoId: opts.videoId,
              provider: 'bcut',
              language: 'zh',
              fullText: segments.map((s) => s.text).join('\n'),
              srtText: segmentsToSrt(segments),
              segments,
              createdAt: now(),
            };
          }
          if (task?.state === 3) {
            throw new SonarException(
              makeError('ASR_FAILED', 'Bcut 转录任务失败', { retryable: true }),
            );
          }
          await sleep(pollIntervalMs);
        }

        throw new SonarException(
          makeError('ASR_FAILED', 'Bcut 转录未在超时时间内完成', { retryable: true }),
        );
      } catch (e) {
        if (e instanceof SonarException) throw e;
        throw new SonarException(
          makeError('ASR_UPLOAD_FAILED', 'Bcut 转录失败', {
            retryable: true,
            detail: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },
  };
}
