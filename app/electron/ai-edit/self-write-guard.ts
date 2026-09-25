/**
 * 自写抑制：主进程写项目文件后记录"刚写入的内容"，
 * chokidar 监听到同内容变更时识别为自身回声并跳过转发，打断 autosave↔watch 回环。
 * 命中即清除（一次性），避免长期占用；未命中（真实外部编辑）正常放行。
 *
 * 每个路径保存一组待消费的自写内容（而非单槽），因为同一个 project.json 会被
 * timeline 段与 aiAnalysis 段先后回写。若只留最后一次记录，前一次的 chokidar 回声
 * 会被误判为外部编辑并触发 watch⇄autosave 死循环。
 */
const recent = new Map<string, string[]>();

/** 单路径最多缓存的待消费自写条数：防止 chokidar 合并事件导致未消费记录无限堆积。 */
const MAX_PENDING_PER_PATH = 16;

/** 主进程写文件后调用：记录该绝对路径刚写入的内容。 */
export function markSelfWrite(absPath: string, content: string): void {
  const list = recent.get(absPath) ?? [];
  list.push(content);
  // 只保留最近若干条，丢弃最旧的未消费记录。
  while (list.length > MAX_PENDING_PER_PATH) {
    list.shift();
  }
  recent.set(absPath, list);
}

/**
 * chokidar 读到变更后调用：若 content 命中该路径任一条待消费自写，判为自身回声，
 * 消费该条记录并返回 true；否则返回 false（真实外部编辑）。
 */
export function consumeSelfWrite(absPath: string, content: string): boolean {
  const list = recent.get(absPath);
  if (!list) return false;
  const idx = list.indexOf(content);
  if (idx === -1) return false;
  list.splice(idx, 1);
  if (list.length === 0) recent.delete(absPath);
  return true;
}
