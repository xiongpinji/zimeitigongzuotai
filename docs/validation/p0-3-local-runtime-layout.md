# 项目内本地媒体运行区（2026-09-26）

根据项目内统一放置的约定，本机准备了以下目录，均位于仓库根目录的 `data/` 下，并被根 `.gitignore` 的 `data/` 规则忽略：

| 相对路径 | 本机用途 | 当前产品接线 |
| --- | --- | --- |
| `data/tools/hotclip/` | HotClip 0.32.0 源码与本机依赖，供可选侧车试验 | 尚未由桌面端配置或启动 |
| `data/media/synthetic/` | 自制 6 秒测试 MP4 与配套 SRT | 仅用于本地 CLI 技术验证 |
| `data/highlight-artifacts/` | 预留高光任务产物目录 | 尚未接入产品配置 |
| `data/runtime/` | 预留本机运行配置目录 | 尚未接入产品配置 |

HotClip 源自 `https://github.com/xixihhhh/hotclip` 的固定提交 `62aef3919fdd7d8a974f80a9b721e0177eb408c2`。本地复制了 `docs/`、`skills/`、`src/`、`tools/` 和必要根文件，不复制 `.git` 与原安装的 `node_modules`；四个源码子目录共 359 个文件与参考副本逐文件 SHA-256 一致，`package.json` 和 `LICENSE` 等根文件也核对一致。本地在该目录执行 `pnpm install --frozen-lockfile` 成功；第一次 `--offline` 因缓存缺少 `es-module-lexer@2.3.0` tarball 失败，随后联网安装成功。此安装未配置或调用付费模型。

合成测试素材的 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `data/media/synthetic/synthetic-livestream.mp4` | `297BAD64BCEA2927801B8D303F5B0D6C6098D37A9CA77FC0AB72A847C5BE7750` |
| `data/media/synthetic/synthetic-livestream.srt` | `61A01A59C2278C76983362E8B932FA5A5243AE31F9205262779F45BAFBAB338A` |

在 Windows 从仓库根目录执行以下命令可复核当前本机 CLI 通路：

```powershell
$repoRoot = (Resolve-Path .).Path
pnpm.cmd --dir (Join-Path $repoRoot 'data/tools/hotclip') cli transcribe `
  (Join-Path $repoRoot 'data/media/synthetic/synthetic-livestream.mp4') `
  --subtitles (Join-Path $repoRoot 'data/media/synthetic/synthetic-livestream.srt') --json
```

本机执行退出码 0，返回 `engine: subtitle-srt`、时长 6 秒、2 个句段；字词时间标明 `estimated`。这证明项目内副本可执行字幕导入，不证明 ASR、高光识别、自动裁切、真实录屏质量或桌面端集成。没有运行 `highlights` 或 `clip`，因为高光识别仍需明确配置本地或云端模型及代表样本。

HotClip 的 `package.json` 声明 `AGPL-3.0-only`。`data/tools/hotclip/` 是本机 Git 忽略区，不进入主库提交；现有桌面安装器也不包含它。未来打包须先完成许可、源码提供方式、依赖与协议边界审查，不能因为放在项目目录就自动将该目录纳入安装包。真实授权直播录屏、高光质量盲审、资源占用和分发验收仍是独立门槛；本次合成测试不替代它们。
