export type WorkbenchTabCloseAction = 'close-current' | 'close-others' | 'close-right';

export function getWorkbenchTabCloseTargets(
  tabs: string[],
  targetFile: string,
  action: WorkbenchTabCloseAction,
): string[] {
  const targetIndex = tabs.indexOf(targetFile);
  if (targetIndex === -1) {
    return [];
  }

  switch (action) {
    case 'close-current':
      return [targetFile];
    case 'close-others':
      return tabs.filter((tab) => tab !== targetFile);
    case 'close-right':
      return tabs.slice(targetIndex + 1);
    default:
      return [];
  }
}

export function getNextOpenedWorkbenchTab(
  tabs: string[],
  activeFile: string | null,
  closingFiles: string[],
): string | null {
  if (!activeFile) {
    return null;
  }

  const closingSet = new Set(closingFiles);
  if (!closingSet.has(activeFile)) {
    return activeFile;
  }

  const activeIndex = tabs.indexOf(activeFile);
  if (activeIndex === -1) {
    return null;
  }

  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const candidate = tabs[index];
    if (!closingSet.has(candidate)) {
      return candidate;
    }
  }

  for (let index = activeIndex + 1; index < tabs.length; index += 1) {
    const candidate = tabs[index];
    if (!closingSet.has(candidate)) {
      return candidate;
    }
  }

  return null;
}
