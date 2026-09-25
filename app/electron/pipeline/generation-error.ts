/** Headless 生成相关错误：带稳定错误码 */
export class GenerationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}
