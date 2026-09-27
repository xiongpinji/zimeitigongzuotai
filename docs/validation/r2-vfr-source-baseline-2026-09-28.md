# R2 可变帧率隔离素材基线（2026-09-28）

在用户“先测试、不打包”的阶段，给[双轨桌面源码冒烟脚本](../../app/scripts/smoke-editor-multitrack-win.cjs)新增可选 `LINGJI_R2_SOURCE_KIND=vfr`。其余 UI 操作保持原样：新建工程、导入两个合成 MP4、分割及撤销/重做、加入第二画轨、保存重开、预览、H.264/AAC 导出与完整解码。默认仍为原先的 15 fps CFR。测试不读取真实录屏、登录账号或发布。

VFR 主素材由 30 fps `testsrc2` 合成：前 1.5 秒丢弃交替帧并保留原时间戳，后 1.5 秒保留全部帧；FFprobe 对最终 MP4 读到 **33 ms 和 67 ms 两种帧间隔**，并非只把 CFR 文件改名。第二轨是 30 fps 纯蓝视频。运行命令：

```powershell
$env:LINGJI_R2_SOURCE_FPS = '30'
$env:LINGJI_R2_SOURCE_KIND = 'vfr'
node app/scripts/smoke-editor-multitrack-win.cjs
node app/scripts/probe-r2-renderstill-win.cjs data/runtime/validation/r2-multitrack-1790543623149
node app/scripts/check-editor-preview-export-parity-win.cjs data/runtime/validation/r2-multitrack-1790543623149
```

| 验证 | 结果 |
| --- | --- |
| 桌面双轨冒烟 | 退出 0；3 个视频片段、2 条画轨，保存重开及 MP4 完整解码通过，页面异常 0。 |
| VFR 时间戳 | FFprobe 帧间隔 `[33, 67]` ms。 |
| 独立 `renderStill` 对导出帧 | 第 42、43、90、返回 42 帧 SSIM 分别为 `0.984226`、`0.984172`、`0.999999`、`0.984226`；全部达到 0.92 门槛，退出 0。 |
| 当前产品原生预览对导出帧 | 第 42、43、90 帧 SSIM 分别为 `0.884657`、`0.884810`、`0.996497`；前两帧低于门槛，严格脚本按设计退出 1。 |
| CFR 默认回归 | 不设置新环境变量，原 15 fps 双轨完整桌面冒烟重跑退出 0；FFprobe 帧间隔仅 `[67]` ms。 |

当前 UI 仍不满足逐帧一致性；独立静帧探针通过只验证修复路径的可行性。VFR 用例覆盖一种从 15 fps 切换到 30 fps 的合成时间戳序列，不能代表所有手机直播录屏、时间基异常或真实素材。修复接入 UI 后还需对同一工程重跑严格截图门槛。

证据保存在 Git 忽略的 `data/runtime/validation/`：VFR 工程 `r2-multitrack-1790543623149/`，CFR 回归工程 `r2-multitrack-1790543720735/`。日志 SHA-256：`r2-vfr-smoke-2026-09-28.log` 为 `D871E77655717780D3B9C02718854614BA68062E27ECA7B3AB6D2805B390F9C2`；`r2-vfr-renderstill-probe.log` 为 `986198D0891E8BBBF2DB6A9E81062501908C28E5C5652A41EB88DE5ECD1C2622`；`r2-vfr-native-parity.log` 为 `D73C8E6CC413D9BBC0AA7DF4861CA0A45567B75A68638617B7CB73FBDEB964A8`；`r2-cfr-smoke-after-vfr-extension.log` 为 `CA8ED46C1D052F0A972D245FC881D07E8AA9FA67838619A57294F395C29B6459`。
