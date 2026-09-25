import { describe, expect, it } from 'vitest';
import {
  describeToolCallBlock,
  fileChangeFromToolCall,
} from '../src/components/agent/tool-call-descriptor';

describe('describeToolCallBlock', () => {
  it('把 PI bash 工具调用描述为命令执行', () => {
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'bash',
      kind: 'execute',
      status: 'completed',
      rawInput: '{"command":"npm test -- --run tests/tool-call-block.test.tsx","timeout":120}',
      rawOutput: '12 tests passed\nexit code: 0',
    });

    expect(descriptor.label).toBe('执行命令');
    expect(descriptor.subject).toBe('npm test -- --run tests/tool-call-block.test.tsx');
    expect(descriptor.meta).toContain('timeout 120s');
    expect(descriptor.previewLabel).toBe('命令');
    expect(descriptor.sections).toEqual([{
      label: 'Shell',
      content: '$ npm test -- --run tests/tool-call-block.test.tsx\n12 tests passed\nexit code: 0',
      kind: 'shell',
    }]);
  });

  it('兼容 PI/ACP command 字段藏在嵌套 input 时的命令展示', () => {
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'bash',
      kind: 'execute',
      status: 'completed',
      rawInput: '{"input":{"command":"npm run lint"},"timeoutMs":30000}',
      rawOutput: 'lint ok',
    });

    expect(descriptor.label).toBe('执行命令');
    expect(descriptor.subject).toBe('npm run lint');
    expect(descriptor.sections).toEqual([{
      label: 'Shell',
      content: '$ npm run lint\nlint ok',
      kind: 'shell',
    }]);
  });

  it('即使工具名泛化，只要 rawInput 有 command 也展示完整命令', () => {
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: '工具调用',
      kind: '',
      status: 'completed',
      rawInput: '{"command":"wc -l original.md"}',
      rawOutput: '110 original.md',
    });

    expect(descriptor.label).toBe('执行命令');
    expect(descriptor.subject).toBe('wc -l original.md');
    expect(descriptor.sections).toEqual([{
      label: 'Shell',
      content: '$ wc -l original.md\n110 original.md',
      kind: 'shell',
    }]);
  });

  it('把 PI read 工具调用描述为读取目标文件和行号范围', () => {
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'read',
      kind: 'read',
      status: 'completed',
      rawInput: '{"path":"src/App.tsx","offset":10,"limit":20}',
      rawOutput: 'line 10\nline 11',
    });

    expect(descriptor.label).toBe('读取文件');
    expect(descriptor.subject).toBe('src/App.tsx:10-29');
    expect(descriptor.previewLabel).toBe('目标');
    expect(descriptor.sections[0]).toEqual({
      label: 'Target',
      content: 'src/App.tsx:10-29',
      kind: 'text',
    });
  });

  it('把 PI edit 工具调用描述为编辑文件并提取 diff 统计', () => {
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'edit',
      kind: 'edit',
      status: 'completed',
      rawInput: '{"path":"src/foo.ts","oldString":"old","newString":"new"}',
      rawOutput: 'Successfully replaced 1 block(s) in src/foo.ts.',
    });

    expect(descriptor.label).toBe('编辑文件');
    expect(descriptor.subject).toBe('src/foo.ts');
    expect(descriptor.meta).toContain('+1 / -1');
    expect(descriptor.sections).toContainEqual({
      label: 'Diff',
      content: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
      kind: 'diff',
    });
    expect(descriptor.sections.some((section) => section.label === 'Target')).toBe(false);
  });

  it('兼容 PI edit 使用 target/old_text/new_text 字段，不把成功提示当 diff', () => {
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'edit',
      kind: 'edit',
      status: 'completed',
      rawInput: '{"target":"original.md","old_text":"原稿","new_text":"你好，原稿"}',
      rawOutput: 'Successfully replaced 1 block(s) in original.md.',
    });

    expect(descriptor.label).toBe('编辑文件');
    expect(descriptor.subject).toBe('original.md');
    expect(descriptor.sections).toEqual([{
      label: 'Diff',
      content: '--- a/original.md\n+++ b/original.md\n@@ -1,1 +1,1 @@\n-原稿\n+你好，原稿',
      kind: 'diff',
    }]);
    expect(descriptor.sections.some((section) => section.content.includes('Successfully replaced'))).toBe(false);
  });

  it('解析 PI edit 真实入参格式 edits:[{oldText,newText}] 并渲染 diff', () => {
    // pi 的 edit 工具入参是 { path, edits:[{oldText,newText}] }（嵌套数组），
    // 旧实现只认顶层扁平 oldText/newText，识别不到 edits[] → 回退成 JSON+成功文本。
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'edit',
      kind: 'edit',
      status: 'completed',
      rawInput: JSON.stringify({
        path: 'original.md',
        edits: [{ oldText: '又到了一年一度新能源车下乡活动了', newText: '你好，又到了一年一度新能源车下乡活动了' }],
      }),
      rawOutput: 'Successfully replaced 1 block(s) in original.md.',
    });

    expect(descriptor.label).toBe('编辑文件');
    expect(descriptor.subject).toBe('original.md');
    expect(descriptor.sections).toEqual([{
      label: 'Diff',
      content:
        '--- a/original.md\n+++ b/original.md\n@@ -1,1 +1,1 @@\n-又到了一年一度新能源车下乡活动了\n+你好，又到了一年一度新能源车下乡活动了',
      kind: 'diff',
    }]);
    expect(descriptor.sections.some((section) => section.content.includes('Successfully replaced'))).toBe(false);
  });

  it('PI edit 多条 edits[] 合并为单个文件头、逐条 hunk 的 diff', () => {
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'edit',
      kind: 'edit',
      status: 'completed',
      rawInput: JSON.stringify({
        path: 'src/foo.ts',
        edits: [
          { oldText: 'alpha', newText: 'ALPHA' },
          { oldText: 'omega', newText: 'OMEGA' },
        ],
      }),
    });

    const diff = descriptor.sections.find((section) => section.label === 'Diff')!.content;
    // 单个文件头
    expect((diff.match(/^--- a\/src\/foo\.ts$/gm) ?? []).length).toBe(1);
    expect((diff.match(/^\+\+\+ b\/src\/foo\.ts$/gm) ?? []).length).toBe(1);
    // 两条改动各一条 +/-，统计 +2 / -2
    expect(diff.split('\n').filter((l) => /^-(?!--)/.test(l))).toEqual(['-alpha', '-omega']);
    expect(diff.split('\n').filter((l) => /^\+(?!\+\+)/.test(l))).toEqual(['+ALPHA', '+OMEGA']);
    expect(descriptor.meta).toContain('+2 / -2');
  });

  it('edits 以 JSON 字符串形式传来（部分模型行为）也能解析', () => {
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'edit',
      kind: 'edit',
      status: 'completed',
      rawInput: JSON.stringify({
        path: 'a.md',
        edits: JSON.stringify([{ oldText: 'x', newText: 'y' }]),
      }),
    });

    expect(descriptor.sections).toEqual([{
      label: 'Diff',
      content: '--- a/a.md\n+++ b/a.md\n@@ -1,1 +1,1 @@\n-x\n+y',
      kind: 'diff',
    }]);
  });

  it('fileChangeFromToolCall 支持 PI edits[] 聚合为文件变更（含 diff）', () => {
    const change = fileChangeFromToolCall({
      type: 'tool_call',
      title: 'edit',
      kind: 'edit',
      status: 'completed',
      rawInput: JSON.stringify({
        path: 'original.md',
        edits: [{ oldText: '原稿', newText: '你好，原稿' }],
      }),
      rawOutput: 'Successfully replaced 1 block(s) in original.md.',
    });

    expect(change).not.toBeNull();
    expect(change!.path).toBe('original.md');
    expect(change!.operation).toBe('edit');
    expect(change!.diff).toContain('-原稿');
    expect(change!.diff).toContain('+你好，原稿');
  });

  it('把 PI write 工具调用描述为写入文件并显示写入行数', () => {
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'write',
      kind: 'edit',
      status: 'completed',
      rawInput: '{"path":"README.md","content":"one\\ntwo\\nthree"}',
      rawOutput: 'Wrote README.md',
    });

    expect(descriptor.label).toBe('写入文件');
    expect(descriptor.subject).toBe('README.md');
    expect(descriptor.meta).toContain('3 lines');
    expect(descriptor.sections).toContainEqual({
      label: 'Content',
      content: 'one\ntwo\nthree',
      kind: 'code',
    });
  });

  it('即使工具名泛化，只要 rawInput 有 path/content 也展示写入内容', () => {
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: '工具调用',
      kind: '',
      status: 'completed',
      rawInput: '{"path":"original.md","content":"你好\\n原文"}',
      rawOutput: 'Successfully wrote 116 bytes to original.md',
    });

    expect(descriptor.label).toBe('写入文件');
    expect(descriptor.subject).toBe('original.md');
    expect(descriptor.sections).toContainEqual({
      label: 'Content',
      content: '你好\n原文',
      kind: 'code',
    });
  });

  it('把 PI grep 工具调用描述为搜索范围', () => {
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'grep',
      kind: 'read',
      status: 'completed',
      rawInput: '{"pattern":"tool_execution_start","path":"electron"}',
      rawOutput: 'electron/agent-runtime/parsers/pi-rpc.ts:129',
    });

    expect(descriptor.label).toBe('搜索');
    expect(descriptor.subject).toBe('/tool_execution_start/ in electron');
    expect(descriptor.previewLabel).toBe('目标');
  });

  it('"开头加一行" 不再被渲染成全文替换：行级 LCS 只输出一个 + 行', () => {
    // 模拟用户场景：原文有 5 行，AI 在最前面加了一行 "// header"。
    const before = 'line a\nline b\nline c\nline d\nline e\n';
    const after = `// header\n${before}`;
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'edit',
      kind: 'edit',
      status: 'completed',
      rawInput: JSON.stringify({ path: 'src/foo.ts', oldString: before, newString: after }),
      rawOutput: 'Successfully applied 1 edit to src/foo.ts',
    });

    const diffSection = descriptor.sections.find((section) => section.label === 'Diff');
    expect(diffSection).toBeDefined();
    const diff = diffSection!.content;

    // 只新增了一行 "// header"，不应把所有原文行都标 - / +。
    const minusLines = diff.split('\n').filter((line) => /^-(?!--)/.test(line));
    const plusLines = diff.split('\n').filter((line) => /^\+(?!\+\+)/.test(line));
    expect(plusLines.some((line) => line.includes('// header'))).toBe(true);
    expect(minusLines).toHaveLength(0); // 没有任何行被删除
    expect(plusLines).toHaveLength(1); // 只新增 1 行
    expect(descriptor.meta).toContain('+1');
  });

  it('文件中部修改一行：hunk 大小远小于文件总行数', () => {
    const beforeLines = Array.from({ length: 30 }, (_, i) => `row-${i + 1}`);
    const afterLines = beforeLines.slice();
    afterLines[14] = 'row-15-modified';
    const before = `${beforeLines.join('\n')}\n`;
    const after = `${afterLines.join('\n')}\n`;
    const descriptor = describeToolCallBlock({
      type: 'tool_call',
      title: 'edit',
      kind: 'edit',
      status: 'completed',
      rawInput: JSON.stringify({ path: 'docs/long.md', oldString: before, newString: after }),
    });

    const diff = descriptor.sections.find((section) => section.label === 'Diff')!.content;
    // 只改了一行，hunk 中真实的 -/+ 行各一条。
    const minus = diff.split('\n').filter((line) => /^-(?!--)/.test(line));
    const plus = diff.split('\n').filter((line) => /^\+(?!\+\+)/.test(line));
    expect(minus).toHaveLength(1);
    expect(plus).toHaveLength(1);
    // hunk 含上下文 + 改动总行数应远小于 30。
    const hunkBodyLines = diff.split('\n').filter((line) => /^[ +-]/.test(line) && !/^[+-]{3}/.test(line));
    expect(hunkBodyLines.length).toBeLessThan(30);
  });
});
