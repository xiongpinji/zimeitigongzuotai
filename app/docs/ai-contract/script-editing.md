# 文稿编辑契约

先读 [README.md](./README.md)（目录结构、会话锁、结果协议、边界）。本域的锁 `scope` 用 `"script"`。

## 只改这两个 Markdown 文件

| 文件 | 角色 |
| --- | --- |
| `<projectDir>/script.md` | 口播成稿（最终会被读成口播 / 字幕的文稿） |
| `<projectDir>/original.md` | 原始素材（写稿前的原料） |

它们是纯 Markdown，**直接读写文件内容**即可。不走 `project.json` 的 JSON 校验，因此本域**不产生** `.lingji/edit-result.json`（那是视频域 `project.json` 的反馈通道）。

## 行为约定

- **`script.md` 外部保存后**，编辑器会把新内容**灌回脚本工作台**，并**自动补建一条版本历史**（该版本 `source` 标为 `external`）。所以你正常写文件就行，不需要手动建版本。
- **`original.md`** 同样会被监听并反映到工作台对应标签。

## 边界（铁律）

- **不要碰 timeline / 卡片**：那是视频域的事，见 [video-editing.md](./video-editing.md)。文稿域只动这两个 `.md`。
- **不要碰产物**：`podcast-audio.mp3`、`podcast-subtitles*.srt` 是由 `script.md` 经 TTS 生成的产物，手改无意义且会被下次生成覆盖。改文稿后若需要重出口播 / 字幕，请让用户在 App 内执行。
- **不要触发 AI 写稿 / 审稿管线**：App 内的 AI 写稿、审稿、批注是工作台 agent 的职责，有专门的虚拟光标 / 只读态等视觉反馈。你只做「外部直接编辑文稿文件」，不要试图模拟或触发那条管线。

## 会话锁（按 README）

编辑前在 `<projectDir>/.lingji/edit-lock.json` 写锁，`scope` 用 `"script"`：

```json
{
  "owner": "codex",
  "scope": "script",
  "startedAt": 1718260000000,
  "heartbeat": 1718260000000,
  "ttlMs": 30000
}
```

编辑超过约 15s 时续 `heartbeat`（防止 `now - heartbeat > ttlMs` 被自动解锁，默认 `ttlMs` 30000ms）。编辑完成后**删除**该锁文件。锁定期间编辑器暂停自动保存、状态栏显示「AI 正在编辑」，避免内存态覆盖你的改动。
