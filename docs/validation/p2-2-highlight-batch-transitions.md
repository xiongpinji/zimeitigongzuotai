# P2-2 / H1-S2b2a：高光批次状态转移核心

本项在已落库 `HighlightBatchQueue` 身份/存储核心上增加**持久状态转移**，仍不启动 HotClip、读取媒体、调度并发 worker、生成剪辑文件或接入 IPC/UI。调用方以 `claim(id, maxAttempts)` 领取一条 `queued` 任务并取得本次尝试序号；只有匹配当前 `running` 尝试的 `complete(id, attempt, result)` 或 `fail(id, attempt, code)` 能写终态。重复的完全相同完成回执返回已存结果，冲突回执拒绝；取消后的迟到完成和重试后的旧尝试都不能覆盖当前状态。`cancel(id)` 只持久化取消决定，真正中断子进程仍由后续调度器负责；`retry(id, maxAttempts)` 仅接受 `failed`/`interrupted`，最多五次且不自动触发。

结果只持久化最多 12 个安全形态候选 ID 与 `hlcv1-<sha256>` 高光 ID；若任务明确设置更小的 `maxClips`，结果不得超过该值。错误只能从固定的 `HIGHLIGHT_BATCH_FAILURE_CODES` 中选取。原始异常、stderr、候选正文、视觉证据和媒体字节不进入此 API 的落盘字段；未来调用者仍必须保证传入的 ID 不是敏感原文。所有状态修改先完成参数和状态检查，再验证安全时钟与现有存储字节，使用原队列的同目录临时文件、`fsync` 和 `rename` 提交，成功后才替换内存任务。`running` 重开只保留状态，**不会自动运行或假报完成**；进程崩溃后的中断标记及多持久点恢复属于 H1-S2c。

## 本机离线证据

所有录屏引用、哈希、任务和结果均为合成；文件位于 OS 临时目录，测试删除前核对解析路径为 `tmpdir()` 下本项前缀目录。没有访问真实录屏、账号、网络或平台。

| 检查 | 结果 |
| --- | --- |
| 第一轮 RED | 在生产代码未修改时新增四个状态转移行为用例，官方 Windows Vitest 为 4 failed、15 passed、1 skipped；四个失败均为 `queue.claim is not a function`。 |
| 第一轮 GREEN | 加入状态转移、尝试令牌、固定错误与原子写入路径后为 19 passed、1 skipped；项目 `tsc --noEmit` 退出码 0。 |
| 结果形态 RED→GREEN | 新用例证明字符串会被 `Array.from` 当成候选 ID 数组；初跑 1 failed、20 passed、1 skipped。要求真数组和封闭错误码后为 21 passed、1 skipped。 |
| 访问器翻转 RED→GREEN | 新用例用 getter 在数组形态检查后返回另一批标识；初跑 1 failed、21 passed、1 skipped。改为只读取自有数据属性描述符并复制数组后为 22 passed、1 skipped。 |
| 结果上限 RED→GREEN | 13 个候选 ID 初跑 1 failed、22 passed、1 skipped；加入最多 12 个硬上限后为 23 passed、1 skipped。明确 `maxClips:4` 却提交 5 个候选的用例初跑 1 failed、23 passed、1 skipped；按任务选项校验后为 **24 passed、1 skipped**。 |
| 重复回执磁盘校验 RED→GREEN | 外部改写存储后，重复完成、取消、入队原先会沿内存值假报成功；新增用例初跑 1 failed、24 passed、1 skipped。三个幂等分支增加现存字节校验后为 25 passed、1 skipped。 |
| 审查边界补测 | GLM 首轮只读审查 `qwen-code-review-20260926-034527-e613ee` 未见 P0/P1，指出 `interrupted` 重试、排队取消 `attempt:0` 重开、迟到完成错误优先级三个边界。增补前两项测试后通过；第三项用例初跑 1 failed、26 passed、1 skipped，调整先检查尝试序号后为 27 passed、1 skipped。 |
| 迭代器与迟到失败 RED→GREEN | 自定义数组迭代器可替换候选 ID、迟到失败可先报错码无效，两项初跑 **2 failed、27 passed、1 skipped**。改为仅复制数组自有数据索引并先验证尝试序号后为 **29 passed、1 skipped**。 |
| 相关高光回归、类型与构建 | 主库 Windows 合跑队列、投影、sidecar 为 **97 passed、1 skipped**（共 98 项）；项目 `tsc --noEmit --project app/tsconfig.json`、`electron-vite build` 均退出码 0。 |

唯一 skipped 仍是当前 Windows 环境创建 symlink 返回 `EPERM` 的旧测试；先前 WSL 合成 symlink 烟测单独通过，不把它计入 Windows 用例通过。上述结果仅证明状态转移核心。GLM 首轮审查只覆盖修复前快照，Codex 将其记录为 `repair_required`（`review-1790395248595328251-f3cdd5`）。增量只读复审 `qwen-code-review-20260926-040258-33a6a3` 与 `qwen-code-review-20260926-040509-e324af` 均因 Qwen Code 会话轮数上限退出，没有完整报告，**不得记为 GLM 最终通过**。Codex 自行核对本次精确三文件 diff、失败先行用例、持久化边界和上述本机结果，未发现开放 P0/P1；此结论是协调者审查，不冒称独立模型终验。Qwen 主实现路由的本项有界尝试 `claude-bailian-20260926-032005-423131` 遇到执行权限拒绝，约八分钟后 Codex 停止空转；隔离工作树零目标文件改动，本项代码与测试由 Codex 按 RED→GREEN 接手。

## 待完成门槛

- **H1-S2b2 后半段**：有界并发调度、实际 AbortSignal/子进程取消传播、不同录屏失败隔离与可审计进度；此提交的状态 API 不能单独称为批量高光生产。
- **H1-S2c**：`queued/running/候选算出未提交/提交后未回执` 四个持久点的崩溃恢复；同输入结果不重复。通用队列的跨 OS 进程原子 CAS 未实现，只允许未来持锁 Electron main 写产品数据。
- **H1-S3 与平台**：授权真实录屏、HotClip 许可/分发审查、盲审、真实剪辑导出和四平台结果均未验收；不承诺平台原创标签。
