import { useCallback, useEffect } from 'react';

export type SettingsLeaveGuard = () => Promise<boolean>;

interface RunSettingsLeaveGuardOptions {
  title: string;
  hasUnsavedChanges: boolean;
  onSave: () => Promise<boolean>;
  confirm?: (message: string) => boolean;
}

interface UseSettingsTabGuardOptions {
  title: string;
  hasUnsavedChanges: boolean;
  onSave: () => Promise<boolean>;
  onRegisterLeaveGuard?: (guard: SettingsLeaveGuard | null) => void;
}

export function buildUnsavedChangesConfirmMessage(title: string): string {
  return `${title}还有未保存的更改。\n点击“确定”会先保存再离开，点击“取消”将留在当前页面。`;
}

export async function runSettingsLeaveGuard({
  title,
  hasUnsavedChanges,
  onSave,
  confirm = (message) => window.confirm(message),
}: RunSettingsLeaveGuardOptions): Promise<boolean> {
  if (!hasUnsavedChanges) {
    return true;
  }

  if (!confirm(buildUnsavedChangesConfirmMessage(title))) {
    return false;
  }

  return onSave();
}

export function useSettingsTabGuard({
  title,
  hasUnsavedChanges,
  onSave,
  onRegisterLeaveGuard,
}: UseSettingsTabGuardOptions): void {
  const handleBeforeLeave = useCallback(
    () =>
      runSettingsLeaveGuard({
        title,
        hasUnsavedChanges,
        onSave,
      }),
    [title, hasUnsavedChanges, onSave],
  );

  useEffect(() => {
    if (!onRegisterLeaveGuard) {
      return undefined;
    }

    onRegisterLeaveGuard(handleBeforeLeave);
    return () => onRegisterLeaveGuard(null);
  }, [handleBeforeLeave, onRegisterLeaveGuard]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);
}
