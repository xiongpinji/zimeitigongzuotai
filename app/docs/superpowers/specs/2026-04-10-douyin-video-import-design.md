# AI 写稿工作台抖音视频导入设计文档

**日期**：2026-04-10  
**范围**：AI 写稿工作台新增“抖音视频导入原稿”能力（第一期）

---

## 一、目标与边界

### 1.1 目标

在现有 `ScriptWorkbench` 中新增一条原稿导入链路：

1. 用户输入抖音分享链接
2. 系统下载抖音视频到当前项目目录
3. 系统提取音频并调用内置 `bcut` ASR
4. 生成转录文本与字幕文件
5. 自动将转录文本同步为当前 `original.md`
6. 用户继续在工作台中生成 AI 口播稿

同时，这条能力必须暴露为现有 `lingji_*` MCP 工具的一部分，供外部 AI 工具调用。

### 1.2 第一期范围

- 只支持 `douyin`
- ASR 引擎固定为 `bcut`
- 视频导入完成后自动同步到 `original.md`
- 保留原始导入产物，落盘到项目目录
- 提供 MCP 工具入口与状态查询

### 1.3 暂不做

- 不支持小红书 / B 站 / 本地视频多来源
- 不支持 `jianying` 切换
- 不做 ASR 后 LLM 校正
- 不做批量导入多个视频
- 不做视频摘要分析或自动生成口播稿

---

## 二、设计原则

### 2.1 保持工作台单一输入源

工作台继续以 `original.md` 作为唯一“当前原稿”文件。  
视频导入只是新增一种原稿来源，不改变后续写稿流程。

### 2.2 保留来源痕迹

导入视频的原始文件、字幕文件、转录文本、元数据必须保留在项目目录内，不能只覆盖 `original.md`。

### 2.3 平台适配器先行

虽然第一期只做抖音，但内部结构必须按“来源适配器”组织，避免以后接入其他平台时重构。

### 2.4 MCP 与 UI 共用同一服务

桌面工作台入口与 MCP 工具入口都应复用同一套主进程服务逻辑，避免出现两套下载 / 转录实现。

---

## 三、用户流程

### 3.1 工作台内流程

在原稿初始化 / 原稿编辑区域新增 `从抖音链接导入` 操作：

```text
粘贴抖音链接
  → 点击开始导入
  → 下载视频
  → 提取音频
  → bcut ASR 转录
  → 写入 imports/douyin/{videoId}/
  → 同步 transcript.md → original.md
  → 工作台刷新原稿内容
```

### 3.2 完成后的用户感知

导入完成后，用户应直接看到：

- `original.md` 已被更新
- 当前项目目录下已经存在导入视频与转录文件
- 界面提示“来源为抖音导入”

---

## 四、项目目录结构

建议在项目目录中统一落到以下结构：

```text
{projectDir}/
├── original.md
├── script.md
├── imports/
│   └── douyin/
│       └── {videoId}/
│           ├── source.json
│           ├── video.mp4
│           ├── audio.mp3
│           ├── transcript.srt
│           ├── transcript.md
│           └── import-result.json
```

### 4.1 文件职责

- `source.json`
  - 记录平台、原始链接、视频标题、videoId、导入时间、下载信息
- `video.mp4`
  - 下载后的原始视频
- `audio.mp3`
  - 从视频中抽取出的音频
- `transcript.srt`
  - `bcut` ASR 生成的字幕文件
- `transcript.md`
  - 将转录段落整理后的文本原稿
- `import-result.json`
  - 本次导入任务结果、时长、状态、错误信息

---

## 五、架构设计

### 5.1 分层

推荐按以下分层组织：

```text
Renderer（工作台 UI）
  ↓ electronAPI / MCP
Electron Main（导入编排服务）
  ├── 抖音下载器
  ├── 音频提取器
  ├── ASR 任务执行器（bcut）
  └── 文件落盘 / original.md 同步
      ↓
项目目录 imports/douyin/{videoId}
```

### 5.2 模块建议

#### 主进程模块

新增目录：

```text
electron/video-import/
├── types.ts
├── douyin-downloader.ts
├── media-extractor.ts
├── bcut-asr.ts
├── transcript-writer.ts
├── import-service.ts
└── errors.ts
```

#### 渲染层模块

建议新增：

```text
src/components/script/DouyinImportDialog.tsx
src/lib/video-import-types.ts
```

#### MCP 层

扩展：

```text
electron/mcp/tools.ts
```

---

## 六、下载与转录链路

### 6.1 抖音下载

复用你现有参考脚本中的解析思路：

- 解析分享链接中的视频 ID
- 访问 `iesdouyin` 页面
- 从页面数据中提取下载地址
- 下载视频并保存到：
  - `imports/douyin/{videoId}/video.mp4`

### 6.2 音频提取

通过 `ffmpeg` 从视频中提取音频：

- 输入：`video.mp4`
- 输出：`audio.mp3`

第一期建议统一输出 `mp3`，这样更贴近现有 `mp3_to_srt` 逻辑。

### 6.3 ASR

将现有 `scripts/mp3_to_srt/mp3_to_srt.py` 中 `BcutASR` 相关能力迁入本项目。

第一期固定行为：

- 引擎：`bcut`
- 不提供用户切换
- 不在 UI 暴露高级参数

### 6.4 转录文本整理

ASR 结果会先生成标准 `SRT`，再生成 `transcript.md`。

`transcript.md` 的生成规则建议：

- 按段落顺序拼接
- 去掉 SRT 时间戳
- 每段间保留空行
- 保持原始识别顺序，不额外润色

---

## 七、`original.md` 同步策略

用户已确认采用：

> 先落独立文件，再自动同步为当前原稿

因此流程固定为：

1. 先写入 `imports/douyin/{videoId}/transcript.md`
2. 再复制其内容到 `{projectDir}/original.md`
3. 工作台刷新 `original.md` 内容

### 7.1 好处

- 来源文件可追溯
- 当前原稿仍保持单一入口
- 以后支持多平台时不需要改 `ScriptWorkbench` 的核心读写逻辑

---

## 八、MCP 工具设计

### 8.1 新增工具

建议新增两个工具：

#### `lingji_import_video_source`

用途：导入视频来源并同步为原稿

输入：

```json
{
  "sourceType": "douyin",
  "url": "https://...",
  "syncToOriginal": true
}
```

输出：

```json
{
  "success": true,
  "importId": "douyin_1234567890",
  "sourceType": "douyin",
  "videoId": "1234567890",
  "videoPath": ".../imports/douyin/1234567890/video.mp4",
  "transcriptPath": ".../imports/douyin/1234567890/transcript.md",
  "originalPath": ".../original.md",
  "status": "done"
}
```

#### `lingji_get_video_import_status`

用途：查询导入任务状态

输入：

```json
{
  "importId": "douyin_1234567890"
}
```

输出：

```json
{
  "status": "transcribing",
  "progress": 68,
  "stepLabel": "正在进行 bcut 转录"
}
```

### 8.2 为什么不用抖音专用命名

虽然第一期只做抖音，但 MCP 接口保持泛化后，后期扩展到：

- `xiaohongshu`
- `bilibili`
- `local_video`

都无需重命名工具。

---

## 九、前端交互设计

### 9.1 入口位置

在工作台原稿区域新增：

- 空白状态下：
  - `导入文本`
  - `新建空白原稿`
  - `从抖音链接导入`
- 原稿已有内容时：
  - 在快捷操作区提供 `重新从抖音导入`

### 9.2 导入弹层内容

建议使用轻量弹层：

- 输入框：抖音分享链接
- 描述文案：视频将保存到当前项目目录，并自动同步为原稿
- 按钮：开始导入 / 取消
- 状态区：
  - 下载中
  - 提取音频中
  - 转录中
  - 同步原稿中
  - 成功 / 失败

### 9.3 成功提示

成功后显示：

- 已保存视频
- 已生成转录稿
- 已同步到 `original.md`

---

## 十、状态管理与持久化

### 10.1 Script Store 新增状态

建议新增：

```typescript
type VideoImportStatus =
  | 'idle'
  | 'downloading'
  | 'extracting_audio'
  | 'transcribing'
  | 'syncing'
  | 'done'
  | 'error';
```

以及：

```typescript
interface LastVideoImport {
  importId: string;
  sourceType: 'douyin';
  videoId: string;
  transcriptPath: string;
  syncedAt: string;
}
```

### 10.2 持久化策略

- 详细导入结果：写入 `imports/douyin/{videoId}/import-result.json`
- 当前项目摘要：存入 `project.json` 的 `script` 段

恢复项目时可以据此展示：

- 当前原稿最近一次来源
- 最近一次导入是否成功

---

## 十一、错误处理

### 11.1 常见错误

- 抖音链接无法解析
- 视频下载失败
- 本机缺少 `ffmpeg`
- `bcut` 接口超时或失败
- 写入项目目录失败
- `original.md` 同步失败

### 11.2 处理原则

- 失败时保留已成功的中间产物
- 不要清空现有 `original.md`
- 明确提示失败发生在哪一步
- 在 `import-result.json` 中记录错误详情

---

## 十二、测试策略

### 12.1 单元测试

重点覆盖：

- 抖音链接解析与路径生成
- `transcript.md` 文本整理
- 导入结果结构
- `original.md` 同步逻辑
- MCP 工具参数与返回值

### 12.2 集成测试

需要覆盖：

- 主进程导入服务成功路径
- 导入失败回滚策略
- `electron/preload.ts` 与 `src/lib/electron-api.ts` 类型同步
- MCP 工具调用导入服务

### 12.3 不做真实外网测试

自动化测试中不直接打真实抖音 / `bcut` 接口，应通过 mock：

- 下载器响应
- `ffmpeg` 执行结果
- `bcut` ASR 返回结构

---

## 十三、分期建议

### 第一期

- 工作台支持抖音链接导入
- 固定 `bcut`
- 自动同步 `original.md`
- MCP 工具可调用

### 第二期

- 支持 `jianying`
- 提供导入历史视图
- 支持不覆盖原稿，仅导入为候选来源

### 第三期

- 接入小红书 / B 站 / 本地视频
- 引入导入后摘要 / 洗稿辅助能力

---

## 十四、最终建议

第一期采用：

```text
抖音链接
  → 下载 video.mp4
  → 提取 audio.mp3
  → bcut ASR 生成 transcript.srt / transcript.md
  → transcript.md 同步到 original.md
  → 工作台继续 AI 写稿
```

这是当前投入最小、可追溯性最好、对既有工作台侵入最小的一条实现路径。
