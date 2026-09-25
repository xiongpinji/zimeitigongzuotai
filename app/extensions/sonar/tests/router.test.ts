import { describe, it, expect } from 'vitest';
import { createRouter } from '@/background/router';
import { createRequest, PROTOCOL_VERSION } from '@/protocol/messages';
import { SonarException, makeError } from '@/domain/errors';

describe('createRouter dispatch', () => {
  it('routes a request to the matching handler and wraps the result', async () => {
    const router = createRouter({
      getCreator: async (params) => ({ echoed: params }),
    });
    const res = await router.dispatch(
      createRequest('getCreator', { creatorId: 'c1' }, { requestId: 'r1' }),
    );
    expect(res.requestId).toBe('r1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result).toEqual({ echoed: { creatorId: 'c1' } });
  });

  it('passes params through to the handler', async () => {
    let received: unknown;
    const router = createRouter({
      downloadVideo: async (params) => {
        received = params;
        return null;
      },
    });
    await router.dispatch(createRequest('downloadVideo', { videoId: 'v9' }, { requestId: 'r2' }));
    expect(received).toEqual({ videoId: 'v9' });
  });

  it('fails explicitly on an unknown method', async () => {
    const router = createRouter({});
    const res = await router.dispatch({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r3',
      method: 'nope',
      params: {},
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('PARSE_ERROR');
  });

  it('fails explicitly on an unknown protocol version', async () => {
    const router = createRouter({});
    const res = await router.dispatch({
      protocolVersion: 99,
      requestId: 'r4',
      method: 'getCreator',
      params: {},
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('PARSE_ERROR');
  });

  it('fails when a known method has no registered handler', async () => {
    const router = createRouter({});
    const res = await router.dispatch(createRequest('getCreator', {}, { requestId: 'r5' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('PARSE_ERROR');
  });

  it('maps a thrown SonarException to a standardized failure', async () => {
    const router = createRouter({
      downloadVideo: async () => {
        throw new SonarException(makeError('NO_WATERMARK_SOURCE', '没有无水印源'));
      },
    });
    const res = await router.dispatch(createRequest('downloadVideo', {}, { requestId: 'r6' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NO_WATERMARK_SOURCE');
  });

  it('maps an arbitrary thrown error to NETWORK_ERROR', async () => {
    const router = createRouter({
      getCreator: async () => {
        throw new Error('kaboom');
      },
    });
    const res = await router.dispatch(createRequest('getCreator', {}, { requestId: 'r7' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NETWORK_ERROR');
  });

  it('preserves a best-effort requestId even when decoding fails', async () => {
    const router = createRouter({});
    const res = await router.dispatch({ requestId: 'r8', method: 'getCreator' });
    expect(res.requestId).toBe('r8');
    expect(res.ok).toBe(false);
  });
});
