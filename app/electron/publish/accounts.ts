import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PublishAccount, PublishPlatform, PublishSettings } from './types';
import { buildAccountId } from './account-id';

const DEFAULT_SETTINGS: PublishSettings = { headlessLogin: true };

interface RegistryEntry {
  platform: PublishPlatform;
  accountName: string;
  status: PublishAccount['status'];
  lastCheckedAt?: number;
}

export class AccountStore {
  private readonly accountsDir: string;
  private readonly registryPath: string;
  private readonly settingsPath: string;

  constructor(private readonly root: string) {
    this.accountsDir = join(root, 'accounts');
    this.registryPath = join(root, 'registry.json');
    this.settingsPath = join(root, 'settings.json');
    mkdirSync(this.accountsDir, { recursive: true });
  }

  getSettings(): PublishSettings {
    if (!existsSync(this.settingsPath)) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(readFileSync(this.settingsPath, 'utf-8')) as Partial<PublishSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  setSettings(patch: Partial<PublishSettings>): PublishSettings {
    const next = { ...this.getSettings(), ...patch };
    writeFileSync(this.settingsPath, JSON.stringify(next, null, 2), 'utf-8');
    return next;
  }

  storageStatePath(platform: PublishPlatform, accountName: string): string {
    return join(this.accountsDir, `${buildAccountId(platform, accountName)}.json`);
  }

  private readRegistry(): RegistryEntry[] {
    if (!existsSync(this.registryPath)) return [];
    try {
      return JSON.parse(readFileSync(this.registryPath, 'utf-8')) as RegistryEntry[];
    } catch {
      return [];
    }
  }

  private writeRegistry(entries: RegistryEntry[]): void {
    writeFileSync(this.registryPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  private toAccount(e: RegistryEntry): PublishAccount {
    return {
      id: buildAccountId(e.platform, e.accountName),
      platform: e.platform,
      accountName: e.accountName,
      storageStatePath: this.storageStatePath(e.platform, e.accountName),
      status: e.status,
      lastCheckedAt: e.lastCheckedAt,
    };
  }

  list(): PublishAccount[] {
    return this.readRegistry().map((e) => this.toAccount(e));
  }

  upsert(entry: RegistryEntry): PublishAccount {
    const entries = this.readRegistry();
    const id = buildAccountId(entry.platform, entry.accountName);
    const idx = entries.findIndex((e) => buildAccountId(e.platform, e.accountName) === id);
    const merged: RegistryEntry = idx >= 0 ? { ...entries[idx], ...entry } : entry;
    if (idx >= 0) entries[idx] = merged;
    else entries.push(merged);
    this.writeRegistry(entries);
    return this.toAccount(merged);
  }

  setStatus(id: string, status: PublishAccount['status'], lastCheckedAt?: number): void {
    const entries = this.readRegistry();
    const idx = entries.findIndex((e) => buildAccountId(e.platform, e.accountName) === id);
    if (idx >= 0) {
      entries[idx].status = status;
      if (lastCheckedAt != null) entries[idx].lastCheckedAt = lastCheckedAt;
      this.writeRegistry(entries);
    }
  }

  remove(id: string): void {
    const entries = this.readRegistry();
    const target = entries.find((e) => buildAccountId(e.platform, e.accountName) === id);
    this.writeRegistry(entries.filter((e) => buildAccountId(e.platform, e.accountName) !== id));
    if (target) {
      const sp = this.storageStatePath(target.platform, target.accountName);
      if (existsSync(sp)) rmSync(sp);
    }
  }

  importCookie(platform: PublishPlatform, accountName: string, sourcePath: string): PublishAccount {
    const dest = this.storageStatePath(platform, accountName);
    copyFileSync(sourcePath, dest);
    return this.upsert({ platform, accountName, status: 'unknown' });
  }
}
