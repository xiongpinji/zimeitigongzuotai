import { describe, expect, it } from 'vitest';
import { authorizeProductionMcpRequest } from '../electron/mcp/production-auth';

const token = 'a'.repeat(48);
const request = (overrides: Partial<{ remoteAddress: string; origin: string | undefined;
  tokenHeader: string | string[] | undefined }> = {}) => ({
  remoteAddress: '127.0.0.1', origin: undefined, tokenHeader: token, ...overrides,
});

describe('production MCP request boundary', () => {
  it('requires a protected token on every local protocol request', () => {
    expect(authorizeProductionMcpRequest(request(), token)).toBe(true);
    expect(authorizeProductionMcpRequest(request({ tokenHeader: undefined }), token)).toBe(false);
    expect(authorizeProductionMcpRequest(request({ tokenHeader: 'b'.repeat(48) }), token)).toBe(false);
    expect(authorizeProductionMcpRequest(request({ tokenHeader: [token] }), token)).toBe(false);
    expect(authorizeProductionMcpRequest(request(), '')).toBe(false);
  });

  it('rejects remote addresses and browser origins even with a valid token', () => {
    expect(authorizeProductionMcpRequest(request({ remoteAddress: '::1' }), token)).toBe(true);
    expect(authorizeProductionMcpRequest(request({ remoteAddress: '192.168.1.2' }), token)).toBe(false);
    expect(authorizeProductionMcpRequest(request({ remoteAddress: '::ffff:127.0.0.1' }), token)).toBe(false);
    expect(authorizeProductionMcpRequest(request({ origin: 'http://127.0.0.1:3000' }), token)).toBe(false);
    expect(authorizeProductionMcpRequest(request({ origin: 'null' }), token)).toBe(false);
  });
});
