# R2 封面与画幅源码验收记录（2026-09-28）

本次遵守“先测试、不打包”：只运行 Windows 源码离线测试并检查当前产品接线，不构建安装包、不调用付费封面生成、不读取真实直播录屏、不登录或发布平台。测试基于 `b6983b2`；本记录不宣称 R2 完成。

## 封面

编辑器的 AI 助手包含 16:9 整期封面候选面板，可选择、编辑、加入时间线；封面编辑弹窗支持比例预设及保存。发布工作台另有按平台要求选择 4:3、3:4、16:9 封面的流程。代码位置：`app/src/components/AIPanel.tsx`、`app/src/components/AICoverPanel.tsx`、`app/src/components/CoverEditorModal.tsx`、`app/src/components/publish/PublishCoverPanel.tsx`。这些是两条不同流程，发布封面不能替代视频画幅。

在 `app/` 下运行：

```powershell
npm test -- tests/cover-editor-modal.test.tsx tests/cover-aspect-ratios.test.ts tests/cover-ratio.test.ts tests/editor.test.tsx tests/editor-inspector.test.tsx
npm test -- tests/editor.test.tsx --maxWorkers=1 --minWorkers=1
npm test -- tests/ai-cover-panel.test.tsx tests/cover-editor-io.test.ts tests/cover-edit-state.test.ts tests/cover-generation.test.ts --maxWorkers=1 --minWorkers=1
```

第一次并行运行中 5 个文件、25 项里 24 项通过，`editor.test.tsx` 首次动态导入触及其 60 秒测试超时。单独限定 1 个 worker 重跑该文件，7/7 通过（约 13 秒）；随后封面另 4 个文件、10/10 通过。因此各唯一用例均有通过记录，但并行首次运行不算全绿。封面生成提供商的真实调用、图片编辑后经桌面 UI 保存和发布平台的封面回显，均未在本轮验证。

## 视频画幅

时间线数据模型有 `width` / `height`，默认新工程为 1920×1080；预览面板显示该数值，导出弹窗可选分辨率档位。当前编辑器与时间线组件没有发现让用户把视频工程从 16:9 改成 9:16、4:3 等画幅的操作入口，也没有从编辑器调用更新时间线宽高的 action。`App.tsx` 中 `setTimeline` 的调用为项目加载或重置；`CoverEditorModal` 的比例预设仅改变封面画布，`ExportSettingsModal` 的分辨率选择也不是工程画幅选择。此为**源码接线缺口**；本轮未做桌面 UI 点击实证，也未修改业务代码。R2 的“画幅”验收目前应保持未通过。

## R2 状态

多轨分割、撤销/重做、保存重开和合成 MP4 导出已有隔离桌面冒烟证据，见 [VFR 基线](r2-vfr-source-baseline-2026-09-28.md) 与 [字幕静帧探针](r2-subtitle-renderstill-feasibility-2026-09-28.md)。当前产品原生暂停预览与导出帧在部分视频帧仍低于 SSIM 0.92 门槛；`renderStill` 探针通过只证明修复路径可行。封面桌面端到端、视频画幅切换、原生预览一致性仍需验收，不应标为 R2 完成。
