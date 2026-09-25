# Lingji Cut 源码基线

- 上游仓库：[yoqu/lingji-cut](https://github.com/yoqu/lingji-cut)
- 固定提交：`59a2fc9f8bd00ca243b2b0d4c4e31b67eb6387d1`
- 上游许可证：`Apache-2.0`；原始文本保留在 `app/LICENSE`。本记录不替代逐项依赖的许可证审计。
- 导入方式：对上述提交执行 `git archive --format=tar`，使用 WSL UTF-8 `tar` 解包至 `app/`，不复制上游工作树的未跟踪内容。归档 SHA-256 为 `E28E01554EEEBB643648DA5513147B62005846FF476BBD6A367C2B491847FC6B`。
- 归档内有 1,601 个普通文件；导入后逐个与归档内容进行 SHA-256 比对，0 个缺失或内容差异。Windows 自带 `tar` 首次解包时将 134 个中文路径错码为额外文件，随后依据归档清单仅删除这 134 个额外文件，再次以 WSL 解包和校验。上游业务源码没有编辑。
- 上游 `lingji-cut-homepage` 为 gitlink（`0c4a3607762a7f8d20f5b5e28c199b2ac3cbbea5`），只用于官网，归档中不含其源码；上游 `.gitmodules` 原样保留。桌面应用基线不依赖该子模块。
- 上游已跟踪但被其 `.gitignore` 忽略的两个文件是 `app/.claude/skills/lingji-script-edit/SKILL.md` 与 `app/.claude/skills/lingji-video-edit/SKILL.md`；集成时须单独强制纳入版本控制，不能依据普通 `git status` 判断它们不存在。

这是源码与自动化基线的来源记录，不表示四个平台的真实账号登录、视频发布或商品挂载已通过验收。Windows 验证结果见 [P0-1 记录](../validation/p0-1-windows.md)。
