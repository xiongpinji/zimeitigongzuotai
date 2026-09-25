import { describe, it, expect, beforeEach } from 'vitest';
import { useAiEditStore } from '../src/store/ai-edit';

describe('useAiEditStore', () => {
  beforeEach(() => useAiEditStore.setState({ locked: false, scope: undefined }));
  it('setLock 更新锁态', () => {
    useAiEditStore.getState().setLock({ active: true, scope: 'video' });
    expect(useAiEditStore.getState().locked).toBe(true);
    expect(useAiEditStore.getState().scope).toBe('video');
  });
  it('解锁清空 scope', () => {
    useAiEditStore.getState().setLock({ active: true, scope: 'script' });
    useAiEditStore.getState().setLock({ active: false });
    expect(useAiEditStore.getState().locked).toBe(false);
    expect(useAiEditStore.getState().scope).toBeUndefined();
  });
});
