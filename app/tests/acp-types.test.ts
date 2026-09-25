import { describe, expect, it } from 'vitest';
import {
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcNotification,
  type JsonRpcMessage,
} from '../electron/acp/types';

describe('JSON-RPC message type guards', () => {
  it('identifies a request', () => {
    const msg: JsonRpcMessage = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    expect(isJsonRpcRequest(msg)).toBe(true);
    expect(isJsonRpcResponse(msg)).toBe(false);
    expect(isJsonRpcNotification(msg)).toBe(false);
  });

  it('identifies a response with result', () => {
    const msg: JsonRpcMessage = { jsonrpc: '2.0', id: 1, result: { ok: true } };
    expect(isJsonRpcResponse(msg)).toBe(true);
    expect(isJsonRpcRequest(msg)).toBe(false);
  });

  it('identifies a response with error', () => {
    const msg: JsonRpcMessage = {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600, message: 'Invalid Request' },
    };
    expect(isJsonRpcResponse(msg)).toBe(true);
  });

  it('identifies a notification', () => {
    const msg: JsonRpcMessage = { jsonrpc: '2.0', method: 'session/event', params: {} };
    expect(isJsonRpcNotification(msg)).toBe(true);
    expect(isJsonRpcRequest(msg)).toBe(false);
  });
});
