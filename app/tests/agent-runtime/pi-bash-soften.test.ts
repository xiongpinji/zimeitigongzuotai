/**
 * tests/agent-runtime/pi-bash-soften.test.ts
 *
 * 覆盖 softenBashError —— 把 grep/diff/test 这类「非零退出表达否定结论」的命令
 * 从 isError=true 软化为 false，避免 UI 误报「执行失败」。
 *
 * 不软化的反例必须保留：超时、abort、未识别命令、非白名单退出码、非 bash 工具、
 * 文本里没有 "Command exited with code N" 尾巴的（说明走的是其它 isError 通道）。
 */

import { describe, it, expect } from 'vitest';
import { softenBashError } from '../../electron/agent-runtime/pi-inprocess';

function output(body: string, code: number): string {
  return `${body ? `${body}\n\n` : ''}Command exited with code ${code}`;
}

describe('softenBashError — 已知否定语义命令', () => {
  it('grep 无匹配 (exit 1) → 软化为 ok', () => {
    const text = output('', 1);
    const result = softenBashError('bash', { command: 'grep -i tencent foo.txt' }, text, true);
    expect(result).toBe(false);
  });

  it('管道末段是 grep 无匹配 (exit 1) → 软化', () => {
    const text = output('(no output)', 1);
    const cmd = 'ls ~/.social-auto-upload/cookies/ 2>/dev/null | grep -i tencent';
    const result = softenBashError('bash', { command: cmd }, text, true);
    expect(result).toBe(false);
  });

  it('rg 无匹配 (exit 1) → 软化', () => {
    const text = output('', 1);
    const result = softenBashError('bash', { command: 'rg foo bar/' }, text, true);
    expect(result).toBe(false);
  });

  it('diff 有差异 (exit 1) → 软化', () => {
    const text = output('< foo\n> bar', 1);
    const result = softenBashError('bash', { command: 'diff a.txt b.txt' }, text, true);
    expect(result).toBe(false);
  });

  it('test 断言为假 (exit 1) → 软化', () => {
    const text = output('', 1);
    const result = softenBashError('bash', { command: 'test -f /no/such' }, text, true);
    expect(result).toBe(false);
  });

  it('[ 断言为假 (exit 1) → 软化', () => {
    const text = output('', 1);
    const result = softenBashError('bash', { command: '[ -d /no/such ]' }, text, true);
    expect(result).toBe(false);
  });

  it('test 退出 2（语法错）也按断言假处理（POSIX 语义未严格区分）→ 软化', () => {
    // 设计取舍：test 命令的非零退出码统一软化；这是有意行为，避免 agent 误读。
    const text = output('', 2);
    const result = softenBashError('bash', { command: 'test -f /no/such' }, text, true);
    expect(result).toBe(false);
  });
});

describe('softenBashError — 必须保留的真实失败', () => {
  it('grep exit 2（grep 真错误，比如读权限或语法）→ 保留 error', () => {
    const text = output('grep: foo: No such file or directory', 2);
    const result = softenBashError('bash', { command: 'grep foo /missing' }, text, true);
    expect(result).toBe(true);
  });

  it('npm install exit 1 → 保留 error（不在白名单）', () => {
    const text = output('npm ERR! ...', 1);
    const result = softenBashError('bash', { command: 'npm install' }, text, true);
    expect(result).toBe(true);
  });

  it('Command timed out（无 "exited with code" 尾巴）→ 保留 error', () => {
    const text = '...partial output...\n\nCommand timed out after 30 seconds';
    const result = softenBashError('bash', { command: 'grep foo huge.log' }, text, true);
    expect(result).toBe(true);
  });

  it('Command aborted → 保留 error', () => {
    const text = '...partial...\n\nCommand aborted';
    const result = softenBashError('bash', { command: 'grep foo huge.log' }, text, true);
    expect(result).toBe(true);
  });

  it('未知命令 (exit 127) → 保留 error', () => {
    const text = output('zsh: command not found: nonexistent', 127);
    const result = softenBashError('bash', { command: 'nonexistent' }, text, true);
    expect(result).toBe(true);
  });

  it('非 bash 工具（read 等）→ 不进入软化路径，保留 error', () => {
    const text = output('', 1);
    const result = softenBashError('read', { command: 'grep x y' }, text, true);
    expect(result).toBe(true);
  });

  it('isError 本来就是 false → 直接返回 false', () => {
    const result = softenBashError('bash', { command: 'echo ok' }, 'ok', false);
    expect(result).toBe(false);
  });

  it('管道末段是 npm（非白名单）即使前面有 grep → 保留 error', () => {
    const text = output('', 1);
    const result = softenBashError('bash', { command: 'grep foo bar | npm run failing' }, text, true);
    expect(result).toBe(true);
  });
});

describe('softenBashError — 路径与可执行后缀归一', () => {
  it('/usr/bin/grep 绝对路径 → 仍识别为 grep', () => {
    const text = output('', 1);
    const result = softenBashError('bash', { command: '/usr/bin/grep foo bar.txt' }, text, true);
    expect(result).toBe(false);
  });

  it('Windows 风格 rg.exe → 识别为 rg', () => {
    const text = output('', 1);
    const result = softenBashError('bash', { command: 'C:\\\\tools\\\\rg.exe foo .' }, text, true);
    expect(result).toBe(false);
  });

  it('环境变量前缀 FOO=bar grep ... → 跳过赋值识别 grep', () => {
    const text = output('', 1);
    const result = softenBashError('bash', { command: 'LC_ALL=C grep -i x file' }, text, true);
    expect(result).toBe(false);
  });
});

describe('softenBashError — 输入容错', () => {
  it('toolName 非 string → 保留 error', () => {
    const text = output('', 1);
    const result = softenBashError(undefined, { command: 'grep x y' }, text, true);
    expect(result).toBe(true);
  });

  it('input 为字符串（直接是 command） → 仍能解析', () => {
    const text = output('', 1);
    const result = softenBashError('bash', 'grep foo bar', text, true);
    expect(result).toBe(false);
  });

  it('input 缺失 command 字段 → 保留 error（无法判断）', () => {
    const text = output('', 1);
    const result = softenBashError('bash', {}, text, true);
    expect(result).toBe(true);
  });

  it('text 非 string → 保留 error', () => {
    const result = softenBashError('bash', { command: 'grep x y' }, null, true);
    expect(result).toBe(true);
  });
});
