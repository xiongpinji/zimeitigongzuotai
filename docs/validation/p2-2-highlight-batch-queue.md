# P2-2 / H1-S2b1：多录屏高光任务持久化核心

本项只交付 `HighlightBatchQueue` 的任务身份、整批校验和本地持久化。调用方传入 `RecordingV1`、**已观察**的来源 SHA-256 与规范化处理选项；本模块不读取或哈希录屏。它用 H1-S1/S2a 的纯投影校验录屏与摘要一致性，以版本化 SHA-256 域构造稳定任务 ID；同录屏 ID、内容哈希和选项再次入队会返回原任务，不重复创建。不同录屏、哈希或 `maxClips` 会得到独立任务。

队列文件是版本化 JSON，仅保存录屏元数据/引用、规范化哈希、选项、任务状态、尝试次数和空候选/高光 ID 占位。它不保存视频字节、转写正文、HotClip 的 `visualEvidence`、stderr、提示词、Cookie、Token、执行文件或环境变量。所有入队项先整体校验，然后一次性提交；任何坏项都不产生部分任务。落盘采用同目录独占临时文件、文件 `fsync` 与 `rename`，成功后才更新内存视图。打开时校验版本、完整 schema、重新计算任务 ID、重复 ID 和状态不变量；损坏、未来版本、目录、读取错误均固定错误拒绝，不清空旧文件。相同解析路径在同一 Node 进程只能有一个活写者，`close()` 释放占用；外部字节改写被拒绝覆盖。

## Windows 主库离线验证

变更范围为 `app/electron/highlights/highlight-batch-queue.ts`、`app/tests/highlights/highlight-batch-queue.test.ts` 和本文。只使用合成录屏引用与 OS 临时目录；删除临时目录前逐个验证解析路径在 `tmpdir()` 下，且具有本项前缀。没有调用 HotClip、模型、网络、真实媒体、账号或平台。

| 检查 | 结果 |
| --- | --- |
| 测试先行 RED | 在源码尚不存在时运行官方 Vitest，套件因模块缺失无法收集，退出码 1。 |
| 核心初版 | 6/6 用例通过；首次类型检查发现 `Object.hasOwn` 超出项目 TypeScript lib、一个 `unknown` 参数和返回路径问题，修正后 `tsc --noEmit --project app/tsconfig.json` 退出码 0。 |
| 伪造错误回归 | 增加输入 getter 抛出携带敏感标记的伪造 `HighlightBatchQueueError`，初跑 6/7；只允许本模块签发的错误透出后 7/7 通过。 |
| 持久 schema 回归 | 增加 completed 重开、外部改写、缺失 canonical option 与 queued 残留候选；初跑 8/10、1 skipped，修复后 Windows **9 passed、1 skipped**，Vitest 退出码 0。随后加 Windows 盘符大小写别名的唯一写者 RED，修正锁键后仍为 9 passed、1 skipped。 |
| 类型检查 | 最后一次主库 `tsc --noEmit --project app/tsconfig.json` 退出码 0；测试文件由 Vitest 转译执行，不在项目 tsconfig 的源码检查范围内。 |
| Linux 符号链接补充检查 | WSL Node 22 将本地两份 TS 模块转译为临时 CommonJS，在 OS 临时目录创建指向正常队列文件的 symlink；构造队列得到固定 `store_read_failed`，目标字节未变，退出码 0。此为单独的运行时烟测，不是 Windows Vitest 用例通过。 |
| 相关高光回归 | Windows 官方 Vitest 合跑本项、原投影 21 项和 HotClip sidecar 47 项：**77 passed、1 skipped**，退出码 0；app 类型检查退出码 0。跳过项仍只有 Windows symlink。 |

GLM-5.3 首次只读审查 `qwen-code-review-20260926-024719-04110f` 报告一个 P1：系统时钟回拨可能写出任务时间大于文件时间的快照，导致下次打开永久判为损坏；Codex 记录 `repair_required`（`review-1790391526833347355-6cdeec`）。新增回拨 RED 测试后，入队在提交前拒绝低于任何已有任务 `updatedAt` 的时钟值，原文件及内存保持不变，重开仍能读到原任务。审查指出的数组访问器原始异常、跨调用篡改已签发错误消息、同键变更录屏时长静默沿用旧元数据、显式 `undefined` 选项，以及 Windows 盘符大小写锁键，都已新增定向用例并修复。修复后新队列聚焦套件为 **15 passed、1 skipped**（共 16 个）；与原投影及 sidecar 合跑为 **83 passed、1 skipped**，app 类型检查退出码 0。首次审查结论不被当作修复后自动通过的审查。

GLM-5.3 第二轮只读复审 `qwen-code-review-20260926-030428-f981f2` 确认上述 P1 已关闭、此三文件核心范围内无开放 P0/P1；Codex 记录 `accepted`（`review-1790392436202333425-9daa99`）。复审指出入队尾部依赖投影模块严格校验录屏和 SHA-256；Codex 核对 `project-hotclip-candidates.ts` 的封闭 `RecordingV1` 字段和 64 位十六进制摘要校验，该依赖目前成立。另一项 P2 是非数字 `schemaVersion` 返回 `store_unsupported_version` 而非 `store_corrupt`，两者均拒绝读取，留待后续错误分类整理。

唯一 skipped 是符号链接文件的 Windows 用例：这台 Windows 环境创建测试 symlink 返回 `EPERM`。源码以 `lstatSync` 拒绝符号链接；WSL 临时烟测支持该判断，但当前 Windows 用例仍**未实测**，不能将 skipped 计入通过项。未来可在有建链权限的 Windows 环境或 Linux 正式 Vitest 环境实跑。当前的测试也没有模拟磁盘满、断电或两个 OS 进程同时改写；`fsync` 文件不等于证明掉电持久性，`readRawStore` 字节比对与进程内 Set 均不是跨进程原子锁/CAS。产品路径仍需 Electron 单实例所有者约束写入。

## 阶段边界

本项是 **H1-S2b 的第一段**。`queued/running/interrupted/completed/failed/cancelled` 状态字段为后续调度留接口，但当前没有执行器、并发调度、取消、重试、候选提交或 IPC/UI；重开 `running` 不会自动调用 sidecar，也不会假报 completed。H1-S2b2 须实现有界调度和错误隔离，H1-S2c 须做持久点故障注入与恢复，H1-S3 才能接用户另装的 HotClip 并对真实授权录屏盲审。当前源码和测试只证明离线身份/存储边界，不证明智能剪辑成片、版权许可、商品挂载、平台上传或平台“原创”判定。
