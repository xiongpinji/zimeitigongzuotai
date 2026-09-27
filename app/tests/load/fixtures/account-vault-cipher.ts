import type { SessionCipher } from '../../../electron/publish/accounts-v2';

// Test-only reversible encoding. Never use this cipher or these sessions in production.
export class SyntheticCipher implements SessionCipher {
  isAvailable(): boolean {
    return true;
  }

  encrypt(plaintext: Buffer): Buffer {
    return Buffer.from('synthetic-only:' + plaintext.toString('base64'), 'utf8');
  }

  decrypt(ciphertext: Buffer): Buffer {
    const text = ciphertext.toString('utf8');
    if (!text.startsWith('synthetic-only:')) throw new Error('unexpected synthetic payload');
    return Buffer.from(text.slice('synthetic-only:'.length), 'base64');
  }
}

export function syntheticSessionValue(index: number): string {
  return 'synthetic-session-' + String(index).padStart(3, '0');
}

export function syntheticStorageState(index: number): string {
  return JSON.stringify({
    cookies: [{
      name: 'sessionid',
      value: syntheticSessionValue(index),
      domain: '.example.test',
    }],
    origins: [],
  });
}
