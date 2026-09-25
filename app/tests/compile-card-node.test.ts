import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePackagedEsbuildRuntime } from '../electron/remotion/compile-card-node';

describe('resolvePackagedEsbuildRuntime', () => {
  it('points packaged macOS esbuild to app.asar.unpacked', () => {
    const resourcesPath = path.join('/App.app', 'Contents', 'Resources');
    const nodeModulesDir = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules');
    const binaryPath = path.join(
      nodeModulesDir,
      '@esbuild',
      'darwin-arm64',
      'bin',
      'esbuild',
    );

    const runtime = resolvePackagedEsbuildRuntime({
      resourcesPath,
      platform: 'darwin',
      arch: 'arm64',
      existsSync: (candidate) => candidate === nodeModulesDir || candidate === binaryPath,
    });

    expect(runtime).toEqual({
      nodeModulesDir,
      esbuildPackageDir: path.join(nodeModulesDir, 'esbuild'),
      binaryPath,
    });
  });

  it('does not use packaged resolution when app.asar.unpacked node_modules is absent', () => {
    expect(
      resolvePackagedEsbuildRuntime({
        resourcesPath: path.join('/App.app', 'Contents', 'Resources'),
        existsSync: () => false,
      }),
    ).toBeNull();
  });
});
