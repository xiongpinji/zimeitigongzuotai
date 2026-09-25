import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TTSConfigTab } from '../src/components/settings/TTSConfigTab';

// TTSConfigTab 使用 loadAISettings/saveAISettings（异步），在 SSR 时初始值来自 useState 默认值
vi.mock('../src/store/ai', () => ({
  loadAISettings: () => Promise.resolve(null),
  saveAISettings: vi.fn(),
}));

describe('TTSConfigTab', () => {
  it('renders the multi-provider / voice-clone TTS configuration UI', () => {
    const html = renderToStaticMarkup(<TTSConfigTab />);

    // 页面标题
    expect(html).toContain('TTS 语音合成配置');

    // 多 Provider 区块：Provider 列表与默认 Provider 选择器
    expect(html).toContain('TTS Providers');
    expect(html).toContain('默认 TTS Provider');

    // 音色库区块：音色列表与默认音色选择器
    expect(html).toContain('音色库');
    expect(html).toContain('默认音色');

    // 空状态文案（初始 SSR 无 Provider / 音色）
    expect(html).toContain('暂无 TTS Provider');
    expect(html).toContain('暂无音色');

    // MiMo 智能语气打标开关
    expect(html).toContain('MiMo 智能语气打标');

    // 保存按钮
    expect(html).toContain('保存 TTS 配置');
  });
});
