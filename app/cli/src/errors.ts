// cli/src/errors.ts
/** CLI 内部错误：带错误码与进程退出码 */
export class CliError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
