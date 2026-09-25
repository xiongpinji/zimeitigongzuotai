/**
 * P1-3 第一段：抖音 / 快手普通发布的保守队列适配层（离线边界，**未接线**）。
 *
 * 职责：
 * - 把 P1-2 `DurablePublishQueue` 的安全任务投影（`PublishAttemptInput`）翻译成现有
 *   平台模块调用：先经账号仓预检，再在 `AccountVault.withDecryptedStorageState()`
 *   的短时明文作用域内做登录探针与上传；
 * - 返回 `PublishAttemptOutcome`，供未来队列接线使用。
 *
 * 保守语义（本段核心）：
 * - 现有 `PlatformModule.uploadVideo()` 返回 `void`，没有远端作品 ID，也没有任何
 *   远端最终状态核验：只要上传方法已被调用，无论成功返回、抛错还是调用中被取消，
 *   一律返回 `kind:'unknown'`，绝不宣称 `submitted` / `published`，
 *   也绝不设置 `confirmedNotSubmitted`（远端是否受理无法证明）。
 * - 只有在上传方法**尚未被调用**前的失败（平台 / 账号 / 会话 / 视频引用 / 探针 /
 *   调用前取消）才允许带 `confirmedNotSubmitted: true`，供队列安全判断。
 * - 真实上传方法没有 AbortSignal 参数：信号取消不会中止上传，也不在调用后提前
 *   释放会话资源；本模块等待上传返回或抛错，由账号仓 `finally` 统一清理短时明文。
 * - 短时会话清理失败若发生在上传调用之后，同样只能返回 `unknown`。
 *
 * 安全边界：
 * - 只返回稳定安全错误码（`QUEUE_PLATFORM_ADAPTER_ERROR_CODES`，[a-z0-9_.-]）；
 *   不返回 / 不记录明文 storageState 路径、Cookie、临时目录或原始异常文本；
 * - 视频路径只通过注入的 `resolveVideoRef` 解析（本模块不自行拼接 / 探测任意路径）；
 * - 不读写 Cookie 文件、不新建浏览器、不发网络请求、不落盘任何会话或限制数据。
 *
 * 平台范围：仅 `douyin` / `kuaishou`。视频号（`tencent`）/ 小红书等其他平台任务
 * 显式返回 `adapter_unsupported_platform`，绝不做隐式映射。
 *
 * 未接线原因：主库 P1-2 运行时仍有「租约超时释放账号锁但上传 Promise 未停止」
 * 的缺陷，且四平台真实登录 / 提交 / 远端 ID / 最终状态均未验收；本模块只提供
 * 可离线测试的适配边界，不得接入真实自动发布，也不得被 runner / IPC 引用。
 */
import type { AccountVault } from './accounts-v2';
import type {
  PublishAttemptInput,
  PublishAttemptOutcome,
  PublishExecutor,
} from './durable-queue';
import type { PlatformModule, UploadVideoOptions } from './types';

/** 本适配层支持的平台（普通发布）。 */
export const QUEUE_PLATFORM_ADAPTER_PLATFORMS = ['douyin', 'kuaishou'] as const;

export type QueuePlatformAdapterPlatform = (typeof QUEUE_PLATFORM_ADAPTER_PLATFORMS)[number];

/** 稳定安全错误码枚举；全部匹配队列审计的 [a-z0-9_.-]{1,64} 规则。 */
export const QUEUE_PLATFORM_ADAPTER_ERROR_CODES = [
  'adapter_unsupported_platform',
  'adapter_platform_module_missing',
  'adapter_account_not_found',
  'adapter_account_unreadable',
  'adapter_account_platform_mismatch',
  'adapter_session_missing',
  'adapter_session_expired',
  'adapter_session_unreadable',
  'adapter_vault_cipher_unavailable',
  'adapter_video_preflight_failed',
  'adapter_aborted_before_upload',
  'adapter_session_probe_failed',
  'adapter_session_probe_error',
  'adapter_session_release_failed',
  'adapter_upload_failed_unconfirmed',
  'adapter_upload_aborted_unconfirmed',
  'adapter_upload_unverified',
  'adapter_internal_error',
] as const;

export type QueuePlatformAdapterErrorCode = (typeof QUEUE_PLATFORM_ADAPTER_ERROR_CODES)[number];

/**
 * 账号仓投影：生产注入真实 `AccountVault`；测试可注入等价假实现。
 * 只使用元数据读取与短时解密两个入口，适配层不接触密文 / registry 细节。
 */
export type QueuePlatformAdapterVault = Pick<
  AccountVault,
  'getAccount' | 'withDecryptedStorageState'
>;

export interface QueuePlatformAdapterVideoContext {
  accountId: string;
  platform: QueuePlatformAdapterPlatform;
  videoVariantId: string;
}

export interface QueuePlatformAdapterDeps {
  vault: QueuePlatformAdapterVault;
  /** 只注入业务需要的平台模块；缺失的平台任务返回 `adapter_platform_module_missing`。 */
  platformModules: Partial<Record<QueuePlatformAdapterPlatform, PlatformModule>>;
  /**
   * 视频引用解析器：由接线方负责把安全引用解析为可读本地路径（含越界 / 可读性预检）；
   * 抛错或返回空串一律在上传前阻止。适配层不自行拼接或探测任意路径。
   */
  resolveVideoRef: (
    videoRef: string,
    context: QueuePlatformAdapterVideoContext,
  ) => string | Promise<string>;
  /** 上传是否无头；默认 true。登录探针的无头策略由平台模块自身决定。 */
  headless?: boolean;
}

const SAFE_CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

/** 只读取安全的机器错误码；绝不读取 / 转发 err.message。 */
function readSafeErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && SAFE_CODE_PATTERN.test(code) ? code : null;
}

function abortedBeforeUpload(): PublishAttemptOutcome {
  return {
    kind: 'failed',
    errorCode: 'adapter_aborted_before_upload',
    retryable: true,
    confirmedNotSubmitted: true,
  };
}

/**
 * 创建队列 `PublishExecutor`：
 * `(input: PublishAttemptInput) => Promise<PublishAttemptOutcome>`。
 * 不使用任何全局 / 单例状态；同一工厂实例可安全串行或并发调用（并发由队列预算约束）。
 */
export function createQueuePlatformExecutor(deps: QueuePlatformAdapterDeps): PublishExecutor {
  if (
    !deps ||
    typeof deps.vault?.getAccount !== 'function' ||
    typeof deps.vault.withDecryptedStorageState !== 'function'
  ) {
    throw new TypeError('queue platform adapter requires a session vault (getAccount/withDecryptedStorageState)');
  }
  if (typeof deps.resolveVideoRef !== 'function') {
    throw new TypeError('queue platform adapter requires resolveVideoRef injection');
  }
  const modules: Partial<Record<QueuePlatformAdapterPlatform, PlatformModule>> = {};
  for (const platform of QUEUE_PLATFORM_ADAPTER_PLATFORMS) {
    const candidate = deps.platformModules?.[platform];
    if (candidate === undefined) continue;
    if (candidate.platform !== platform) {
      throw new TypeError(`queue platform adapter platform module mismatch for ${platform}`);
    }
    modules[platform] = candidate;
  }
  const headless = deps.headless ?? true;
  if (typeof headless !== 'boolean') {
    throw new TypeError('queue platform adapter headless must be a boolean');
  }

  return async function executeQueuePlatformAttempt(
    input: PublishAttemptInput,
  ): Promise<PublishAttemptOutcome> {
    // 1) 平台白名单：视频号 / 小红书等一律显式拒绝，不触碰账号仓。
    const requested = input.platform;
    if (requested !== 'douyin' && requested !== 'kuaishou') {
      return {
        kind: 'needs_user_action',
        errorCode: 'adapter_unsupported_platform',
        confirmedNotSubmitted: true,
      };
    }
    const platform: QueuePlatformAdapterPlatform = requested;
    const module = modules[platform];
    if (!module) {
      return {
        kind: 'needs_user_action',
        errorCode: 'adapter_platform_module_missing',
        confirmedNotSubmitted: true,
      };
    }
    if (input.signal.aborted) return abortedBeforeUpload();

    // 2) 账号预检：内部 UUID 定位、平台一致、会话可用。
    let account;
    try {
      account = deps.vault.getAccount(input.accountId);
    } catch (err) {
      return {
        kind: 'needs_user_action',
        errorCode:
          readSafeErrorCode(err) === 'account_not_found'
            ? 'adapter_account_not_found'
            : 'adapter_account_unreadable',
        confirmedNotSubmitted: true,
      };
    }
    if (account.platform !== platform) {
      return {
        kind: 'needs_user_action',
        errorCode: 'adapter_account_platform_mismatch',
        confirmedNotSubmitted: true,
      };
    }
    if (account.sessionRef === null) {
      return { kind: 'needs_login', errorCode: 'adapter_session_missing', confirmedNotSubmitted: true };
    }
    if (account.status === 'expired') {
      return { kind: 'needs_login', errorCode: 'adapter_session_expired', confirmedNotSubmitted: true };
    }

    // 3) 视频引用预检：解析失败 / 空路径在上传前阻止。
    let filePath: string;
    try {
      filePath = await deps.resolveVideoRef(input.videoRef, {
        accountId: input.accountId,
        platform,
        videoVariantId: input.videoVariantId,
      });
    } catch {
      return {
        kind: 'needs_user_action',
        errorCode: 'adapter_video_preflight_failed',
        confirmedNotSubmitted: true,
      };
    }
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      return {
        kind: 'needs_user_action',
        errorCode: 'adapter_video_preflight_failed',
        confirmedNotSubmitted: true,
      };
    }
    if (input.signal.aborted) return abortedBeforeUpload();

    // 4) 短时解密作用域内：登录探针 → 上传。uploadInvoked 一旦置位，
    //    任何后续异常都不允许声称远端未收到提交。
    let uploadInvoked = false;
    let sessionCompleted = false;

    const runInsideSession = async (plaintextPath: string): Promise<PublishAttemptOutcome> => {
      if (input.signal.aborted) return abortedBeforeUpload();

      let probeOk: boolean;
      try {
        probeOk = await module.checkCookie(plaintextPath);
      } catch {
        return {
          kind: 'failed',
          errorCode: 'adapter_session_probe_error',
          retryable: true,
          confirmedNotSubmitted: true,
        };
      }
      if (!probeOk) {
        return {
          kind: 'needs_login',
          errorCode: 'adapter_session_probe_failed',
          confirmedNotSubmitted: true,
        };
      }
      if (input.signal.aborted) return abortedBeforeUpload();

      const uploadOptions: UploadVideoOptions = {
        storageStatePath: plaintextPath,
        filePath,
        title: input.metadata.title,
        desc: input.metadata.description,
        tags: [...input.metadata.tags],
        scheduleAt: input.metadata.scheduleAt ?? undefined,
        headless,
      };
      uploadInvoked = true;
      try {
        await module.uploadVideo(uploadOptions);
      } catch {
        // 调用已开始，异常无法证明远端未受理。
        return { kind: 'unknown', errorCode: 'adapter_upload_failed_unconfirmed' };
      }
      if (input.signal.aborted) {
        // 上传已完整返回但期间收到取消：不中止、不重试，等待远端核对。
        return { kind: 'unknown', errorCode: 'adapter_upload_aborted_unconfirmed' };
      }
      // uploadVideo 仅返回 void：没有远端作品 ID / 最终核验，绝不能宣称已发布。
      return { kind: 'unknown', errorCode: 'adapter_upload_unverified' };
    };

    try {
      return await deps.vault.withDecryptedStorageState(input.accountId, async (plaintextPath) => {
        const outcome = await runInsideSession(plaintextPath);
        sessionCompleted = true;
        return outcome;
      });
    } catch (err) {
      if (uploadInvoked) {
        // 上传可能已被远端受理；短时清理失败不能降级为 failed / 已确认未提交。
        return { kind: 'unknown', errorCode: 'adapter_session_release_failed' };
      }
      if (sessionCompleted) {
        // 回调已给出确定的「未上传」结果，但明文清理失败，需要人工介入。
        return {
          kind: 'needs_user_action',
          errorCode: 'adapter_session_release_failed',
          confirmedNotSubmitted: true,
        };
      }
      if (readSafeErrorCode(err) === 'cipher_unavailable') {
        return {
          kind: 'needs_user_action',
          errorCode: 'adapter_vault_cipher_unavailable',
          confirmedNotSubmitted: true,
        };
      }
      if (readSafeErrorCode(err) !== null) {
        return {
          kind: 'needs_login',
          errorCode: 'adapter_session_unreadable',
          confirmedNotSubmitted: true,
        };
      }
      return { kind: 'unknown', errorCode: 'adapter_internal_error' };
    }
  };
}