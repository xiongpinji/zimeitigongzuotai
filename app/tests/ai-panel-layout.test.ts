import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('AI 面板布局约束', () => {
  it('侧栏与 AI 面板链路允许子元素在窄宽度下收缩，避免卡片内容撑破容器', () => {
    const editorCss = read('src/pages/Editor.module.css');
    const aiPanelCss = read('src/components/AIPanel.module.css');

    expect(editorCss).toMatch(/\.sidebarShell\s*\{[\s\S]*?min-width:\s*0;/);
    expect(editorCss).toMatch(/\.panelBody\s*\{[\s\S]*?min-width:\s*0;/);
    expect(aiPanelCss).toMatch(/\.root\s*\{[\s\S]*?min-width:\s*0;/);
    expect(aiPanelCss).toMatch(/\.body\s*\{[\s\S]*?min-width:\s*0;/);
  });

  it('AI tabs 外壳需要接住纵向高度链，保证动画面板内容可以滚动', () => {
    const aiPanelCss = read('src/components/AIPanel.module.css');

    expect(aiPanelCss).toMatch(/\.tabsShell\s*\{[\s\S]*?display:\s*flex;/);
    expect(aiPanelCss).toMatch(/\.tabsShell\s*\{[\s\S]*?flex:\s*1;/);
    expect(aiPanelCss).toMatch(/\.tabsShell\s*\{[\s\S]*?flex-direction:\s*column;/);
    expect(aiPanelCss).toMatch(/\.tabsShell\s*\{[\s\S]*?min-height:\s*0;/);
    expect(aiPanelCss).toMatch(/\.tabContent\s*\{[\s\S]*?min-height:\s*0;/);
  });
});
