# 当前主库 Windows 发行产物核验（2026-09-26）

本记录绑定主库 `737a920cbaf550cfff030f9ec3528bb37363d73e`，只说明本机 Windows x64 的构建产物与安装器编译结果。它不替代 [安全卸载合成烟测](p6-2-safe-windows-uninstall.md)，也不代表真实安装、卸载或 P6-2 验收。

## 构建与产物

使用 Windows Node `v22.23.3` 运行 `npm run dist:win`。Electron、CLI、Remotion 与便携目录打包阶段完成，便携目录为忽略的本地 `app/release/灵机剪影-win32-x64/`。该整条命令在安装器阶段因 `makensis` 未加入 PATH 退出 **1**；完整 `dist:win` 因而**不能记录为通过**。随后指定本机已有的 NSIS 3.12 `MAKENSIS` 路径，对**同一便携目录**单独运行 `createWindowsInstaller`，退出 **0**，生成本地安装包。

| 产物 | 字节数 | 核验 |
| --- | ---: | --- |
| `app/release/灵机剪影-win32-x64/灵机剪影.exe` | 222,754,304 | 文件存在、非空 |
| `app/release/灵机剪影-win32-x64/resources/app.asar` | 456,032,028 | 文件存在、非空 |
| `app/release/灵机剪影-1.3.1-x64-setup.exe` | 268,776,973 | NSIS 3.12 编译退出 0；SHA-256 `576E34A42C4CAC859E58189B104ADF408B963DAC023A05671AE82FA720F911DB`；签名状态 `NotSigned` |

生成的 `app/.tmp/win-installer-x64/installer.nsi` 为 3,213,352 字节：安装段有 1 条 `File /r`；卸载段有 **20,002** 条针对 `$INSTDIR` 的精确 `Delete`（20,001 个清单文件加 `Uninstall.exe`），无 `RMDir /r "$INSTDIR"`，最终用非递归 `RMDir "$INSTDIR"`。NSIS 报告卸载段 21,639 条指令并以退出码 0 完成编译；构建时映射的短盘符已解除。文件数与生成脚本对应，**未通过真实安装后的逐文件对账**。

## 尚未通过的验收

- 未运行当前真实安装包的安装与卸载；未核验选定安装目录中用户自有文件在**真实包**卸载后的保留情况。此前仅有禁用注册表/快捷方式外部副作用的**合成**静默烟测，见安全卸载记录。
- 项目的 `app/LICENSE` 为 10,522 字节，SHA-256 `CF1FD672894ECF0BE677C62283127BE8AFC830443DA491E5EC0612ECE1FB79E8`；便携目录根部的 `LICENSE` 为 1,096 字节，SHA-256 `5154E165BD6C2CC0CFBCD8916498C7ABAB0497923BAFCD5CB07673FE8480087D`。二者不是同一文件。当前 stage 允许列表不包含项目 `app/LICENSE`；项目许可证及第三方 NOTICE 打包尚未验收。
- 未测试便携程序在当前 SHA 的启动、真实录屏编辑/导出、账号迁移、凭证恢复或四平台真实发布。安装包未签名，正式分发与用户安装体验未验收。

本地发行目录、安装包和构建日志均未提交 Git。完整 P6-2 及 R1–R6-P 的未满足项保持开放。
