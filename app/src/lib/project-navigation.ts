import type { AppPage } from './electron-api';
import type { ProjectData } from './project-persistence';

/**
 * 项目入口统一落到写稿工作台，避免根据工程内容在欢迎页/编辑器间分叉。
 */
export function resolveProjectLandingPage(_projectData?: ProjectData | null): AppPage {
  return 'script-workbench';
}
