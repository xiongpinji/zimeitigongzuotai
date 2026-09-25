/**
 * 发布链路可识别错误。
 * LoginExpiredError：平台登录态失效（cookie 过期 / session 被服务端吊销），
 * 需要用户重新扫码登录。runner 据此向 Renderer 发 'login-expired' 信号，
 * 触发发布 tab 内的「重新登录 → 自动续发」流程，区别于不可恢复的普通失败。
 */
export class LoginExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginExpiredError';
  }
}
