// Rebuild a synthetic, locally ignored HotClip fixture. Never touches user media.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');

const root = path.resolve(__dirname, '..', '..');
const subdir = process.argv[2];
if (subdir !== undefined && !/^[a-z0-9-]{1,40}$/.test(subdir)) {
  throw new Error('optional fixture subdirectory must be a short lowercase slug');
}
const output = path.join(root, 'data', 'media', 'synthetic', subdir ?? '');
const video = path.join(output, 'highlight-trial-120s.mp4');
const srt = path.join(output, 'highlight-trial-120s.srt');
const labels = path.join(output, 'highlight-trial-120s.labels.json');
const lines = [
  '欢迎来到这场模拟直播。今天演示一套批量剪辑流程。',
  '先看普通环节：我们整理了输入素材，确认每段都得到许可。',
  '现在开始挑战：一段录屏里要找到真正值得单独讲述的时刻。',
  '意外发生了！旧流程把同一条视频重复发给两个账号，观众没有得到新的信息。',
  '我们改成按不同问题重写叙事：第一版解释原因，第二版展示修复，第三版比较结果。',
  '这里是普通等待环节，画面没有关键变化，先不要把它误判成高光。',
  '直播间有人问：只换封面和背景音乐，平台会不会认为这是不同作品？',
  '答案是不应该依赖换皮。我们要让每版有独立的信息价值和可追溯的素材来源。',
  '关键结果来了：人工复核三版叙事，否决了仅仅改顺序的那版，保留了两个实质不同的版本。',
  '接下来是普通结束语，感谢观看。',
  '测试提醒：模型候选只是建议，必须有人核对时间边界和版权。',
  '最后检查输出文件和证据链，不在本次测试里发布任何平台。',
];
const timestamp = (seconds) => `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')},000`;

fs.mkdirSync(output, { recursive: true });
if (fs.lstatSync(output).isSymbolicLink()) throw new Error('fixture directory cannot be a symlink');
if (!fs.existsSync(ffmpeg)) throw new Error('ffmpeg-static is unavailable');
if (!fs.existsSync(video)) {
  const temp = path.join(output, `highlight-trial-120s-${process.pid}.tmp.mp4`);
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=16000',
    '-t', '120', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', temp,
  ], { timeout: 180_000, maxBuffer: 16 * 1024, windowsHide: true });
  if (result.status !== 0) {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    throw new Error(`synthetic FFmpeg generation failed (exit ${result.status ?? 'none'})`);
  }
  fs.renameSync(temp, video);
}
if (!fs.existsSync(srt)) {
  const content = lines.map((line, index) => `${index + 1}\n${timestamp(index * 10)} --> ${timestamp((index + 1) * 10)}\n${line}\n`).join('\n');
  fs.writeFileSync(srt, content, { encoding: 'utf8', flag: 'wx' });
}
if (!fs.existsSync(labels)) {
  fs.writeFileSync(labels, JSON.stringify({
    kind: 'synthetic_prelabel_v1', source: path.basename(video),
    expectedHigh: [{ startSec: 30, endSec: 50 }, { startSec: 60, endSec: 90 }],
    expectedLow: [{ startSec: 50, endSec: 60 }, { startSec: 90, endSec: 100 }],
    warning: 'Synthetic visuals and audio do not match scripted subtitle meaning; runtime protocol only.',
  }, null, 2), { encoding: 'utf8', flag: 'wx' });
}
process.stdout.write(JSON.stringify({ video, srt, labels, ignoredFixture: true }) + '\n');
