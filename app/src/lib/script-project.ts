import type { WorkbenchStage } from './script-workbench-stage';
import type { WorkspaceFilesState } from '../store/script';

export function createBlankScriptProjectState(projectDir: string): {
  projectDir: string;
  originalText: string;
  scriptText: string;
  selectedTemplate: 'news-broadcast';
  annotations: [];
  workspaceFiles: WorkspaceFilesState;
  reviewState: 'idle';
  scriptDocVersion: 0;
  manualStageOverride: WorkbenchStage | null;
} {
  return {
    projectDir,
    originalText: '',
    scriptText: '',
    selectedTemplate: 'news-broadcast',
    annotations: [],
    workspaceFiles: {
      hasOriginalFile: false,
      hasScriptFile: false,
    },
    reviewState: 'idle',
    scriptDocVersion: 0,
    manualStageOverride: null,
  };
}
