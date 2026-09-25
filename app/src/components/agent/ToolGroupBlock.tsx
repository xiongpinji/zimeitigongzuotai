import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  Search,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import { ToolCallBlock } from './ToolCallBlock';
import { describeToolCallBlock, type ToolCallDescriptor } from './tool-call-descriptor';
import { CopyButton } from './CopyButton';
import styles from './AgentTranscript.module.css';

interface ToolCallBlockType {
  type: 'tool_call';
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: string;
  rawOutput?: string;
}

type GroupStatusKind = 'running' | 'ok' | 'error';

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function classifyStatus(status?: string): GroupStatusKind {
  const s = textValue(status).toLowerCase();
  if (s === 'completed' || s === 'done' || s === 'success' || s === 'ok') return 'ok';
  if (s === 'failed' || s === 'error') return 'error';
  return 'running';
}

export function aggregateStatus(blocks: ToolCallBlockType[]): GroupStatusKind {
  let hasError = false;
  for (const block of blocks) {
    const kind = classifyStatus(block.status);
    if (kind === 'running') return 'running';
    if (kind === 'error') hasError = true;
  }
  return hasError ? 'error' : 'ok';
}

function isCommandGroup(blocks: ToolCallBlockType[]): boolean {
  return blocks.some((block) => describeToolCallBlock(block).category === 'command');
}

function groupTitle(blocks: ToolCallBlockType[]): string {
  const first = blocks[0];
  if (!first) return '工具调用';
  return describeToolCallBlock(first).label;
}

function groupStatusLabel(kind: GroupStatusKind, commandLike: boolean): string {
  if (kind === 'running') return commandLike ? '执行中' : '运行中';
  if (kind === 'error') return commandLike ? '执行失败' : '调用失败';
  return commandLike ? '已执行' : '已完成';
}

function commandGroupLabel(kind: GroupStatusKind, count: number): string {
  if (kind === 'running') return `正在运行 ${count} 条命令`;
  if (kind === 'error') return `${count} 条命令执行失败`;
  return `已运行 ${count} 条命令`;
}

function GroupIcon({ descriptor }: { descriptor: ToolCallDescriptor | null }) {
  if (!descriptor) return <Wrench size={14} strokeWidth={1.8} />;
  if (descriptor.category === 'command') return <Terminal size={14} strokeWidth={1.8} />;
  if (descriptor.category === 'edit' || descriptor.category === 'write' || descriptor.category === 'delete') {
    return <Pencil size={14} strokeWidth={1.8} />;
  }
  if (descriptor.category === 'read' || descriptor.category === 'search') {
    return <Search size={14} strokeWidth={1.8} />;
  }
  return <Wrench size={14} strokeWidth={1.8} />;
}

function GroupStatusIcon({ kind }: { kind: GroupStatusKind }) {
  if (kind === 'ok') return <Check size={14} strokeWidth={2} aria-label="已完成" />;
  if (kind === 'error') return <X size={14} strokeWidth={2} aria-label="失败" />;
  return <span aria-label="运行中" className="inline-block h-2 w-2 rounded-full bg-mac-blue animate-pulse" />;
}

function commandSubject(block: ToolCallBlockType): string {
  const descriptor = describeToolCallBlock(block);
  return descriptor.category === 'command' && descriptor.subject
    ? descriptor.subject
    : textValue(block.title) || '命令';
}

function shellText(block: ToolCallBlockType): string {
  const command = commandSubject(block);
  const output = block.rawOutput?.trimEnd() || '(no output)';
  return `$ ${command}\n${output}`;
}

function commandRowLabel(kind: GroupStatusKind): string {
  if (kind === 'running') return '正在运行';
  if (kind === 'error') return '执行失败';
  return '已运行';
}

/**
 * 命令组紧凑列表 —— 每条命令一行，行内单独展开 / 收起 shell 输出。
 * 折叠态下用户即可扫读所有已执行命令；不需要先点开整组才能看到。
 */
function CommandList({ blocks }: { blocks: ToolCallBlockType[] }) {
  // 用 toolCallId（兜底为索引）维护 per-row 展开状态。同时只支持多个独立展开，无互斥。
  const [openSet, setOpenSet] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <ul className={styles.commandList}>
      {blocks.map((block, index) => {
        const key = block.toolCallId || `cmd-${index}`;
        const opened = openSet.has(key);
        const status = classifyStatus(block.status);
        const command = commandSubject(block);
        const rowStatusClass =
          status === 'error'
            ? styles.eventStatusError
            : status === 'ok'
              ? styles.eventStatusOk
              : '';
        return (
          <li key={key} className={styles.commandRow}>
            <div className={styles.commandRowHeadRow}>
              <button
                type="button"
                className={`${styles.commandRowHead} ${rowStatusClass}`}
                onClick={() => toggle(key)}
                aria-expanded={opened}
              >
                <span className={styles.commandRowLabel}>{commandRowLabel(status)}</span>
                <code className={styles.commandRowText}>{command}</code>
                <span className={styles.commandRowChevron} aria-hidden>
                  {opened ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
              </button>
              <CopyButton text={command} className={styles.commandRowCopyBtn} label="复制命令" />
            </div>
            {opened ? (
              <div className={styles.commandRowBody}>
                <pre className={`${styles.detailPre} ${styles.detailShell} ${styles.commandGroupShell}`}>
                  {shellText(block)}
                </pre>
                <div className={`${styles.commandRowStatusLine} ${rowStatusClass}`}>
                  <GroupStatusIcon kind={status} />
                  <span>{status === 'error' ? '失败' : status === 'ok' ? '成功' : '运行中'}</span>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ToolGroupBlock({ blocks }: { blocks: ToolCallBlockType[] }) {
  const statusKind = aggregateStatus(blocks);
  const commandLike = isCommandGroup(blocks);
  const firstDescriptor = blocks[0] ? describeToolCallBlock(blocks[0]) : null;
  const title = groupTitle(blocks);
  // 命令组默认收起，只露出总数；用户点开后再看每条命令摘要和输出。
  const [expanded, setExpanded] = useState(commandLike ? false : statusKind === 'error');
  const statusClass =
    statusKind === 'error'
      ? styles.eventStatusError
      : statusKind === 'ok'
        ? styles.eventStatusOk
        : '';

  return (
    <div className={styles.event}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`${styles.eventHeader} ${styles.eventHeaderInteractive}`}
        aria-expanded={expanded}
      >
        <span className={styles.eventIcon}>
          <GroupIcon descriptor={firstDescriptor} />
        </span>
        {commandLike ? (
          // 命令组的标题文案本身已包含状态语义（"正在运行 / 已运行 / N 条执行失败"），
          // 所以不再叠加 "已执行 / 调用失败" 之类的二次 status 文字，避免重复元素。
          <span className={`${styles.eventLabel} ${statusClass}`}>
            {commandGroupLabel(statusKind, blocks.length)}
          </span>
        ) : (
          <>
            <span className={styles.eventLabel}>{title}</span>
            <span className={`${styles.eventStatus} ${statusClass}`}>
              <GroupStatusIcon kind={statusKind} /> {groupStatusLabel(statusKind, commandLike)}
            </span>
            <span className={styles.eventTitle}>{blocks.length} 次调用</span>
          </>
        )}
        <span className={styles.eventChevron} aria-hidden>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {expanded ? (
        commandLike ? (
          <CommandList blocks={blocks} />
        ) : (
          <div className={styles.groupChildren}>
            {blocks.map((block, index) => (
              <ToolCallBlock
                key={block.toolCallId || index}
                block={block}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
