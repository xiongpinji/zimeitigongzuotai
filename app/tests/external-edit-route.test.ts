import { describe, it, expect } from 'vitest';
import { routeExternalEdit } from '../src/lib/external-edit-route';

describe('routeExternalEdit', () => {
  it('project.json', () => {
    expect(routeExternalEdit('project.json')).toEqual({ kind: 'project' });
  });
  it('script.md', () => {
    expect(routeExternalEdit('script.md')).toEqual({ kind: 'script' });
  });
  it('original.md', () => {
    expect(routeExternalEdit('original.md')).toEqual({ kind: 'original' });
  });
  it('motionCard.tsx 解析 overlayId', () => {
    expect(routeExternalEdit('ai-cards/ovX/motionCard.tsx')).toEqual({ kind: 'motion-card', overlayId: 'ovX' });
  });
  it('windows 分隔符也能解析', () => {
    expect(routeExternalEdit('ai-cards\\ovY\\motionCard.tsx')).toEqual({ kind: 'motion-card', overlayId: 'ovY' });
  });
  it('其他文件归 other', () => {
    expect(routeExternalEdit('notes.txt')).toEqual({ kind: 'other' });
  });
});
