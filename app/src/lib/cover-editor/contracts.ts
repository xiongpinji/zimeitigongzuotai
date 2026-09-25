/** 共享契约：Phase 1 所有并行子任务的对齐点。锁定后请勿随意修改。 */

/** 比例预设标识 */
export type AspectRatioPreset = '16:9' | '9:16' | '1:1' | '4:3' | '4:5' | 'free' | 'timeline';

/** 滤镜预设标识 */
export type FilterPreset = 'none' | 'bw' | 'vivid' | 'vintage' | 'cool' | 'warm';

/** 文字图层 */
export interface CoverTextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadow?: {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
  };
  align?: 'left' | 'center' | 'right';
  rotation?: number;
}

/** 封面编辑状态（持久化到 project.json） */
export interface CoverEditState {
  version: 1;
  aspectRatio?: AspectRatioPreset;
  crop?: { x: number; y: number; width: number; height: number };
  textOverlays?: CoverTextOverlay[];
  filters?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    temperature?: number;
    preset?: FilterPreset;
  };
  transform?: {
    rotate?: number;
    flipX?: boolean;
    flipY?: boolean;
  };
}

/** 保存模式 */
export type CoverSaveMode = 'append' | 'overwrite';

/** save-cover-edit IPC 参数 */
export interface SaveCoverEditArgs {
  projectDir: string;
  sourceCandidateId: string;
  sourceImageUrl: string;
  sourcePrompt: string;
  dataUrl: string;
  edits: CoverEditState;
  mode: CoverSaveMode;
}

/** save-cover-edit IPC 返回 */
export interface SaveCoverEditResult {
  candidateId: string;
  imageUrl: string;
  editedFrom?: string;
  replacedId?: string;
  createdAt: number;
}

/** 系统字体条目 */
export interface SystemFont {
  family: string;
}

/** list-system-fonts IPC 返回 */
export interface ListSystemFontsResult {
  fonts: SystemFont[];
}
