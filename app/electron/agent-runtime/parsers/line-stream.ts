/**
 * Stateful newline-delimited JSON stream parser with partial-line aggregation.
 *
 * Each chunk (string or Buffer) is split on `\n`. Incomplete trailing content
 * is buffered and prepended to the next feed. Lines that fail JSON.parse are
 * accumulated with subsequent lines until the combined text parses successfully
 * (multi-line JSON). Aggregation is capped at 256 lines / 128 KB; breaching
 * either limit discards the accumulator and routes the original first line to
 * `onRaw` (if provided).
 */

export interface JsonLineStream {
  feed(chunk: string | Buffer): void;
  flush(): void;
}

const AGGREGATE_MAX_LINES = 256;
const AGGREGATE_MAX_BYTES = 128 * 1024; // 128 KB

export function createJsonLineStream(opts: {
  onJson: (obj: unknown) => void;
  onRaw?: (line: string) => void;
}): JsonLineStream {
  const { onJson, onRaw } = opts;

  /** Characters pending from the previous feed that did not end with \n */
  let tailBuffer = '';

  /** Lines being accumulated while we wait for valid JSON */
  let aggregateLines: string[] = [];
  /** The raw text of the very first line in an aggregation sequence */
  let aggregateFirstLine = '';
  /** Running byte length of the accumulator */
  let aggregateBytes = 0;

  /** Returns true if the trimmed text looks like it could be partial JSON. */
  function looksLikePartialJson(text: string): boolean {
    return text.startsWith('{') || text.startsWith('[') || text.startsWith('"');
  }

  function tryParseOrAggregate(line: string): void {
    const trimmed = line.trim();
    if (trimmed === '') return; // skip blank / whitespace-only lines

    if (aggregateLines.length === 0) {
      // Not in aggregation mode — try parsing the trimmed line directly.
      try {
        onJson(JSON.parse(trimmed));
        return;
      } catch {
        // Only enter aggregation mode if this looks like partial JSON.
        if (!looksLikePartialJson(trimmed)) {
          if (onRaw) onRaw(trimmed);
          return;
        }
        // Start aggregation — save the original (trimmed) first line.
        aggregateFirstLine = trimmed;
        aggregateLines.push(trimmed);
        aggregateBytes = Buffer.byteLength(trimmed, 'utf8');
        return;
      }
    }

    // We are in aggregation mode — append the new line.
    aggregateLines.push(trimmed);
    aggregateBytes += Buffer.byteLength(trimmed, 'utf8') + 1; // +1 for \n

    const combined = aggregateLines.join('\n');

    // Check limits BEFORE attempting parse, so we don't accept a valid parse
    // that happens to be at the boundary (the spec says discard *when exceeded*).
    if (
      aggregateLines.length > AGGREGATE_MAX_LINES ||
      aggregateBytes > AGGREGATE_MAX_BYTES
    ) {
      // Exceeded limits — discard accumulator, emit first line as raw.
      if (onRaw) onRaw(aggregateFirstLine);
      resetAggregate();
      return;
    }

    try {
      onJson(JSON.parse(combined));
      resetAggregate();
    } catch {
      // Still not valid JSON — keep accumulating.
    }
  }

  function resetAggregate(): void {
    aggregateLines = [];
    aggregateFirstLine = '';
    aggregateBytes = 0;
  }

  function processLine(line: string): void {
    tryParseOrAggregate(line);
  }

  function flushAggregate(): void {
    if (aggregateLines.length === 0) return;
    // Try the full accumulator one more time.
    const combined = aggregateLines.join('\n');
    try {
      onJson(JSON.parse(combined));
    } catch {
      if (onRaw) onRaw(aggregateFirstLine);
    }
    resetAggregate();
  }

  function feed(chunk: string | Buffer): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const combined = tailBuffer + text;

    const newlineIndex = combined.lastIndexOf('\n');
    if (newlineIndex === -1) {
      // No complete line in this feed — buffer everything.
      tailBuffer = combined;
      return;
    }

    // Everything up to and including the last \n has complete lines.
    const completeSection = combined.slice(0, newlineIndex);
    tailBuffer = combined.slice(newlineIndex + 1);

    const lines = completeSection.split('\n');
    for (const line of lines) {
      processLine(line);
    }
  }

  function flush(): void {
    if (tailBuffer !== '') {
      const remaining = tailBuffer;
      tailBuffer = '';
      processLine(remaining);
    }
    flushAggregate();
  }

  return { feed, flush };
}
