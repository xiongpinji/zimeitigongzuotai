// tests/script-resource-view.test.tsx
//
// 注意：项目测试环境为 vitest node + 静态 SSR（renderToStaticMarkup），
// 未引入 @testing-library/react / jsdom。此文件遵循项目惯例，使用 SSR
// 做结构断言；动态交互（fireEvent / waitFor hydrate）由 Track 1 的
// workspace-resources lib 单元测试覆盖（搜索、缓存、解析逻辑）。
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScriptResourceView } from '../src/components/script/ScriptResourceView';
import type { FileEntry } from '../src/lib/electron-api';

function makeEntries(): FileEntry[] {
  return [
    { name: 'original.md', type: 'file' },
    { name: 'script.md', type: 'file' },
    {
      name: 'douyin',
      type: 'directory',
      children: [
        {
          name: 'v_abc123',
          type: 'directory',
          children: [{ name: 'preview.json', type: 'file' }],
        },
      ],
    },
  ];
}

function stubElectronAPI() {
  // 避免 ResourceRow 触发的 useEffect 调用真实 electronAPI；
  // 同时补 ui 库（如 Badge）在 SSR 时引用的 window.matchMedia 接口。
  (globalThis as unknown as { window: unknown }).window = {
    electronAPI: {
      loadScriptFile: vi.fn().mockResolvedValue(null),
    },
    matchMedia: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  };
}

describe('ScriptResourceView', () => {
  it('renders the no-project empty state when projectDir is null', () => {
    stubElectronAPI();
    const html = renderToStaticMarkup(
      <ScriptResourceView
        projectDir={null}
        fileEntries={makeEntries()}
        openedFile={null}
        fileDirtyMap={{}}
        fileConflictMap={{}}
        onOpenFile={() => {}}
      />,
    );
    expect(html).toContain('尚未选择工作目录');
    expect(html).toContain('选择目录后将展示关键稿件资源');
  });

  it('renders the empty state when no resource files are present', () => {
    stubElectronAPI();
    const html = renderToStaticMarkup(
      <ScriptResourceView
        projectDir="/proj"
        fileEntries={[{ name: 'notes.md', type: 'file' }]}
        openedFile={null}
        fileDirtyMap={{}}
        fileConflictMap={{}}
        onOpenFile={() => {}}
      />,
    );
    expect(html).toContain('暂无稿件资源');
    expect(html).toContain('导入文稿或媒体后');
  });

  it('renders three group headings and the douyin videoId placeholder before hydration', () => {
    stubElectronAPI();
    const html = renderToStaticMarkup(
      <ScriptResourceView
        projectDir="/proj"
        fileEntries={makeEntries()}
        openedFile={null}
        fileDirtyMap={{}}
        fileConflictMap={{}}
        onOpenFile={() => {}}
      />,
    );
    // 三个分组标题
    expect(html).toContain('原始文稿');
    expect(html).toContain('口播脚本');
    expect(html).toContain('抖音导入');
    // 抖音项目初始用 videoId 占位
    expect(html).toContain('v_abc123');
    expect(html).toContain('抖音 · 解析中');
    // 搜索框 placeholder
    expect(html).toContain('搜索稿件...');
  });

  it('renders only the original group when only original.md exists', () => {
    stubElectronAPI();
    const html = renderToStaticMarkup(
      <ScriptResourceView
        projectDir="/proj"
        fileEntries={[{ name: 'original.md', type: 'file' }]}
        openedFile={null}
        fileDirtyMap={{}}
        fileConflictMap={{}}
        onOpenFile={() => {}}
      />,
    );
    expect(html).toContain('原始文稿');
    // 其他分组标题不应出现（注意：分组标题文本与展示名相同，但展示名也只在自身分组下出现）
    expect(html).not.toContain('口播脚本');
    expect(html).not.toContain('抖音导入');
  });

  it('marks the active row with aria-selected and exposes data-file-path for each row', () => {
    stubElectronAPI();
    const html = renderToStaticMarkup(
      <ScriptResourceView
        projectDir="/proj"
        fileEntries={makeEntries()}
        openedFile="original.md"
        fileDirtyMap={{ 'script.md': true }}
        fileConflictMap={{}}
        onOpenFile={() => {}}
      />,
    );
    // 行属性
    expect(html).toContain('role="treeitem"');
    expect(html).toContain('data-file-path="original.md"');
    expect(html).toContain('data-file-path="script.md"');
    expect(html).toContain('data-file-path="douyin/v_abc123/preview.json"');
    // 拖拽支持
    expect(html).toContain('draggable="true"');
    // 激活态：original.md 行带 aria-selected="true"
    expect(html).toMatch(/aria-selected="true"[^>]*data-file-path="original\.md"/);
    // 未激活的另一项不应是 selected
    expect(html).toMatch(/aria-selected="false"[^>]*data-file-path="script\.md"/);
    // dirty 标记类名出现
    expect(html).toContain('_dirtyDot_');
  });
});
