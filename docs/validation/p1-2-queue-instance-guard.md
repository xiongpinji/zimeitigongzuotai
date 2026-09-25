# P1-2 队列实例守卫 R1：构造期不可读存储 fail closed（2026-09-26）

- 工作树：隔离工作树 `zimeitijuzhen-ao-q2-finalize`（dirty，`--allow-dirty`），HEAD `20937a5c272ce26cec99093a48649bf4c799e04a`。Codex 在官方 Windows Node 22 环境复核，本记录的本地命令在 WSL 运行。
- 触发起点：Codex 对修复前精确字节运行官方聚焦 Vitest 为 **40/41**；唯一 RED 为 `app/tests/publish/durable-queue.test.ts:1273`——以目录作为 `storePath` 构造时逃逸原始 OS 异常 `EISDIR`，而非类型化 `DurableQueueError`。
- 本轮只改 `app/electron/publish/durable-queue.ts` 一个源文件；测试文件未改动，41 项断言原样保留。

## 源码缺陷与修复

缺陷：`load()` 先 `existsSync`，为真后直接 `readFileSync` 且未捕获。目录、权限受限或 `existsSync` 到读取之间的竞态会把原始 `Error { code: 'EISDIR' }` 抛给构造方，既未类型化，也未保证「不可读不等于空存储」。

修复：

- `DurableQueueErrorCode` 增加 `store_read_failed`。
- `load()` 仅把 `readFileSync` 包进 try/catch；读取失败（含目录、权限、`ENOENT` 竞态）一律抛
  `DurableQueueError('store_read_failed', '发布队列存储不可读，已拒绝按空存储加载且未改动原文件')`，
  不带 `detail`，不回显原始 `EISDIR` 文本或路径，且绝不回退为「新建空队列」。
- `parsePersistedStore` 的 `corrupt_store` / `invalid_store` / `unsupported_schema_version` 仍在 catch 之外原样透出，坏 JSON 与未来 schema 的既有语义不变。
- 未改动：同进程活动注册表（`store_in_use`）、磁盘字节指纹（`store_changed_externally`）、未到期 `uploading` 租约保护、取消 / 人工决议 / 未知提交 / 商品阻断语义。

## 验证命令与结果

- 聚焦测试（本机 WSL，复用仓库既有验证记录中的 npx 缓存 runner，vitest 5.0.1，未安装依赖、未新建 harness 文件；工作树内 `node_modules` 不存在）：

  ```
  ~/.npm/_npx/69c381f8ad94b576/node_modules/.bin/vitest run \
    --config /tmp/opencode/p1-2-vitest.config.mjs \
    tests/publish/durable-queue.test.ts
  ```

  结果：`Test Files 1 passed (1)` / `Tests 41 passed (41)`，**exit 0**。

- 修复前 RED 证据：把精确源字节复制到 `/tmp/opencode`（仅重写契约 import 说明符），用本机 Node v22.22.3 type-strip 探针构造目录 `storePath`，得到原始 `Error`，`code: 'EISDIR'`，非 `DurableQueueError`。修复后的同一探针 10/10 通过：类型化为 `store_read_failed`、消息为上述固定文本、`detail === undefined`、消息不含 `EISDIR` / 路径、目录内无任何写入；并回归核对：坏 JSON 仍为 `corrupt_store` 且原字节不变、缺失 store 仍按空队列加载、正常入队写盘可用。
- `tsc --noEmit`：**未运行**。本机全局与 npx 缓存均无 TypeScript 编译器，按任务约束不安装依赖；静态类型结论待 Codex 在主库复核时验证。
- 空白检查：这两个文件在索引与工作树均为 CRLF（`git ls-files --eol` 为 `i/crlf w/crlf`），因此 `git diff --check` 把新增行统一报为 trailing whitespace；`grep -P '[ \t]+\r$'` 匹配 0 行，即未引入真实行尾空白（既有 CRLF 存储不变）。

## 源 / 测试哈希

- `app/electron/publish/durable-queue.ts`：`sha256:11b3a1c072e06a051ae054fbd764e04957cca7238a5d4430e9bacbd5f949b75b`
- `app/tests/publish/durable-queue.test.ts`：`sha256:95c1a0d10e13dc8f49b643e49c07336cd60cde3c168da3a8cea92447d0e2ba1b`（本轮未改动）

## 红门：R1 是离线部分修复，P1-2 未完成

- 仍不安全的跨进程窗口：两个 OS 进程可各自通过「读字节指纹 → 校验 → rename」并在彼此之间交错完成，digest-check 加 rename 不是跨进程原子 CAS；`store_changed_externally` 只覆盖同一 Node / Electron main 进程。
- 尚无 Windows 双进程验收，也没有 OS 文件锁 / 单实例锁 / 单一产品所有者（single-product-owner）决策与实现。
- 没有远端幂等验证，没有真实账号或平台最终状态验证；队列仍未接入 IPC / `runner.ts` / 平台适配器。
- 因此本记录不得被表述为 P1-2 完成；上述门禁落地前，跨进程与真实平台均未取得证据。

## Codex 主库独立复核（2026-09-26）

Codex 核对主库自本工作树基线 `20937a5` 起未改动两份队列目标文件，
选择性复制本工作树三个白名单文件。复制后源码 SHA-256 为
`11b3a1c072e06a051ae054fbd764e04957cca7238a5d4430e9bacbd5f949b75b`，
测试 SHA-256 为
`95c1a0d10e13dc8f49b643e49c07336cd60cde3c168da3a8cea92447d0e2ba1b`。
Windows Node v22.23.3 使用主库已安装的官方 Vitest v2.1.9 运行
`durable-queue.test.ts` **41/41** 与
`queue-platform-adapter.test.ts` **32/32**，合计 **73/73**，
退出码 **0**；`tsc --noEmit --project app/tsconfig.json` 退出码 **0**。
这补充上文 WSL 工作树“未运行 tsc”的环境事实，不改变其记录。

GLM-5.3 只读审查任务 `qwen-code-review-20260925-202705-33f6e5`
给出的跨进程反例仍成立：两个进程各自读取同一旧指纹后先后替换文件，
可能丢失任务或撤销人工决议。下一步 R3 必须在实际产品入口约束唯一写者，
并用 Windows 双进程故障注入核验；如果只采用 Electron 应用单实例锁，
结论仅覆盖被该入口保护的产品进程，**不**等于通用队列 API 任意进程安全。
此处不假定 Electron 锁的范围与 `userData` 路径等价。
