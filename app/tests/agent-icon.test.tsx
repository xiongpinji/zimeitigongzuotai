import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentIcon } from '../src/components/agent/AgentIcon';

describe('AgentIcon', () => {
  it('pi — 渲染不崩，含 aria-label "Pi"', () => {
    const html = renderToStaticMarkup(<AgentIcon agentId="pi" />);
    expect(html).toContain('aria-label="Pi"');
    expect(html).toContain('title="Pi"');
  });

  it('pi 与默认回退渲染不同 HTML', () => {
    const piHtml = renderToStaticMarkup(<AgentIcon agentId="pi" />);
    const defaultHtml = renderToStaticMarkup(<AgentIcon agentId="unknown-agent-xyz" />);
    expect(piHtml).not.toBe(defaultHtml);
  });

  it('pi-acp 后缀 — 识别为 Pi', () => {
    const html = renderToStaticMarkup(<AgentIcon agentId="pi-acp" />);
    expect(html).toContain('aria-label="Pi"');
  });

  it('未知 id — 回退默认，不崩，aria-label 为 "Agent"', () => {
    const html = renderToStaticMarkup(<AgentIcon agentId="unknown-agent-xyz" />);
    expect(html).toContain('aria-label="Agent"');
    expect(html).toContain('title="Agent"');
  });

  it('空字符串 id — 回退默认，不崩', () => {
    expect(() => renderToStaticMarkup(<AgentIcon agentId="" />)).not.toThrow();
    const html = renderToStaticMarkup(<AgentIcon agentId="" />);
    expect(html).toContain('aria-label="Agent"');
  });

  it('undefined / null id — 回退默认，不崩（修复对话面板黑屏）', () => {
    expect(() => renderToStaticMarkup(<AgentIcon agentId={undefined} />)).not.toThrow();
    expect(() => renderToStaticMarkup(<AgentIcon agentId={null} />)).not.toThrow();
    expect(renderToStaticMarkup(<AgentIcon agentId={undefined} />)).toContain('aria-label="Agent"');
  });

  it('size prop 影响渲染宽高', () => {
    const html24 = renderToStaticMarkup(<AgentIcon agentId="pi" size={24} />);
    const html16 = renderToStaticMarkup(<AgentIcon agentId="pi" size={16} />);
    expect(html24).toContain('width:24px');
    expect(html16).toContain('width:16px');
  });

  it('默认 size 为 16', () => {
    const html = renderToStaticMarkup(<AgentIcon agentId="pi" />);
    expect(html).toContain('width:16px');
  });
});
