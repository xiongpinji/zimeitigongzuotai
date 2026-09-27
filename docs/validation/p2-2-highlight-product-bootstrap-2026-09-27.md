# H1 高光产品启动写者与恢复门禁（2026-09-27）

在 `app/electron/main.ts` 的 Electron `whenReady` 阶段、首个窗口之前，持有单实例锁的进程通过 `bootstrapProductHighlights` 打开 `<userData>/highlights-v1/queue.json` 与 `artifacts/`。启动时逐项核对既有任务与候选产物；无产物的 `running` 任务转为 `interrupted`，有有效产物的同次任务补记为 `completed`。`completed` 缺失产物或存储损坏时启动失败并以非零状态退出，不继续提供不一致的高光任务仓。引导失败会释放已取得的进程内写者；正常退出时也关闭两仓。

这段产品入口只持有存储并恢复状态，不自动调度、不读取录屏、不启动 HotClip。HotClip 可执行文件、授权媒体根目录和逐任务视频路径仍需由用户配置并经受控入口接入；高光候选审核、时间线回写和渲染也没有因本次接线而完成。通用存储类仍无跨进程 CAS，安全前提是 Electron 单实例门禁持有者独占写者，不允许其他 CLI 或进程同时写同一目录。

本次先新增失败测试：产品引导模块缺失时新测试文件无法加载。实现后，使用 OS 临时目录内的合成录屏引用覆盖无锁拒绝、稳定存储路径与同进程重复写者、两种重启恢复、缺失产物拒绝启动、错误产物根目录释放写者及主进程首窗前调用顺序。没有访问真实媒体或账号。

| 检查 | 结果 |
| --- | --- |
| 高光目录与产品发布队列两套相关测试 | 9 文件、**149 passed、2 skipped**；两项跳过均为 Windows 符号链接用例。 |
| 默认完整 `vitest run --reporter=dot` | 退出码 0；**378 文件通过、2859 passed、4 skipped**。四项跳过是既有跨平台条件用例，未计入通过。 |
| `tsc --noEmit --project tsconfig.json` | 退出码 0。 |
| `electron-vite build` 与单实例产物断言 | 均退出码 0；只生成源码构建目录，未打包或安装。 |
| 隔离空 `userData` 的 Electron 源码首窗 | 退出码 0；窗口标题“灵机剪影”、`file:` 页面、根节点文本长度 235、页面异常 0；空启动未创建 `highlights-v1` 存储目录。 |
| 隔离损坏高光队列的 Electron 启动 | 进程退出码 **1**，未改写合成损坏队列；验证实际主进程拒绝带坏仓继续启动。 |
| `git diff --check` | 退出码 0。 |

首窗和损坏仓检查分别使用被 Git 忽略的 `data/runtime/validation/highlight-product-source-smoke-profile` 与 `highlight-product-corrupt-profile-2026-09-27`；前者的 JSON 与截图位于同目录，均未使用生产账号目录。这些是源码与合成数据证据，不是安装包启动、真实直播录屏质量或平台发布验收。后续需要给产品提供明确的授权媒体路径/HotClip 配置与操作入口，执行真实样本盲审；在此前不启用自动高光生产与发布。

本次由 Codex 复查改动与测试；没有取得新的 GLM 独立只读审查结论，不将其记为已通过。

后续增量：授权录屏批量导入及显式执行控制器已接入持锁主进程，见[控制器验证记录](p2-2-highlight-product-controller-2026-09-27.md)。本页原有的“尚无执行入口”指当时状态；用户界面与 IPC 入口仍待完成。
