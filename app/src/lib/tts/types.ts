/** 一个句子的双轨表示：subtitle 进字幕（干净），speak 进 TTS 音频（可能带 MiMo 标签）。 */
export interface TtsUnit {
  subtitle: string;
  speak: string;
}
