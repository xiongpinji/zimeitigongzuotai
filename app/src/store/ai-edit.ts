import { create } from 'zustand';

interface AiEditState {
  locked: boolean;
  scope?: 'video' | 'script';
  setLock: (change: { active: boolean; scope?: 'video' | 'script' }) => void;
}

export const useAiEditStore = create<AiEditState>((set) => ({
  locked: false,
  scope: undefined,
  setLock: ({ active, scope }) => set({ locked: active, scope: active ? scope : undefined }),
}));

/** 供非 React 处（timeline 订阅）同步读取当前是否锁定。 */
export function isAiEditLocked(): boolean {
  return useAiEditStore.getState().locked;
}
