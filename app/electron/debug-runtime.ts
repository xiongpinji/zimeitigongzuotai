interface DebugRuntimeStateInput {
  isPackaged: boolean;
  debugMode: boolean;
}

export function resolveDebugRuntimeState(input: DebugRuntimeStateInput): {
  isDevelopment: boolean;
  allowDevTools: boolean;
} {
  const isDevelopment = !input.isPackaged || input.debugMode;
  return {
    isDevelopment,
    allowDevTools: isDevelopment,
  };
}

export function shouldAutoOpenDevTools(input: DebugRuntimeStateInput): boolean {
  return input.isPackaged && input.debugMode;
}
