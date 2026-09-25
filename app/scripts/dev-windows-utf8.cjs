const { spawn } = require('node:child_process');
const path = require('node:path');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} was terminated by ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function main() {
  if (process.platform === 'win32') {
    process.env.PYTHONIOENCODING = process.env.PYTHONIOENCODING || 'utf-8';
    process.env.LANG = process.env.LANG || 'zh_CN.UTF-8';
    process.env.LC_ALL = process.env.LC_ALL || 'zh_CN.UTF-8';
    await run('chcp.com', ['65001']);
    await run('cmd.exe', ['/d', '/s', '/c', 'node_modules\\.bin\\electron-vite.cmd dev --watch'], {
      env: {
        ...process.env,
        FORCE_COLOR: process.env.FORCE_COLOR || '1',
      },
    });
    return;
  }

  await run(path.join('node_modules', '.bin', 'electron-vite'), ['dev', '--watch'], {
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR || '1',
    },
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
