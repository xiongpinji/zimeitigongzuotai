export interface WaitForValueOptions {
  maxAttempts?: number;
  schedule?: (resume: () => void) => void;
}

const DEFAULT_MAX_ATTEMPTS = 8;

function defaultSchedule(resume: () => void) {
  requestAnimationFrame(() => resume());
}

/**
 * 等待某个惰性初始化的引用可用，例如 CodeMirror EditorView。
 * 采用逐帧轮询，避免只等一帧时错过 useEffect / paint 后初始化。
 */
export async function waitForValue<T>(
  getter: () => T | null | undefined,
  options: WaitForValueOptions = {},
): Promise<T | null> {
  const existing = getter();
  if (existing != null) {
    return existing;
  }

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const schedule = options.schedule ?? defaultSchedule;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise<void>((resolve) => {
      schedule(resolve);
    });

    const value = getter();
    if (value != null) {
      return value;
    }
  }

  return null;
}
