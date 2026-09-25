import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  createRequest,
  createSuccess,
  createFailure,
  decodeRequest,
  decodeResponse,
} from '@/protocol/messages';

describe('createRequest', () => {
  it('builds an envelope with version, method, params and a generated requestId', () => {
    const req = createRequest('getCreator', { creatorId: 'c1' });
    expect(req.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(req.method).toBe('getCreator');
    expect(req.params).toEqual({ creatorId: 'c1' });
    expect(typeof req.requestId).toBe('string');
    expect(req.requestId.length).toBeGreaterThan(0);
  });

  it('honors an injected requestId for deterministic tests', () => {
    const req = createRequest('detectCurrentPage', undefined, { requestId: 'fixed-1' });
    expect(req.requestId).toBe('fixed-1');
  });

  it('generates distinct ids across calls', () => {
    const a = createRequest('listFollowedCreators', undefined);
    const b = createRequest('listFollowedCreators', undefined);
    expect(a.requestId).not.toBe(b.requestId);
  });
});

describe('decodeRequest', () => {
  it('accepts a well-formed request envelope', () => {
    const raw = createRequest('downloadVideo', { videoId: 'v1' }, { requestId: 'r1' });
    const result = decodeRequest(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.method).toBe('downloadVideo');
      expect(result.value.requestId).toBe('r1');
    }
  });

  it('rejects a non-object payload', () => {
    const result = decodeRequest('not-an-object');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_ERROR');
  });

  it('fails explicitly on an unknown protocol version (no silent ignore)', () => {
    const raw = {
      protocolVersion: 999,
      requestId: 'r1',
      method: 'getCreator',
      params: {},
    };
    const result = decodeRequest(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARSE_ERROR');
      expect(result.error.message).toMatch(/协议版本|protocol/i);
    }
  });

  it('fails explicitly on an unknown method', () => {
    const raw = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'r1',
      method: 'deleteEverything',
      params: {},
    };
    const result = decodeRequest(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PARSE_ERROR');
      expect(result.error.message).toMatch(/方法|method/i);
    }
  });

  it('rejects a missing or non-string requestId', () => {
    const raw = {
      protocolVersion: PROTOCOL_VERSION,
      method: 'getCreator',
      params: {},
    };
    const result = decodeRequest(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_ERROR');
  });
});

describe('response envelopes', () => {
  it('createSuccess carries the request id and result', () => {
    const res = createSuccess('r1', { value: 42 });
    expect(res.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(res.requestId).toBe('r1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result).toEqual({ value: 42 });
  });

  it('createFailure carries the standardized error', () => {
    const res = createFailure('r1', { code: 'TIMEOUT', message: '超时' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('TIMEOUT');
  });

  it('decodeResponse round-trips a success envelope', () => {
    const res = decodeResponse(createSuccess('r1', { a: 1 }));
    expect(res.ok).toBe(true);
    if (res.ok && res.value.ok) expect(res.value.result).toEqual({ a: 1 });
  });

  it('decodeResponse fails explicitly on unknown protocol version', () => {
    const res = decodeResponse({ protocolVersion: 2, requestId: 'r1', ok: true, result: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('PARSE_ERROR');
  });
});
