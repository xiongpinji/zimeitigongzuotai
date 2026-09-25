import { describe, expect, it, vi } from 'vitest';
import { createJsonLineStream } from '../../electron/agent-runtime/parsers/line-stream';

describe('createJsonLineStream', () => {
  it('emits a parsed object for a single complete JSON line', () => {
    const onJson = vi.fn();
    const stream = createJsonLineStream({ onJson });

    stream.feed('{"a":1}\n');

    expect(onJson).toHaveBeenCalledTimes(1);
    expect(onJson).toHaveBeenCalledWith({ a: 1 });
  });

  it('handles a JSON object split across two feeds (half-line buffering)', () => {
    const onJson = vi.fn();
    const stream = createJsonLineStream({ onJson });

    stream.feed('{"a":');
    expect(onJson).not.toHaveBeenCalled();

    stream.feed('1}\n');
    expect(onJson).toHaveBeenCalledTimes(1);
    expect(onJson).toHaveBeenCalledWith({ a: 1 });
  });

  it('emits three objects for three JSON lines in one feed', () => {
    const onJson = vi.fn();
    const stream = createJsonLineStream({ onJson });

    stream.feed('{"x":1}\n{"x":2}\n{"x":3}\n');

    expect(onJson).toHaveBeenCalledTimes(3);
    expect(onJson).toHaveBeenNthCalledWith(1, { x: 1 });
    expect(onJson).toHaveBeenNthCalledWith(2, { x: 2 });
    expect(onJson).toHaveBeenNthCalledWith(3, { x: 3 });
  });

  it('routes a non-JSON line to onRaw (after exhausting aggregation attempts)', () => {
    const onJson = vi.fn();
    const onRaw = vi.fn();
    const stream = createJsonLineStream({ onJson, onRaw });

    stream.feed('hello\n');

    expect(onJson).not.toHaveBeenCalled();
    expect(onRaw).toHaveBeenCalledTimes(1);
    expect(onRaw).toHaveBeenCalledWith('hello');
  });

  it('aggregates two lines into a valid JSON object and emits via onJson', () => {
    // Simulates a stream that sends a JSON object one field per line — parse
    // fails on line 1 alone, succeeds when line 2 is appended.
    const onJson = vi.fn();
    const onRaw = vi.fn();
    const stream = createJsonLineStream({ onJson, onRaw });

    // Line 1: '{"b":' — not valid JSON on its own
    // Line 2: '2}'   — combined '{"b":\n2}' is valid JSON
    stream.feed('{"b":\n2}\n');

    expect(onJson).toHaveBeenCalledTimes(1);
    expect(onJson).toHaveBeenCalledWith({ b: 2 });
    expect(onRaw).not.toHaveBeenCalled();
  });

  it('flush emits the remaining buffered content without a trailing newline', () => {
    const onJson = vi.fn();
    const onRaw = vi.fn();
    const stream = createJsonLineStream({ onJson, onRaw });

    stream.feed('{"c":3}');
    expect(onJson).not.toHaveBeenCalled();

    stream.flush();
    expect(onJson).toHaveBeenCalledTimes(1);
    expect(onJson).toHaveBeenCalledWith({ c: 3 });
  });

  it('flush emits non-JSON remainder via onRaw', () => {
    const onJson = vi.fn();
    const onRaw = vi.fn();
    const stream = createJsonLineStream({ onJson, onRaw });

    stream.feed('not-json');
    stream.flush();

    expect(onJson).not.toHaveBeenCalled();
    expect(onRaw).toHaveBeenCalledWith('not-json');
  });

  it('accepts Buffer input and handles it identically to string input', () => {
    const onJson = vi.fn();
    const stream = createJsonLineStream({ onJson });

    stream.feed(Buffer.from('{"d":4}\n'));

    expect(onJson).toHaveBeenCalledTimes(1);
    expect(onJson).toHaveBeenCalledWith({ d: 4 });
  });

  it('ignores empty or whitespace-only lines', () => {
    const onJson = vi.fn();
    const onRaw = vi.fn();
    const stream = createJsonLineStream({ onJson, onRaw });

    stream.feed('\n   \n\n{"e":5}\n');

    expect(onJson).toHaveBeenCalledTimes(1);
    expect(onJson).toHaveBeenCalledWith({ e: 5 });
    expect(onRaw).not.toHaveBeenCalled();
  });
});
