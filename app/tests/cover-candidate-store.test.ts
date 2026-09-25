import { describe, it, expect, beforeEach } from 'vitest';
import { useAIStore } from '../src/store/ai';

describe('AIStore cover editing actions', () => {
  beforeEach(() => {
    useAIStore.setState({ coverCandidates: [] });
  });

  it('appendCoverCandidate 追加并保留既有候选', () => {
    useAIStore.setState({
      coverCandidates: [{ id: 'a', prompt: 'x', imageUrl: '/a.png', selected: true }],
    });
    useAIStore.getState().appendCoverCandidate({
      id: 'b',
      prompt: 'x',
      imageUrl: '/b.png',
      selected: false,
      editedFrom: 'a',
      createdAt: 1,
    });
    const list = useAIStore.getState().coverCandidates;
    expect(list).toHaveLength(2);
    expect(list[1].editedFrom).toBe('a');
  });

  it('replaceCoverCandidate 原地替换并保留顺序', () => {
    useAIStore.setState({
      coverCandidates: [
        { id: 'a', prompt: 'x', imageUrl: '/a.png', selected: false },
        { id: 'b', prompt: 'y', imageUrl: '/b.png', selected: true },
      ],
    });
    useAIStore.getState().replaceCoverCandidate('a', {
      imageUrl: '/a.png?v=2',
      edits: { version: 1, aspectRatio: '16:9' },
    });
    const list = useAIStore.getState().coverCandidates;
    expect(list).toHaveLength(2);
    expect(list[0].imageUrl).toBe('/a.png?v=2');
    expect(list[0].edits?.aspectRatio).toBe('16:9');
    expect(list[1].id).toBe('b');
  });

  it('updateCoverEdits 只更新 edits 字段', () => {
    useAIStore.setState({
      coverCandidates: [{ id: 'a', prompt: 'x', imageUrl: '/a.png', selected: false }],
    });
    useAIStore.getState().updateCoverEdits('a', { version: 1, aspectRatio: '9:16' });
    expect(useAIStore.getState().coverCandidates[0].edits?.aspectRatio).toBe('9:16');
  });
});
