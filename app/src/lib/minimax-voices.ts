// src/lib/minimax-voices.ts
export interface MinimaxVoiceDef {
  voiceId: string;
  name: string;
  description: string;
  gender: 'male' | 'female' | 'neutral';
  category: '主播' | '旁白' | '角色' | '其他';
}

/**
 * MiniMax 系统音色列表（硬编码，P0 覆盖常用场景）。
 * 后续若需动态获取，可扩展 VoicePreset.voiceSource = 'cloned'。
 */
export const MINIMAX_SYSTEM_VOICES: MinimaxVoiceDef[] = [
  { voiceId: 'male-qn-qingse',    name: '青涩青年男声', description: '自然清爽,适合日常播客',     gender: 'male',   category: '主播' },
  { voiceId: 'male-qn-jingying',  name: '精英青年男声', description: '沉稳有力,适合商业财经',     gender: 'male',   category: '主播' },
  { voiceId: 'male-qn-badao',     name: '霸道青年男声', description: '低沉浑厚,适合剧情解说',     gender: 'male',   category: '角色' },
  { voiceId: 'female-shaonv',     name: '少女音',       description: '清亮甜美,适合轻松话题',     gender: 'female', category: '主播' },
  { voiceId: 'female-yujie',      name: '御姐音',       description: '成熟知性,适合深度访谈',     gender: 'female', category: '主播' },
  { voiceId: 'female-chengshu',   name: '成熟女声',     description: '温婉稳重,适合文化节目',     gender: 'female', category: '旁白' },
  { voiceId: 'female-tianmei',    name: '甜美女声',     description: '亲和力强,适合生活类内容',   gender: 'female', category: '主播' },
  { voiceId: 'presenter_male',    name: '男性主持人',   description: '标准播音风格',             gender: 'male',   category: '旁白' },
  { voiceId: 'presenter_female',  name: '女性主持人',   description: '标准播音风格',             gender: 'female', category: '旁白' },
];

export function findMinimaxVoice(voiceId: string): MinimaxVoiceDef | undefined {
  return MINIMAX_SYSTEM_VOICES.find((v) => v.voiceId === voiceId);
}

export const DEFAULT_VOICE_PARAMS = {
  speed: 1.0,
  vol: 1.0,
  pitch: 0,
  emotion: 'neutral',
} as const;

export const MINIMAX_EMOTIONS = [
  { value: 'neutral',   label: '自然' },
  { value: 'happy',     label: '愉悦' },
  { value: 'sad',       label: '低落' },
  { value: 'angry',     label: '激昂' },
  { value: 'fearful',   label: '紧张' },
  { value: 'disgusted', label: '不屑' },
  { value: 'surprised', label: '惊讶' },
] as const;
