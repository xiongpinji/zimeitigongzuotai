import { describe, expect, it, vi } from 'vitest';
import { createApplicationMenuTemplate } from '../electron/app-menu';

describe('createApplicationMenuTemplate', () => {
  function createTemplate(options: {
    activePage: 'welcome' | 'setup' | 'editor' | 'script-workbench' | 'settings';
    isDevelopment: boolean;
    debugMode: boolean;
    hasProject: boolean;
    recentProjects: Array<{ path: string; name: string }>;
  }) {
    const handlers = {
      onToggleDebugMode: vi.fn(),
      onOpenLogDirectory: vi.fn(),
      onExportLogs: vi.fn(),
    };
    const createMenu = createApplicationMenuTemplate as unknown as (
      sendMenuAction: ReturnType<typeof vi.fn>,
      menuContext: typeof options,
      handlers: typeof handlers,
    ) => ReturnType<typeof createApplicationMenuTemplate>;

    return {
      template: createMenu(vi.fn(), options, handlers),
      handlers,
    };
  }

  it('provides native clipboard actions and hides development menu in production', () => {
    const { template } = createTemplate({
      activePage: 'welcome',
      isDevelopment: false,
      debugMode: false,
      hasProject: false,
      recentProjects: [],
    });
    const editMenu = template.find((item) => item.label === '编辑');
    const devMenu = template.find((item) => item.label === '开发');
    const mediaMenu = template.find((item) => item.label === '媒体');

    expect(editMenu).toBeDefined();
    expect(editMenu?.submenu).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'undo' }),
        expect.objectContaining({ role: 'redo' }),
        expect.objectContaining({ role: 'cut' }),
        expect.objectContaining({ role: 'copy' }),
        expect.objectContaining({ role: 'paste' }),
        expect.objectContaining({ role: 'selectAll' }),
      ]),
    );
    expect(devMenu).toBeUndefined();
    expect(mediaMenu).toBeUndefined();
  });

  it('shows media menu, global settings, and recent projects when context requires them', () => {
    const sendMenuAction = vi.fn();
    const createMenu = createApplicationMenuTemplate as unknown as (
      sendMenuAction: typeof sendMenuAction,
      menuContext: {
        activePage: 'welcome' | 'setup' | 'editor' | 'script-workbench' | 'settings';
        isDevelopment: boolean;
        hasProject: boolean;
        recentProjects: Array<{ path: string; name: string }>;
      },
    ) => ReturnType<typeof createApplicationMenuTemplate>;
    const template = createMenu(sendMenuAction, {
      activePage: 'editor',
      isDevelopment: true,
      debugMode: false,
      hasProject: true,
      recentProjects: [{ path: '/tmp/demo-project', name: 'demo-project' }],
    });
    const projectMenu = template.find((item) => item.label === '项目');
    const mediaMenu = template.find((item) => item.label === '媒体');
    const devMenu = template.find((item) => item.label === '开发');
    const submenu = Array.isArray(projectMenu?.submenu) ? projectMenu.submenu : [];
    const settingsItem = submenu.find((item) => 'label' in item && item.label === '全局设置');
    const recentMenu = submenu.find((item) => 'label' in item && item.label === '最近项目');

    expect(mediaMenu).toBeDefined();
    expect(devMenu).toBeDefined();
    expect(settingsItem).toBeDefined();
    expect(recentMenu).toBeDefined();
    expect(Array.isArray(recentMenu?.submenu) ? recentMenu.submenu : []).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'demo-project' })]),
    );
  });

  it('uses Cmd+W to close the project when a project is open, otherwise falls back to native close', () => {
    const { template: templateWithProject } = createTemplate({
      activePage: 'editor',
      isDevelopment: false,
      debugMode: false,
      hasProject: true,
      recentProjects: [],
    });
    const { template: templateWithoutProject } = createTemplate({
      activePage: 'welcome',
      isDevelopment: false,
      debugMode: false,
      hasProject: false,
      recentProjects: [],
    });

    const withProjectMenu = templateWithProject.find((item) => item.label === '项目');
    const withoutProjectMenu = templateWithoutProject.find((item) => item.label === '项目');
    const withProjectSubmenu = Array.isArray(withProjectMenu?.submenu) ? withProjectMenu.submenu : [];
    const withoutProjectSubmenu = Array.isArray(withoutProjectMenu?.submenu)
      ? withoutProjectMenu.submenu
      : [];

    const closeProjectItem = withProjectSubmenu.find(
      (item) => 'label' in item && item.label === '关闭项目',
    );
    const closeWindowItem = withoutProjectSubmenu.find(
      (item) => 'label' in item && item.label === '关闭窗口',
    );

    expect(closeProjectItem).toMatchObject({
      label: '关闭项目',
      accelerator: 'CmdOrCtrl+W',
      enabled: true,
    });
    expect(closeWindowItem).toMatchObject({
      label: '关闭窗口',
      role: 'close',
      accelerator: 'CmdOrCtrl+W',
    });
  });

  it('项目菜单底部提供退出应用入口并绑定 CmdOrCtrl+Q', () => {
    const { template } = createTemplate({
      activePage: 'welcome',
      isDevelopment: false,
      debugMode: false,
      hasProject: false,
      recentProjects: [],
    });

    const projectMenu = template.find((item) => item.label === '项目');
    const submenu = Array.isArray(projectMenu?.submenu) ? projectMenu.submenu : [];
    const quitItem = submenu.find(
      (item) => 'label' in item && item.label === '退出应用',
    );

    expect(quitItem).toMatchObject({
      label: '退出应用',
      accelerator: 'CmdOrCtrl+Q',
      role: 'quit',
    });
  });

  it('在帮助菜单中提供调试与日志能力入口', () => {
    const { template } = createTemplate({
      activePage: 'welcome',
      isDevelopment: false,
      debugMode: true,
      hasProject: false,
      recentProjects: [],
    });

    const helpMenu = template.find((item) => item.label === '帮助');
    const submenu = Array.isArray(helpMenu?.submenu) ? helpMenu.submenu : [];
    const debugItem = submenu.find(
      (item) => 'label' in item && item.label === '启用调试模式（重启生效）',
    );
    const openLogsItem = submenu.find(
      (item) => 'label' in item && item.label === '打开日志目录',
    );
    const exportLogsItem = submenu.find(
      (item) => 'label' in item && item.label === '导出日志 ZIP',
    );

    expect(helpMenu).toBeDefined();
    expect(debugItem).toMatchObject({
      label: '启用调试模式（重启生效）',
      type: 'checkbox',
      checked: true,
    });
    expect(openLogsItem).toBeDefined();
    expect(exportLogsItem).toBeDefined();
  });

  it('一键成稿运行中时禁用破坏性菜单项', () => {
    const sendMenuAction = vi.fn();
    const createMenu = createApplicationMenuTemplate as unknown as (
      sendMenuAction: typeof sendMenuAction,
      menuContext: {
        activePage: 'welcome' | 'setup' | 'editor' | 'script-workbench' | 'settings';
        isDevelopment: boolean;
        debugMode: boolean;
        hasProject: boolean;
        recentProjects: Array<{ path: string; name: string }>;
        isAutoRunning: boolean;
      },
    ) => ReturnType<typeof createApplicationMenuTemplate>;
    const template = createMenu(sendMenuAction, {
      activePage: 'editor',
      isDevelopment: false,
      debugMode: false,
      hasProject: true,
      recentProjects: [{ path: '/tmp/demo-project', name: 'demo-project' }],
      isAutoRunning: true,
    });

    const projectMenu = template.find((item) => item.label === '项目');
    const mediaMenu = template.find((item) => item.label === '媒体');
    const projectSubmenu = Array.isArray(projectMenu?.submenu) ? projectMenu.submenu : [];
    const mediaSubmenu = Array.isArray(mediaMenu?.submenu) ? mediaMenu.submenu : [];

    const newProjectItem = projectSubmenu.find(
      (item) => 'label' in item && item.label === '新建项目',
    );
    const recentMenu = projectSubmenu.find(
      (item) => 'label' in item && item.label === '最近项目',
    );
    const recentSubmenu = Array.isArray(recentMenu?.submenu) ? recentMenu.submenu : [];
    const recentEntry = recentSubmenu.find(
      (item) => 'label' in item && item.label === 'demo-project',
    );
    const exportItem = mediaSubmenu.find(
      (item) => 'label' in item && item.label === '导出 MP4',
    );

    expect(newProjectItem).toMatchObject({ label: '新建项目', enabled: false });
    expect(recentMenu).toMatchObject({ label: '最近项目', enabled: false });
    expect(recentEntry).toMatchObject({ label: 'demo-project', enabled: false });
    expect(exportItem).toMatchObject({ label: '导出 MP4', enabled: false });
  });

  it('帮助菜单点击时走主进程处理器', () => {
    const { template, handlers } = createTemplate({
      activePage: 'welcome',
      isDevelopment: false,
      debugMode: false,
      hasProject: false,
      recentProjects: [],
    });

    const helpMenu = template.find((item) => item.label === '帮助');
    const submenu = Array.isArray(helpMenu?.submenu) ? helpMenu.submenu : [];
    const debugItem = submenu.find(
      (item) => 'label' in item && item.label === '启用调试模式（重启生效）',
    );
    const openLogsItem = submenu.find(
      (item) => 'label' in item && item.label === '打开日志目录',
    );
    const exportLogsItem = submenu.find(
      (item) => 'label' in item && item.label === '导出日志 ZIP',
    );

    if (!debugItem || !('click' in debugItem) || !debugItem.click) {
      throw new Error('debug item click handler is missing');
    }
    if (!openLogsItem || !('click' in openLogsItem) || !openLogsItem.click) {
      throw new Error('open logs item click handler is missing');
    }
    if (!exportLogsItem || !('click' in exportLogsItem) || !exportLogsItem.click) {
      throw new Error('export logs item click handler is missing');
    }

    debugItem.click(undefined as never, undefined as never, undefined as never);
    openLogsItem.click(undefined as never, undefined as never, undefined as never);
    exportLogsItem.click(undefined as never, undefined as never, undefined as never);

    expect(handlers.onToggleDebugMode).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenLogDirectory).toHaveBeenCalledTimes(1);
    expect(handlers.onExportLogs).toHaveBeenCalledTimes(1);
  });
});
