/**
 * 适配层产物：从抖音作品对象提取出的原始视频源候选。
 *
 * 这是「未判定水印、未排序」的中间结构。无水印证据分级与排序由 resolver/source-ranker
 * 消费这些候选完成，避免在提取阶段过早做业务判断。
 */
export type SourceField = 'play_addr' | 'download_addr' | 'bit_rate' | 'image';

export interface RawVideoSource {
  url: string;
  /** 该候选来自作品对象的哪个字段，语义用于后续无水印判断。 */
  sourceField: SourceField;
  width?: number;
  height?: number;
  bitrate?: number;
  /** 容器格式，如 mp4。 */
  format?: string;
  /** 编码标记：bit_rate gear 的 is_bytevc1（1 表示 H.265/bytevc1）。 */
  isBytevc1?: boolean;
  dataSize?: number;
  gearName?: string;
  /** 来自图文/动态作品的 images[]（静态图或实况短视频），每一项是独立资产，不应被清晰度折叠合并。 */
  fromImageSet?: boolean;
}
