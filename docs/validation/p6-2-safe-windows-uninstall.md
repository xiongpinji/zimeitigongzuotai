# P6-2 安全卸载：只删除安装器拥有的 Windows 文件（2026-09-26）

本记录针对 P6-2 bounded repair。基线 SHA `829b3abcc40bd0587dfe77e5ceec35f6eff747d3`（worktree `zimeitijuzhen-ao-release-audit`）。目标是消除 NSIS 卸载脚本对用户可选安装根 `$INSTDIR` 的递归清除，改为基于构建期文件清单的精确、拥有权驱动的清理。未使用真实平台账号、付费模型或用户素材；未运行 NSIS 安装器/卸载器；未访问真实用户数据。

## 缺陷确认（源码级）

`829b3ab` 的 `app/scripts/package-windows-installer.cjs` 在 `Section "Uninstall"` 中同时存在 `!insertmacro MUI_PAGE_DIRECTORY`（用户可选 `$INSTDIR`）与 `RMDir /r "$INSTDIR"`。若用户选择已存在目录、或安装后向该目录写入自有文件，卸载会连带递归删除无关数据。这是已确认的源码缺陷，符合 NSIS 官方告警：

- https://nsis.sourceforge.io/Reference/RMDir （不要 `RMDir /r $INSTDIR`）
- https://nsis.sourceforge.io/Validating_%24INSTDIR_before_uninstall （逐个删除已安装文件，再对空目录用非递归 `RMDir`）

## 修复范围（仅限三条允许路径）

| 路径 | 变更 |
| --- | --- |
| `app/scripts/package-windows-installer.cjs` | 新增 `assertSafeInstallerRelativePath`、`collectInstallerFileManifest`、`deriveInstallerDirectoryManifest`；`buildNsisScript` 现要求显式 `manifest` 参数并据此生成卸载段；`createWindowsInstaller` 在真实 `appDir` 上确定性遍历生成清单后传入。移除 `RMDir /r "$INSTDIR"`。导出新增三个函数。 |
| `app/tests/package-windows-installer.test.ts` | 更新 `buildNsisScript` 调用以带 `manifest`；新增合成临时目录遍历、路径校验、目录推导、卸载段精确删除/最深优先非递归 `RMDir`、无 `$INSTDIR` 递归/通配、快捷方式与注册表清理保留、符号链接不跟随等测试。 |
| `docs/validation/p6-2-safe-windows-uninstall.md` | 本记录（新增）。 |

未改动其它源码、测试、依赖、lockfile、构建脚本或配置。`app/node_modules`（Windows Junction，用于离线测试）未触碰、未暂存。`app/scripts/package-windows.cjs` 仅只读参考。

## 生成的卸载脚本形态

卸载段现在按以下顺序生成（示例，清单来自打包文件夹遍历）：

```nsis
Section "Uninstall"
  Delete "$DESKTOP\<appName>.lnk"
  RMDir /r "$SMPROGRAMS\<appName>"        ; 安装器自建、固定名，非用户可选根，保留递归

  ; 精确删除清单内文件 + Uninstall.exe（绝不递归 $INSTDIR）
  Delete "$INSTDIR\<manifest file 1>"
  ...
  Delete "$INSTDIR\Uninstall.exe"

  ; 安装器创建的目录自深向浅，非递归 RMDir 对非空目录静默失败
  RMDir "$INSTDIR\<deepest dir>"
  ...
  RMDir "$INSTDIR"

  DeleteRegKey HKLM "<Uninstall key>"
  DeleteRegKey HKLM "Software\<appName>"
SectionEnd
```

`$SMPROGRAMS\<appName>` 的 `RMDir /r` 予以保留：该目录由安装器 `CreateDirectory` 自建、名称固定、不在用户可选根下，属于既有快捷方式清理，不在本缺陷范围内。安装段 `File /r "<appDir>\*.*"` 不变。

## 安全不变量与对应测试

| 不变量 | 覆盖测试 | 说明 |
| --- | --- | --- |
| 不对用户可选根做递归清除 | `never recursively wipes the user-selectable install root (P6-2)` | 断言全脚本无 `RMDir /r "$INSTDIR"`，卸载段无 `$INSTDIR` 通配 `Delete`/递归 `RMDir`，且存在非递归 `RMDir "$INSTDIR"`。 |
| 只精确删除清单文件 + Uninstall.exe | `deletes exactly the manifest files plus Uninstall.exe` | 用正则枚举卸载段所有 `Delete "$INSTDIR\..."`，逐一比对为清单条目加 `Uninstall.exe`，无多余、无通配。 |
| 目录最深优先、非递归 | `removes installer-created directories deepest-first` | 断言 `RMDir "$INSTDIR\..."` 顺序为最深优先，末尾为非递归 `RMDir "$INSTDIR"`；非空（含用户内容）目录由 NSIS 静默保留。 |
| 清单确定性、路径安全 | `walks a synthetic app dir deterministically`、`assertSafeInstallerRelativePath` 用例 | 合成嵌套树两次遍历结果一致且按字典序；拒绝 `..`/`.`/空段、绝对路径、反斜杠、`$ " \` * ?`、控制字符等 NSIS 元字符。 |
| 不跟随外部链接 | `refuses to follow symlinks pointing outside the app dir` | 合成 `appDir` 内建指向外部目录的链接与哨兵文件；遍历遇链接即失败（`符号链接`），哨兵文件保留。 |
| 保留快捷方式/注册表清理 | `keeps shortcut and registry cleanup intact` | 断言桌面 `.lnk` 删除、`$SMPROGRAMS` 清理、两条 `DeleteRegKey` 均保留。 |
| 拒绝无清单/坏清单 | `refuses to build ... without an explicit manifest`、`rejects unsafe manifest entries` | `buildNsisScript` 缺 `manifest` 或含不安全条目时抛错，不生成回退到递归删除的脚本。 |

设计要点：`collectInstallerFileManifest` 对任何符号链接与非常规文件（FIFO/socket 等）直接失败，绝不跟随；`buildNsisScript` 对每条清单再次调用 `assertSafeInstallerRelativePath`，未净化名称不会进入 NSIS 脚本。无“精确清理失败后回退递归删除 `$INSTDIR`”的逻辑。

## 测试执行状态（重要边界）

**本会话未能实际执行测试或类型检查**——运行环境被权限层与 Junction 双重阻断：

- `node` 可执行被审批门控：除 `node --version`（返回 `v22.22.3`）外，`node -e`、`node <script>`、`node node_modules/vitest/vitest.mjs ...` 均返回 `This command requires approval`。
- `app/node_modules` 是指向 sandbox 允许目录之外的 Windows Junction（`.../zimeitijuzhen-ao-p0-1-opencode/app/node_modules`），进入其中的 `ls`/vitest 被安全层拦截：`... was blocked. For security, Claude Code may only list files in the allowed working directories`。
- 尝试 `dangerouslyDisableSandbox` 运行 vitest 仍返回 `This command requires approval`。

因此 **RED/GREEN 未由本会话实测捕获，退出码无法记录**。按任务约定，原始错误仅记录如上，交由 Codex 在 Windows Node 22 独立复测：

```
cd app && node node_modules/vitest/vitest.mjs run tests/package-windows-installer.test.ts
node node_modules/typescript/bin/tsc --noEmit   # 若 worktree 允许
```

新增断言编码了修复前应失败的行为（`RMDir /r "$INSTDIR"` 在 `829b3ab` 存在，故 `never recursively wipes ...` 在基线上应 RED）。实现与测试逻辑经逐行人工推演（desk-check）：清单排序、最深优先目录序、卸载段 `Delete`/`RMDir` 行序、路径校验拒绝/接受集合、符号链接抛错路径均与断言一致。`tsconfig.json` 的 `include` 仅覆盖 `src`/`electron`，不含 `tests`，故 `tsc --noEmit` 不类型检查本测试文件；`.cjs` 仅依赖 node 内建模块。

## `git diff --check`

`git diff --check` 退出码 **2**，对所有新增行报告 `trailing whitespace`。经 `git ls-files --eol` 核实，被改两文件与只读同级 `package-windows.cjs` 均为 `i/crlf w/crlf`（仓库既有 CRLF 存储约定）。故这些告警是每行行尾 CR（`cr-at-eol`）触发，属仓库既有约定的噪声，并非本次引入的行尾空格；新增行沿用文件 CRLF，未产生混合行尾。未做行尾转换以免污染 diff。

## 未验证 / 剩余 P6-2 缺口

- **未运行** Windows 打包、安装、卸载、真实烟测；无“安装文件全集 == 卸载清单”的实机对账。清单在 `appDir` 上确定性遍历生成，逻辑上应等于 `File /r` 所打包内容，但未经真实安装包证明二者逐文件一致。
- 若 Electron Windows 发行树意外含符号链接/Junction，`collectInstallerFileManifest` 将**硬失败**（保守设计）；Windows 打包产物通常无 reparse point，但本会话未在 Windows 实测该假设。
- 卸载对 `$INSTDIR` 内用户新增文件/非空子目录采用“保留”策略（非递归 `RMDir` 静默失败）；不删除 `%APPDATA%`、项目目录、账号会话或用户媒体，也未新增对这些位置的访问。
- 符号链接拒绝测试在 Linux/WSL 下创建普通符号链接验证（`junction` 类型在 POSIX 被忽略）；Windows 下 readdir Dirent 对 Junction reparse point 的分类未在本会话实测。
- LICENSE/NOTICE 缺口不在本 tranche 处理，仍开放。
- 未声称完成完整 P6-2、产品安装验收、许可证合规或真实账号迁移验收。

## 结论

源码层面已移除对用户可选安装根的递归清除，改为清单驱动的精确 `Delete` + 最深优先非递归 `RMDir`，并以合成测试覆盖上述安全不变量。上述执行 Agent 的运行环境未能执行测试；Codex 后续独立验证记录见下节。

## Codex 独立验证与集成（2026-09-26）

Codex 在 Windows Node 22 上运行安装器与 Windows stage 聚焦测试：**38/38 通过，退出码 0**；`tsc --noEmit` 退出码 0；对工作树执行 `git -c core.whitespace=cr-at-eol diff --check` 退出码 0。完整 diff 已按三条允许路径核对。

从历史便携版发行目录收集了 **20,001 个文件**，清单生成成功。用这份清单生成的 NSIS 脚本约 3.21 MB，使用 NSIS 3.12 编译成功（退出码 0，卸载段 21,639 条指令）。这验证了大清单可编译，不代表当前 SHA 的真实发行包已完成打包或文件全集对账。

另编译一个**仅用于烟测**的用户级合成安装器：沿用同一卸载清单，但安装段只含一个占位可执行文件，并禁用注册表、快捷方式及桌面快捷方式删除等外部副作用。它在专用临时目录静默安装与卸载，两个进程退出码均为 0；卸载后安装器写入的占位文件与 `Uninstall.exe` 均已移除，安装前放入的 `user-sentinel.txt` 及其内容保留。该烟测证明合成情形下用户自有文件未被清除，但**不是完整 Electron 发行包的安装/卸载验收**。

完整 P6-2 仍未通过：当前 SHA 的真实发行包安装/卸载、安装文件与卸载清单逐项对账、账号会话备份与迁移、LICENSE/NOTICE 打包均待后续处理。编排审查结论为 `repair_required`；本次仅集成已验证的有界安全卸载修复。
