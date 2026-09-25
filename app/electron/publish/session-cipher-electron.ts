/**
 * 生产会话加密适配器：Electron safeStorage。
 *
 * 与 acp/config.ts 的 API Key 存储不同，本适配器**没有明文降级路径**：
 * safeStorage 加密不可用时 encrypt / decrypt 一律抛
 * AccountVaultError('cipher_unavailable')，由 AccountVault fail closed。
 * 会话内容（Cookie / Token / storageState）绝不以明文落盘。
 *
 * 只能在 Electron main 进程使用；测试通过 vi.mock('electron') 注入假
 * safeStorage，或用假 SessionCipher 直接构造 AccountVault（见
 * tests/publish/accounts-v2.test.ts）。假加密器严禁用于生产。
 */
import { safeStorage } from 'electron';
import { AccountVaultError, type SessionCipher } from './accounts-v2';

export function createSafeStorageCipher(): SessionCipher {
  const requireAvailable = (operation: 'encrypt' | 'decrypt'): void => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new AccountVaultError(
        'cipher_unavailable',
        `Electron safeStorage encryption unavailable; refusing to ${operation} session data (fail closed, no plaintext fallback)`,
      );
    }
  };

  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plaintext: Buffer): Buffer => {
      requireAvailable('encrypt');
      return safeStorage.encryptString(plaintext.toString('utf-8'));
    },
    decrypt: (ciphertext: Buffer): Buffer => {
      requireAvailable('decrypt');
      return Buffer.from(safeStorage.decryptString(ciphertext), 'utf-8');
    },
  };
}
