# P0-1 Windows 固定源码基线验证

验证环境：Windows PowerShell，Node `v24.17.0`，npm `11.13.0`。工作目录为 `app/`；上游固定提交与导入清单见 [来源记录](../third-party/lingji-cut.md)。所有命令均未登录平台、发布作品或调用付费模型。

| 命令 | 结果 | 耗时 | 产物或故障 |
| --- | --- | ---: | --- |
| `npm ci` | 退出码 0 | 179.4 秒 | 安装 1,127 个包；`node_modules/` 被忽略，不入库。 |
| `npm test` | 退出码 1 | 110.2 秒 | 348 个测试文件中 322 通过、26 失败；2,142 个已收集测试中 2,113 通过、29 失败。详情如下。 |
| `npm test`（补齐 Electron 后复测） | 退出码 1 | 51.0 秒 | 353 个测试文件中 340 通过、13 失败；2,191 个已收集测试中 2,163 通过、28 失败。14 个 Electron 缺失的收集错误消失，余下的失败仍需修复。 |
| `npm run build` | 退出码 0 | 76.3 秒 | `dist/`、`dist-electron/main.js`、`dist-electron/preload.js` 已生成，均为忽略的本地构建产物。 |
| `npm run dist:win` | 进程退出码 0，但产物验收失败 | 240.6 秒 | Vite、CLI 和 Remotion 阶段走完，`@electron/packager` 打印 `Packaging app for platform win32 x64 using electron v41.1.0` 后进程结束；`release/` 根本没有生成，便携目录及 NSIS 安装包均不存在。 |
| `npm run package:win`（环境排查复跑） | 进程退出码 0，但产物验收失败 | 139.9 秒 | 手动补齐 Electron 后复现同一现象：只有 `Packaging app...`，仍无 `release/`。 |
| Electron 欢迎页烟测（隔离 `APPDATA`/`LOCALAPPDATA`） | 启动与页面加载成功 | 约 27 秒 | Playwright 启动本地 `electron.exe` 与 `dist/index.html`，窗口标题为“灵机剪影”，欢迎页显示“开始创作”“本地视频”等入口；截图保存在仓库外 `C:\Users\canqu\Documents\Codex\2026-09-24\new-chat\work\p0-1-smoke-data\desktop-smoke.png`。 |
| 新建测试工程并打开编辑台 | 部分通过 | — | 在隔离数据目录创建“本地烟测工程”，`original.md` 与 `project.json` 已落盘；写稿工作台和视频编辑器均能打开，时间线与“导出”入口可见。编辑器顶部持续显示“保存失败”；渲染进程日志定位到 `save-project-section` 执行 `project.json.tmp-* → project.json` 重命名时抛出 Windows `EPERM`。尚未证明编辑持久保存、媒体导入或真实导出；截图在同一仓库外目录的 `project-workbench.png`、`editor-tab.png`。 |
| Windows 保存重试修复后的定向测试与编辑器复测 | 通过 | — | `npm exec vitest run tests/project-file.test.ts tests/project-persistence.test.ts` 为 20/20 通过；重新执行 `npm run build` 成功。沿用隔离工程重新打开视频编辑器，顶部显示“已保存”，控制台无错误；截图更新到仓库外同目录的 `editor-tab.png`。测试覆盖首次 `EPERM` 后成功及持续 `EPERM` 时原文件保全与临时文件清理。尚未执行真实素材编辑及导出。 |

首次完整测试中，14 个测试文件在收集阶段报 `Electron failed to install correctly, please delete node_modules/electron and try installing again`；这反映 `npm ci` 后本地 Electron 二进制尚不可用。另有 Windows 路径分隔符与 Unix 绝对路径断言不兼容（例如 `tests/publish/accounts.test.ts`、`tests/publish/chromium-install.test.ts`、`tests/package-mac-prune.test.ts`），`tests/sonar-token.test.ts` 对 Unix `0600` 权限作了 Windows 不成立的断言，数个 React 组件测试超过 5 秒默认超时且 `tests/agent-settings-active.test.tsx` 还有独立断言失败。上述问题均保留在固定源码快照中，未修改业务代码、锁文件或测试以粉饰基线。

`node scripts/ensure-electron-binary.cjs` 打印缺失和下载提示后约 1 秒以 0 退出，实际上没有生成 `node_modules/electron/path.txt` 或 `dist/electron.exe`。手动校验本机缓存 ZIP 的 SHA-256 `BBB798D1817BC173A187C1DE30432247E48046F737FA13ADE126FE3788303B81` 与安装包 `checksums.json` 一致，再从该缓存 ZIP 解压到被忽略的 `node_modules/electron/dist/`，手动写入 `path.txt`；此举只修复本地验证环境，不修改上游源码。即使完成这一步，打包器仍以 0 退出且无发行产物，因此发行验收失败，需单独定位退出机制。打包器的退出码不能取代实际产物检查。

当前自动化基线**未通过**。Windows 安装包与便携版均未生成；欢迎页启动、测试工程创建、编辑器重新打开后的保存状态及保存路径定向回归已通过，但完整测试集仍有失败，时间线实际修改持久性、Remotion/FFmpeg 导出及真实平台账号验证尚未完成，不能以源码导入或构建成功代替验收。复测完整日志保存在仓库外 `C:\Users\canqu\Documents\Codex\2026-09-24\new-chat\work\p0-1-npm-test-after-electron.log`，不会随仓库推送。
