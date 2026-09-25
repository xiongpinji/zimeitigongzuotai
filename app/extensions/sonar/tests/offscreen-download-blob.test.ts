import { describe, expect, it, vi } from 'vitest';
import { fetchDownloadBlob } from '@/offscreen/download-blob';

describe('fetchDownloadBlob', () => {
  it('fetches the complete media body with a range request', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      new Blob(['video'], { type: 'video/mp4' }),
      { status: 206, headers: { 'content-type': 'video/mp4' } },
    ));

    const result = await fetchDownloadBlob('https://v.douyinvod.com/video', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://v.douyinvod.com/video',
      expect.objectContaining({ headers: { Range: 'bytes=0-' }, redirect: 'follow' }),
    );
    expect(result.type).toBe('video/mp4');
    expect(await result.text()).toBe('video');
  });

  it('rejects an HTML response instead of creating a download blob', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>denied</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));

    await expect(fetchDownloadBlob('https://v.douyinvod.com/video', fetchImpl))
      .rejects.toThrow('视频源返回的不是媒体文件');
  });
});
