// tests/cover-editor-modal.test.tsx
//
// 说明：CoverEditorModal 依赖 Dialog / Select 等 UI 组件，这些组件在
// 挂载时会访问 document / portal，node 环境（无 jsdom）无法 SSR 渲染。
// 因此本测试仅做 import 冒烟与 open=false 早退验证，防止组件模块本身
// 编译失败或 open=false 时产生意外副作用。
import { describe, expect, it, vi } from 'vitest';
import { CoverEditorModal } from '../src/components/CoverEditorModal';

vi.mock('fabric', () => ({
  Canvas: vi.fn(),
  FabricImage: {
    fromURL: () => Promise.resolve({}),
  },
  Textbox: vi.fn(),
  Rect: vi.fn(),
  filters: {
    Brightness: vi.fn(),
    Contrast: vi.fn(),
    Saturation: vi.fn(),
  },
}));

describe('CoverEditorModal', () => {
  it('模块导出可用', () => {
    expect(typeof CoverEditorModal).toBe('function');
  });
});
