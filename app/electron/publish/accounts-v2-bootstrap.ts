/**
 * A2-S2：account-v2 生产桥组合根（可注入；纯 Node，不导入 electron）。
 *
 * 边界声明：
 * - 本模块只做三件事：按 `<userData>/publish-v2` 构造真实 `AccountVault`、
 *   把调用方注入的 SessionCipher 交给 vault、把 vault + 四平台白名单工厂注册到
 *   调用方注入的 ipcMain 兼容接口。加密适配器（生产 `createSafeStorageCipher`）
 *   与平台解析（生产 `getPlatform`）由 main 进程显式注入，本模块不提供任何
 *   默认实现，也不导入 electron / 平台模块——单元测试可直接注入假 cipher、
 *   假平台、假 ipc 与假 userData 路径。
 * - 新仓目录固定 `publish-v2`，与旧 `<userData>/publish` 完全分离；本模块不读
 *   不写旧仓、不调用 migrateFromLegacy、不识别旧账号 ID。
 * - 四平台工厂只接受 `douyin/kuaishou/tencent/xiaohongshu`（AccountVaultPlatform
 *   白名单）；`bilibili` 与别名在解析平台模块之前返回 undefined（IPC 层固定
 *   unsupported_platform），不引入 B 站。
 * - 不注入 `sendEvent`：二维码事件只回发给发起 invoke 的 sender（S1 语义），
 *   绝不广播给所有窗口。
 * - 注入接口与返回值只在主进程内使用：不向 Renderer 暴露任何文件系统路径或
 *   SessionCipher；bootstrap 持有的 vault 不回传、不跨 IPC。
 * - 注册失败（IPC 通道重复 / 仓库目录不可写等）不吞错、不降级：异常直接抛给
 *   调用方显式处理；绝不回退到旧 publish 明文账号仓。
 */
import { join } from 'node:path';
import { AccountVault, type AccountVaultPlatform, type SessionCipher } from './accounts-v2';
import {
  registerAccountsV2Ipc,
  type AccountIpcMainLike,
  type AccountPlatformFactory,
  type AccountPlatformLike,
} from './accounts-v2-ipc';

/** 新安全账号仓目录名（`<userData>/publish-v2`）。 */
export const ACCOUNT_V2_DATA_DIR_NAME = 'publish-v2';

/** 旧发布仓目录名；仅用于声明隔离，本模块绝不读写该目录。 */
export const ACCOUNT_V2_LEGACY_DATA_DIR_NAME = 'publish';

/** S2 四平台白名单（与 A1 vault 的 ACCOUNT_VAULT_PLATFORMS 一致，不含 B 站）。 */
export const ACCOUNT_V2_PLATFORM_WHITELIST: readonly AccountVaultPlatform[] = [
  'douyin',
  'kuaishou',
  'tencent',
  'xiaohongshu',
];

/** 平台模块解析器：生产传 `getPlatform`；测试传假实现。 */
export type AccountsV2PlatformResolver = (
  platform: AccountVaultPlatform,
) => AccountPlatformLike | undefined;

/**
 * 构造四平台工厂：白名单之外的平台（含 bilibili / 别名）一律返回 undefined，
 * 解析器抛错也视为平台不可用；白名单内的平台解析失败返回 undefined，由 IPC
 * 层统一回固定 unsupported_platform。
 */
export function createAccountsV2PlatformFactory(
  resolve: AccountsV2PlatformResolver,
): AccountPlatformFactory {
  return (platform) => {
    if (!(ACCOUNT_V2_PLATFORM_WHITELIST as readonly string[]).includes(platform)) {
      return undefined;
    }
    try {
      return resolve(platform) ?? undefined;
    } catch {
      return undefined;
    }
  };
}

export interface AccountsV2BootstrapOptions {
  /** 生产传 `app.getPath('userData')`；测试传临时目录。 */
  userDataPath: string;
  /** 生产传 electron `ipcMain`；测试传假 IPC。 */
  ipc: AccountIpcMainLike;
  /** 生产传 `createSafeStorageCipher`；测试传假加密器（假加密器严禁生产）。 */
  createCipher: () => SessionCipher;
  /** 生产传 `getPlatform`；测试传假平台解析器。 */
  resolvePlatform: AccountsV2PlatformResolver;
}

/**
 * 组装并注册 account-v2 生产桥。期望在 `app.whenReady()` 之后、首次
 * `createWindow()` 之前调用一次；重复注册由 Electron `ipcMain.handle` 显式
 * 抛错（调用方必须显式处理，不得静默降级）。
 */
export function bootstrapAccountsV2(options: AccountsV2BootstrapOptions): void {
  const root = join(options.userDataPath, ACCOUNT_V2_DATA_DIR_NAME);
  const vault = new AccountVault(root, options.createCipher());
  registerAccountsV2Ipc({
    ipc: options.ipc,
    vault,
    platformFactory: createAccountsV2PlatformFactory(options.resolvePlatform),
  });
}