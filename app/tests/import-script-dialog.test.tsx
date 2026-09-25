import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeImportDialogSeed, ImportScriptDialog } from '../src/components/script/ImportScriptDialog';
import type { AutoWorkflowParams } from '../src/store/ai';

const defaults: AutoWorkflowParams = {
  templateId: 'news-broadcast',
  roleId: 'none',
  voiceId: 'female-shaonv',
};

describe('computeImportDialogSeed', () => {
  it('无 initial 入参时回退到空值/默认参数', () => {
    const seed = computeImportDialogSeed({ defaults, defaultModelBinding: null });
    expect(seed.content).toBe('');
    expect(seed.projectName).toBe('');
    expect(seed.parentDir).toBeNull();
    expect(seed.autoMode).toBe(false);
    expect(seed.autoParams.templateId).toBe('news-broadcast');
    expect(seed.modelBinding).toBeNull();
  });

  it('应用预填值并以 templateIdOverride 覆盖模板（其余参数沿用 defaults）', () => {
    const seed = computeImportDialogSeed({
      defaults,
      defaultModelBinding: { providerId: 'p1', model: 'gpt' },
      initialContent: '转录稿正文',
      initialProjectName: '博主-标题',
      initialParentDir: '/tmp/out',
      initialAutoMode: true,
      templateIdOverride: 'rewrite-remix',
    });
    expect(seed.content).toBe('转录稿正文');
    expect(seed.projectName).toBe('博主-标题');
    expect(seed.parentDir).toBe('/tmp/out');
    expect(seed.autoMode).toBe(true);
    expect(seed.autoParams.templateId).toBe('rewrite-remix');
    expect(seed.autoParams.roleId).toBe('none');
    expect(seed.autoParams.voiceId).toBe('female-shaonv');
    expect(seed.modelBinding).toEqual({ providerId: 'p1', model: 'gpt' });
  });
});

const autoModeOptions = {
  roles: [{ value: 'none', label: '不指定角色' }],
  voices: [{ value: 'female-shaonv', label: '少女音' }],
  models: [{ value: 'p1::gpt', label: 'P1 / gpt' }],
  defaults,
  defaultModelBinding: { providerId: 'p1', model: 'gpt' },
};

describe('ImportScriptDialog 预填渲染 (SSR)', () => {
  it('给定 initial 入参时，首屏预填转录稿、项目名、目录预览，且一键模式默认展开', () => {
    const html = renderToStaticMarkup(
      <ImportScriptDialog
        open
        busy={false}
        errorMessage={null}
        onOpenChange={() => undefined}
        onConfirm={() => undefined}
        autoModeOptions={autoModeOptions}
        initialContent="这是声呐转录稿"
        initialProjectName="测试博主-测试标题"
        initialParentDir="/tmp/out"
        initialAutoMode
        templateIdOverride="rewrite-remix"
      />,
    );
    expect(html).toContain('这是声呐转录稿');
    expect(html).toContain('/tmp/out/测试博主-测试标题');
    expect(html).toContain('不指定角色');
    expect(html).toContain('少女音');
  });

  it('不传 initial 入参时为干净弹窗（普通导入路径，回归保护）', () => {
    const html = renderToStaticMarkup(
      <ImportScriptDialog
        open
        busy={false}
        errorMessage={null}
        onOpenChange={() => undefined}
        onConfirm={() => undefined}
        autoModeOptions={autoModeOptions}
      />,
    );
    expect(html).toContain('导入文稿');
    expect(html).not.toContain('这是声呐转录稿');
    expect(html).not.toContain('不指定角色');
  });
});
