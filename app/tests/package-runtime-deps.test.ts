import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import packageJson from '../package.json';

describe('package runtime dependencies', () => {
  it('keeps Remotion runtime dependencies in dependencies for Electron packaging', () => {
    expect(packageJson.dependencies?.react).toBeTruthy();
    expect(packageJson.dependencies?.['react-dom']).toBeTruthy();
    expect(packageJson.dependencies?.chokidar).toBeTruthy();
    expect(packageJson.dependencies?.remotion).toBeTruthy();
    expect(packageJson.dependencies?.['@remotion/player']).toBeTruthy();
    expect(packageJson.dependencies?.['@remotion/bundler']).toBeTruthy();
    expect(packageJson.dependencies?.['@remotion/renderer']).toBeTruthy();
    expect(packageJson.dependencies?.esbuild).toBeTruthy();
    expect(packageJson.dependencies?.['@ffmpeg-installer/ffmpeg']).toBeTruthy();
    expect(packageJson.dependencies?.['ffmpeg-static']).toBeTruthy();
    expect(packageJson.dependencies?.['@ffprobe-installer/ffprobe']).toBeTruthy();
    // HyperFrames 已移除
    expect(packageJson.dependencies?.hyperframes).toBeUndefined();
    expect(packageJson.dependencies?.['@hyperframes/player']).toBeUndefined();
  });

  it('keeps China-friendly binary mirrors in project npm config', () => {
    const npmrc = fs.readFileSync(path.resolve(__dirname, '../.npmrc'), 'utf8');

    expect(npmrc).toContain('registry=https://registry.npmmirror.com/');
    expect(npmrc).toContain('electron_mirror=https://npmmirror.com/mirrors/electron/');
    expect(npmrc).toContain('disturl=https://npmmirror.com/mirrors/node/');
    expect(npmrc).toContain('sharp_binary_host=https://npmmirror.com/mirrors/sharp/');
  });
});
