import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ClipboardEvent,
  type DragEvent,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence } from 'framer-motion';
import {
  Send,
  Square,
  Plus,
  X,
  FileText,
  Image as ImageIcon,
  ChevronDown,
  Hand,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Check,
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  AcpConfigOption,
  AgentMode,
  AvailableCommand,
  PromptInputBlock,
} from '../../../electron/acp/types';
import { useProjectFiles, type FlatFileEntry } from '../../hooks/use-project-files';
import { AutocompleteMenu, type MenuItem } from './AutocompleteMenu';

// ─── 类型定义 ──────────────────────────────────────────────────

interface ImageAttachment {
  id: string;
  type: 'image';
  data: string;
  mimeType: string;
  name: string;
}

interface ResourceAttachment {
  id: string;
  type: 'resource';
  uri: string;
  name: string;
  mimeType: string | null;
  text?: string | null;
  blob?: string | null;
}

type Attachment = ImageAttachment | ResourceAttachment;

export interface MessageInputProps {
  onSend: (blocks: PromptInputBlock[]) => void;
  onCancel?: () => void;
  disabled?: boolean;
  isPrompting?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /** 项目目录，用于 @ 文件提及 */
  projectDir?: string | null;
  /** ACP 可用斜杠命令 */
  availableCommands?: AvailableCommand[] | null;
  /** ACP 配置选项（含模型选择等） */
  configOptions?: AcpConfigOption[] | null;
  onConfigOptionChange?: (configId: string, valueId: string) => void;
  /** ACP 可用模式 */
  availableModes?: AgentMode[] | null;
  currentModeId?: string | null;
  onModeChange?: (modeId: string) => void;
  /** 当前 agent 启用的 skills（用于 $ 补全）；空数组不弹菜单。 */
  skillItems?: { id: string; label: string; description?: string }[];
  /** 当前审批模式（'always_ask' | 'tiered' | 'auto_approve'）。 */
  permissionPolicy?: string;
  /** 审批模式切换回调；提供时才渲染底栏审批 pill。 */
  onPermissionPolicyChange?: (policy: string) => void;
  /** 底栏右侧（发送按钮左侧）插槽，用于渲染模型/思考程度选择器等。 */
  bottomToolbarTrailing?: React.ReactNode;
}

// ─── 审批模式选项（与 Codex 三态对齐） ──────────────────────────

interface ApprovalOption {
  id: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  /** 该模式是否为「宽松/警示」态（pill 用警示色）。 */
  caution?: boolean;
}

const APPROVAL_OPTIONS: ApprovalOption[] = [
  { id: 'always_ask', label: '请求批准', description: '编辑外部文件和使用互联网时始终询问', Icon: Hand },
  { id: 'tiered', label: '替我审批', description: '仅对检测到的风险操作请求批准', Icon: ShieldCheck },
  {
    id: 'auto_approve',
    label: '完全访问',
    description: '可不受限制地访问互联网和您电脑上的任何文件',
    Icon: AlertTriangle,
    caution: true,
  },
];

// ─── 工具函数 ──────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', json: 'application/json',
  yaml: 'application/yaml', yml: 'application/yaml', csv: 'text/csv',
  html: 'text/html', css: 'text/css', js: 'text/javascript',
  ts: 'text/typescript', tsx: 'text/tsx', jsx: 'text/jsx',
  py: 'text/x-python', rs: 'text/rust', go: 'text/x-go',
  java: 'text/x-java-source', xml: 'application/xml', toml: 'application/toml',
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const TEXT_EXTS = new Set([
  'json', 'yaml', 'yml', 'xml', 'toml', 'md', 'csv',
  'js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'css', 'html', 'txt',
]);

function fileNameFromPath(p: string) { return p.split(/[/\\]/).pop() || p; }
function mimeTypeFromPath(p: string) { return MIME_BY_EXT[p.split('.').pop()?.toLowerCase() ?? ''] ?? null; }
function isImageFile(f: File) { return f.type.startsWith('image/') || IMAGE_EXTENSIONS.has(f.name.split('.').pop()?.toLowerCase() ?? ''); }
function hasDragFiles(dt: DataTransfer | null) { return dt?.types ? Array.from(dt.types).includes('Files') : false; }

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== 'string') { reject(new Error('非字符串结果')); return; }
      const i = r.indexOf(',');
      resolve(i >= 0 ? r.slice(i + 1) : r);
    };
    reader.readAsDataURL(blob);
  });
}

let _idCounter = 0;
function nextId(prefix: string) { return `${prefix}-${Date.now()}-${++_idCounter}`; }

// ─── 组件 ──────────────────────────────────────────────────────

export function MessageInput({
  onSend,
  onCancel,
  disabled = false,
  isPrompting = false,
  placeholder = '输入消息…',
  autoFocus = false,
  className = '',
  projectDir,
  availableCommands,
  configOptions,
  onConfigOptionChange,
  availableModes,
  currentModeId,
  onModeChange,
  skillItems,
  permissionPolicy,
  onPermissionPolicyChange,
  bottomToolbarTrailing,
}: MessageInputProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [previewImage, setPreviewImage] = useState<ImageAttachment | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef(text);
  useEffect(() => { textRef.current = text; }, [text]);

  // ── 斜杠命令自动补全 ──

  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashSelectedIdx, setSlashSelectedIdx] = useState(0);
  const commands = useMemo(() => availableCommands ?? [], [availableCommands]);

  const filteredCommands = useMemo((): MenuItem[] => {
    if (!slashMenuOpen || commands.length === 0) return [];
    const match = text.match(/^\/(\S*)$/);
    if (!match) return [];
    const filter = match[1].toLowerCase();
    return commands
      .filter((cmd) => cmd.name.toLowerCase().startsWith(filter))
      .map((cmd) => ({ id: cmd.name, label: `/${cmd.name}`, description: cmd.description, icon: 'command' as const }));
  }, [slashMenuOpen, commands, text]);

  // ── @ 文件提及 ──

  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atSelectedIdx, setAtSelectedIdx] = useState(0);
  const [atTriggerPos, setAtTriggerPos] = useState<number | null>(null);
  const [fileTreeEnabled, setFileTreeEnabled] = useState(false);
  const atTriggerPosRef = useRef(atTriggerPos);
  useEffect(() => { atTriggerPosRef.current = atTriggerPos; }, [atTriggerPos]);

  const { files: projectFiles } = useProjectFiles(projectDir ?? null, fileTreeEnabled);

  const filteredFiles = useMemo((): MenuItem[] => {
    if (!atMenuOpen || atTriggerPos == null) return [];
    const afterAt = text.slice(atTriggerPos + 1);
    const spaceIdx = afterAt.indexOf(' ');
    const filter = (spaceIdx === -1 ? afterAt : afterAt.slice(0, spaceIdx)).toLowerCase();
    let matched: FlatFileEntry[];
    if (!filter) {
      matched = projectFiles.slice(0, 50);
    } else {
      matched = [];
      for (const f of projectFiles) {
        if (f.lowerName.includes(filter) || f.lowerPath.includes(filter)) {
          matched.push(f);
          if (matched.length >= 50) break;
        }
      }
    }
    return matched.map((f) => ({
      id: f.relativePath,
      label: f.name,
      description: f.relativePath,
      icon: 'file' as const,
    }));
  }, [atMenuOpen, atTriggerPos, text, projectFiles]);

  // ── $ 技能补全 ──

  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillSelectedIdx, setSkillSelectedIdx] = useState(0);
  const skills = useMemo(() => skillItems ?? [], [skillItems]);

  const filteredSkills = useMemo((): MenuItem[] => {
    if (!skillMenuOpen || skills.length === 0) return [];
    // 触发符 $ 或 +：两者等价，选中后统一落地为 $id（见 handleSkillSelect）。
    const match = text.match(/[$+]([a-z0-9-]*)$/i);
    if (!match) return [];
    const filter = match[1].toLowerCase();
    return skills
      .filter((s) => s.id.toLowerCase().startsWith(filter))
      .map((s) => ({ id: s.id, label: s.label, description: s.description, icon: 'command' as const }));
  }, [skillMenuOpen, skills, text]);

  // ── 自动调整高度 ──

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);
  useEffect(() => { adjustHeight(); }, [text, adjustHeight]);

  // ── 自动聚焦 ──
  useEffect(() => {
    if (autoFocus && !disabled && !isPrompting) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [autoFocus, disabled, isPrompting]);

  // ── 附件分类 ──

  const imageAttachments = useMemo(() => attachments.filter((a): a is ImageAttachment => a.type === 'image'), [attachments]);
  const resourceAttachments = useMemo(() => attachments.filter((a): a is ResourceAttachment => a.type === 'resource'), [attachments]);
  const hasSendableContent = text.trim().length > 0 || attachments.length > 0;
  const canSend = hasSendableContent && !disabled;

  // ── 附件操作 ──

  const addImageAttachments = useCallback(async (files: File[]) => {
    const parsed = await Promise.all(files.map(async (file, i) => ({
      id: nextId('img'), type: 'image' as const,
      data: await blobToBase64(file),
      mimeType: file.type.startsWith('image/') ? file.type : (mimeTypeFromPath(file.name) ?? 'image/png'),
      name: file.name || `image-${i + 1}`,
    })));
    setAttachments((prev) => [...prev, ...parsed]);
  }, []);

  const addResourceAttachments = useCallback(async (files: File[]) => {
    const parsed = await Promise.all(files.map(async (file) => {
      const mime = file.type || mimeTypeFromPath(file.name);
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const isText = file.type.startsWith('text/') || TEXT_EXTS.has(ext);
      if (isText) {
        return { id: nextId('res'), type: 'resource' as const, uri: `clipboard://${encodeURIComponent(file.name)}-${Date.now()}`, name: file.name, mimeType: mime ?? null, text: await file.text() };
      }
      const data = await blobToBase64(file);
      return { id: nextId('res'), type: 'resource' as const, uri: `data:${mime || 'application/octet-stream'};base64,${data}`, name: file.name, mimeType: mime ?? null, blob: data };
    }));
    setAttachments((prev) => [...prev, ...parsed]);
  }, []);

  const addFilesFromInput = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const imgs: File[] = [], res: File[] = [];
    for (const f of files) (isImageFile(f) ? imgs : res).push(f);
    const tasks: Promise<void>[] = [];
    if (imgs.length > 0) tasks.push(addImageAttachments(imgs));
    if (res.length > 0) tasks.push(addResourceAttachments(res));
    await Promise.all(tasks);
  }, [addImageAttachments, addResourceAttachments]);

  const addFileByPath = useCallback((relativePath: string) => {
    if (!projectDir) return;
    const absPath = `${projectDir}/${relativePath}`;
    const name = fileNameFromPath(relativePath);
    const mime = mimeTypeFromPath(relativePath);
    setAttachments((prev) => {
      // 去重
      if (prev.some((a) => a.type === 'resource' && a.uri === `file://${absPath}`)) return prev;
      return [...prev, {
        id: nextId('res'), type: 'resource' as const,
        uri: `file://${absPath}`, name, mimeType: mime,
      }];
    });
  }, [projectDir]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ── 选择文件（Electron 对话框）──

  const handlePickFiles = useCallback(async () => {
    if (disabled) return;
    const api = window.electronAPI;
    if (!api?.selectTextFile) return;
    try {
      const result = await api.selectTextFile();
      if (result) {
        setAttachments((prev) => [...prev, {
          id: nextId('res'), type: 'resource', uri: `file://${result.path}`,
          name: fileNameFromPath(result.path), mimeType: mimeTypeFromPath(result.path), text: result.content,
        }]);
      }
    } catch (err) { console.error('[MessageInput] 选择文件失败:', err); }
  }, [disabled]);

  // ── 粘贴/拖拽 ──

  const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    void addFilesFromInput(files);
  }, [addFilesFromInput, disabled]);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!hasDragFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (!disabled) setIsDragActive(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    const related = e.relatedTarget;
    if (related instanceof Node && e.currentTarget.contains(related)) return;
    setIsDragActive(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!hasDragFiles(e.dataTransfer)) return;
    e.preventDefault();
    setIsDragActive(false);
    if (disabled) return;
    void addFilesFromInput(Array.from(e.dataTransfer.files ?? []));
  }, [addFilesFromInput, disabled]);

  // ── 构建并发送 ──

  const buildBlocks = useCallback((): PromptInputBlock[] | null => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return null;
    const blocks: PromptInputBlock[] = [];
    if (trimmed) blocks.push({ type: 'text', text: trimmed });
    for (const att of attachments) {
      if (att.type === 'image') {
        blocks.push({ type: 'image', data: att.data, mimeType: att.mimeType });
      } else {
        blocks.push({ type: 'resource', uri: att.uri, mimeType: att.mimeType ?? undefined, text: att.text ?? undefined, blob: att.blob ?? undefined });
      }
    }
    return blocks;
  }, [text, attachments]);

  const handleSend = useCallback(() => {
    const blocks = buildBlocks();
    if (!blocks) return;
    onSend(blocks);
    setText('');
    setAttachments([]);
    requestAnimationFrame(() => { if (textareaRef.current) textareaRef.current.style.height = 'auto'; });
  }, [buildBlocks, onSend]);

  // ── 自动补全选择处理 ──

  const handleSlashSelect = useCallback((item: MenuItem) => {
    setText(`/${item.id} `);
    setSlashMenuOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const handleAtSelect = useCallback((item: MenuItem) => {
    const pos = atTriggerPosRef.current;
    if (pos == null) return;
    // 移除 @query 文本
    const current = textRef.current;
    const beforeAt = current.slice(0, pos);
    const afterAt = current.slice(pos);
    const spaceIdx = afterAt.indexOf(' ', 1);
    const afterToken = spaceIdx === -1 ? '' : afterAt.slice(spaceIdx);
    setText(beforeAt + afterToken);
    // 附加文件
    addFileByPath(item.id);
    setAtMenuOpen(false);
    setAtTriggerPos(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [addFileByPath]);

  const handleSkillSelect = useCallback((item: MenuItem) => {
    // 用 $id 替换光标前最后一个 $partial / +partial（统一落地为 $id，保持注入协议不变）
    const current = textRef.current;
    const replaced = current.replace(/[$+]([a-z0-9-]*)$/i, `$${item.id} `);
    setText(replaced === current ? `${current}$${item.id} ` : replaced);
    setSkillMenuOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // 从「+」菜单 Skill 子列表插入：在光标处补一个 `$id `（复用既有注入协议）。
  const insertSkillMention = useCallback((id: string) => {
    const current = textRef.current;
    const sep = current.length > 0 && !/\s$/.test(current) ? ' ' : '';
    setText(`${current}${sep}$${id} `);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // ── 文本变更（含 / 和 @ 检测）──

  const handleTextChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);

    // / 命令检测（仅在文本起始位置）
    if (commands.length > 0 && /^\/(\S*)$/.test(value)) {
      setSlashSelectedIdx(0);
      setSlashMenuOpen(true);
      setAtMenuOpen(false);
      return;
    }
    setSlashMenuOpen(false);

    const cursorPos = e.target.selectionStart;

    // 技能补全检测（光标前最后一个 token 以 $ 或 + 开头）
    if (skills.length > 0 && cursorPos != null) {
      const beforeCursor = value.slice(0, cursorPos);
      if (/(^|\s)[$+][a-z0-9-]*$/i.test(beforeCursor)) {
        setSkillSelectedIdx(0);
        setSkillMenuOpen(true);
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        return;
      }
    }
    setSkillMenuOpen(false);

    // @ 文件提及检测
    if (cursorPos != null && projectDir) {
      const beforeCursor = value.slice(0, cursorPos);
      const atMatch = beforeCursor.match(/(^|[\s])@([^\s]*)$/);
      if (atMatch) {
        const atPos = beforeCursor.length - atMatch[0].length + atMatch[1].length;
        setAtTriggerPos(atPos);
        setAtSelectedIdx(0);
        setAtMenuOpen(true);
        setFileTreeEnabled(true);
        return;
      }
    }
    setAtMenuOpen(false);
  }, [commands.length, projectDir, skills.length]);

  // ── 键盘处理 ──

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || composingRef.current || e.keyCode === 229) return;

    // / 命令菜单导航
    if (slashMenuOpen && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSelectedIdx((i) => i < filteredCommands.length - 1 ? i + 1 : 0); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSelectedIdx((i) => i > 0 ? i - 1 : filteredCommands.length - 1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleSlashSelect(filteredCommands[slashSelectedIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSlashMenuOpen(false); return; }
    }

    // $ 技能菜单导航
    if (skillMenuOpen && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSkillSelectedIdx((i) => i < filteredSkills.length - 1 ? i + 1 : 0); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSkillSelectedIdx((i) => i > 0 ? i - 1 : filteredSkills.length - 1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleSkillSelect(filteredSkills[skillSelectedIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSkillMenuOpen(false); return; }
    }

    // @ 文件菜单导航
    if (atMenuOpen && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAtSelectedIdx((i) => i < filteredFiles.length - 1 ? i + 1 : 0); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAtSelectedIdx((i) => i > 0 ? i - 1 : filteredFiles.length - 1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleAtSelect(filteredFiles[atSelectedIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setAtMenuOpen(false); return; }
    }

    // Enter 发送，Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (canSend || isPrompting) handleSend();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (canSend || isPrompting) handleSend();
    }
  }, [canSend, isPrompting, handleSend, slashMenuOpen, filteredCommands, slashSelectedIdx, handleSlashSelect, atMenuOpen, filteredFiles, atSelectedIdx, handleAtSelect, skillMenuOpen, filteredSkills, skillSelectedIdx, handleSkillSelect]);

  // ── 选择器数据 ──

  // 过滤掉与 availableModes 重复的 configOption（ACP 协议可能同时在两处返回模式信息）
  const dedupedConfigOptions = useMemo(() => {
    if (!configOptions || !availableModes || availableModes.length === 0) return configOptions;
    const modeIds = new Set(availableModes.map((m) => m.modeId));
    return configOptions.filter((opt) => {
      const allMatch = opt.options.length > 0 && opt.options.every((v) => modeIds.has(v.value));
      return !allMatch;
    });
  }, [configOptions, availableModes]);

  const hasConfigOptions = (dedupedConfigOptions?.length ?? 0) > 0;
  const hasModes = (availableModes?.length ?? 0) > 0;
  const hasSelectors = hasConfigOptions || hasModes;

  // ── 渲染 ──

  const hasImages = imageAttachments.length > 0;
  const hasResources = resourceAttachments.length > 0;
  const showDragOverlay = isDragActive && !disabled;

  return (
    <>
      <div
        ref={containerRef}
        className={`relative flex flex-col rounded-[10px] border border-mac-border bg-mac-elevated transition-colors focus-within:border-mac-blue/50 ${showDragOverlay ? 'ring-1 ring-mac-blue/30' : ''} ${className}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 自动补全菜单 */}
        {slashMenuOpen && filteredCommands.length > 0 && (
          <AutocompleteMenu
            items={filteredCommands}
            selectedIndex={slashSelectedIdx}
            onSelect={handleSlashSelect}
            hint="输入 / 搜索命令"
          />
        )}
        {atMenuOpen && filteredFiles.length > 0 && (
          <AutocompleteMenu
            items={filteredFiles}
            selectedIndex={atSelectedIdx}
            onSelect={handleAtSelect}
            hint="输入 @ 搜索项目文件"
          />
        )}
        {skillMenuOpen && filteredSkills.length > 0 && (
          <AutocompleteMenu
            items={filteredSkills}
            selectedIndex={skillSelectedIdx}
            onSelect={handleSkillSelect}
            hint="输入 $ 调用技能"
          />
        )}

        {/* 附件预览区 */}
        {(hasImages || hasResources) && (
          <div className="flex flex-col gap-1.5 px-2.5 pt-2.5">
            {hasImages && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {imageAttachments.map((att) => (
                  <div key={att.id} className="relative shrink-0 overflow-hidden rounded-[6px] border border-mac-border/60 bg-black/20">
                    <button type="button" onClick={() => setPreviewImage(att)} className="cursor-pointer transition-opacity hover:opacity-80">
                      <img src={`data:${att.mimeType};base64,${att.data}`} alt={att.name} className="h-14 w-14 object-cover" />
                    </button>
                    <button type="button" onClick={() => removeAttachment(att.id)} className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white/80 hover:bg-black/80 hover:text-white transition-colors" aria-label={`移除 ${att.name}`}>
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {hasResources && (
              <div className="flex flex-wrap items-center gap-1.5">
                {resourceAttachments.map((att) => (
                  <div key={att.id} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-mac-border/60 bg-white/5 px-2 text-[11px] text-mac-text-muted/80">
                    <FileText size={11} className="shrink-0 text-mac-text-muted/60" />
                    <span className="max-w-[120px] truncate">{att.name}</span>
                    <button type="button" onClick={() => removeAttachment(att.id)} className="rounded-full p-0.5 hover:bg-white/10 transition-colors" aria-label={`移除 ${att.name}`}>
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 文本输入区 */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onPaste={handlePaste}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className="w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-mac-text-muted/40 disabled:opacity-50"
          style={{ minHeight: '22px', maxHeight: '200px' }}
          autoFocus={autoFocus}
        />

        {/* 选择器行：模式 + 配置选项 */}
        {hasSelectors && (
          <div className="flex items-center gap-1.5 flex-wrap px-2.5 pb-1.5">
            {/* 模式选择器 */}
            {hasModes && availableModes && onModeChange && (
              <SelectorDropdown
                label={availableModes.find((m) => m.modeId === currentModeId)?.name ?? '模式'}
                options={availableModes.map((m) => ({ id: m.modeId, label: m.name, description: m.description }))}
                value={currentModeId ?? undefined}
                onChange={onModeChange}
                disabled={disabled}
              />
            )}
            {/* 配置选项选择器 */}
            {hasConfigOptions && dedupedConfigOptions?.map((opt) => (
              <SelectorDropdown
                key={opt.id}
                label={opt.options.find((v) => v.value === opt.currentValue)?.name ?? opt.name}
                options={opt.options.map((v) => ({ id: v.value, label: v.name, description: v.description }))}
                value={opt.currentValue}
                onChange={(valueId) => onConfigOptionChange?.(opt.id, valueId)}
                disabled={disabled}
              />
            ))}
          </div>
        )}

        {/* 底部工具栏 */}
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1.5">
          <div className="flex items-center gap-1.5 shrink-0">
            <PlusMenu
              disabled={disabled}
              skillItems={skills}
              onPickFile={() => void handlePickFiles()}
              onPickImage={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.multiple = true; input.accept = 'image/*';
                input.onchange = () => { void addImageAttachments(Array.from(input.files ?? [])); };
                input.click();
              }}
              onPickSkill={insertSkillMention}
            />
            {onPermissionPolicyChange && (
              <ApprovalSelector
                value={permissionPolicy ?? 'tiered'}
                onChange={onPermissionPolicyChange}
                disabled={disabled}
              />
            )}
          </div>

          <div className="flex min-w-0 items-center gap-1.5">
            {bottomToolbarTrailing}
            <div className="relative h-7 w-7 shrink-0">
              <AnimatePresence mode="wait" initial={false}>
                {isPrompting && onCancel ? (
                  <m.button
                    key="stop"
                    type="button"
                    onClick={onCancel}
                    title="停止生成"
                    aria-label="停止生成"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12, ease: 'easeOut' }}
                    className="absolute inset-0 flex items-center justify-center rounded-[6px] border border-mac-border bg-mac-elevated text-mac-red transition-colors hover:bg-mac-red/10 hover:border-mac-red/40 active:scale-[0.95]"
                  >
                    <Square size={12} fill="currentColor" />
                  </m.button>
                ) : (
                  <m.button
                    key="send"
                    type="button"
                    onClick={handleSend}
                    disabled={!canSend}
                    title="发送 (Enter)"
                    aria-label="发送"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12, ease: 'easeOut' }}
                    className="absolute inset-0 flex items-center justify-center rounded-[6px] bg-mac-blue text-white transition-colors hover:bg-mac-blue/90 active:scale-[0.95] disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <Send size={14} />
                  </m.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* 拖拽覆盖层 */}
        {showDragOverlay && (
          <div className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-[8px] border border-dashed border-mac-blue/50 bg-mac-blue/8">
            <span className="text-[12px] text-mac-blue/80">松开以添加文件</span>
          </div>
        )}
      </div>

      {/* 图片预览浮层 */}
      <AnimatePresence>
        {previewImage && (
          <m.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setPreviewImage(null)}
          >
            <m.div
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="relative max-h-[85vh] max-w-[85vw]"
              onClick={(e) => e.stopPropagation()}
            >
              <img src={`data:${previewImage.mimeType};base64,${previewImage.data}`} alt={previewImage.name} className="max-h-[85vh] max-w-[85vw] rounded-[10px] object-contain shadow-2xl" />
              <button type="button" onClick={() => setPreviewImage(null)} className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-mac-elevated border border-mac-border text-mac-text-muted hover:text-white transition-colors shadow-lg">
                <X size={14} />
              </button>
              <div className="mt-2 text-center text-[11px] text-white/60">{previewImage.name}</div>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── 子组件 ────────────────────────────────────────────────────

/** 通用上拉菜单行 */
function MenuRow({ icon, label, description, onClick }: {
  icon?: React.ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-mac-text-muted/80 transition-colors hover:bg-white/5"
    >
      {icon ? <span className="shrink-0 text-mac-text-muted/60">{icon}</span> : null}
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{label}</span>
        {description ? <span className="truncate text-[10px] text-mac-text-muted/40">{description}</span> : null}
      </span>
    </button>
  );
}

/** 「+」内容菜单：添加文件 / 添加照片 / Skill 二级列表（向上展开）。 */
function PlusMenu({ disabled, skillItems, onPickFile, onPickImage, onPickSkill }: {
  disabled?: boolean;
  skillItems: { id: string; label: string; description?: string }[];
  onPickFile: () => void;
  onPickImage: () => void;
  onPickSkill: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  // 二级浮层用 portal 渲染到 body，避开左侧时间线面板的 stacking context 遮挡。
  const [flyoutPos, setFlyoutPos] = useState<{ right: number; bottom: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const skillBtnRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      // 浮层经 portal 渲染在 ref 之外，需单独豁免，否则点击技能项会先关闭菜单。
      if (ref.current?.contains(target) || flyoutRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 主菜单收起时一并收起二级浮层，避免下次打开残留展开态。
  useEffect(() => {
    if (!open) setSkillOpen(false);
  }, [open]);

  const closeAll = () => { setOpen(false); setSkillOpen(false); };

  const toggleSkill = () => {
    setSkillOpen((v) => {
      const next = !v;
      if (next && skillBtnRef.current) {
        const rect = skillBtnRef.current.getBoundingClientRect();
        // 浮层右边缘贴在 Skill 行左侧（向左上展开），底部与该行对齐。
        setFlyoutPos({
          right: Math.round(window.innerWidth - rect.left + 6),
          bottom: Math.round(window.innerHeight - rect.bottom),
        });
      }
      return next;
    });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="添加内容"
        title="添加文件、照片或 Skill（也可拖拽/粘贴）"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex h-6 w-6 items-center justify-center rounded-[6px] text-mac-text-muted/60 transition-colors hover:bg-white/8 hover:text-mac-text-muted/80 disabled:opacity-40 disabled:pointer-events-none"
      >
        <Plus size={15} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 min-w-[200px] rounded-[8px] border border-mac-border bg-mac-elevated py-1 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <MenuRow icon={<FileText size={13} />} label="添加文件" onClick={() => { onPickFile(); closeAll(); }} />
          <MenuRow icon={<ImageIcon size={13} />} label="添加照片" onClick={() => { onPickImage(); closeAll(); }} />
          {skillItems.length > 0 && (
            <>
              <div className="my-1 h-px bg-mac-border/60" />
              <div className="relative">
                <button
                  ref={skillBtnRef}
                  type="button"
                  onClick={toggleSkill}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    skillOpen ? 'bg-white/5 text-mac-text-muted' : 'text-mac-text-muted/80 hover:bg-white/5'
                  }`}
                >
                  <Sparkles size={13} className="shrink-0 text-mac-text-muted/60" />
                  <span className="flex-1 truncate">Skill</span>
                  <ChevronRight size={13} className="shrink-0 text-mac-text-muted/40" />
                </button>
                {skillOpen && flyoutPos &&
                  createPortal(
                    <div
                      ref={flyoutRef}
                      className="fixed z-[9999] min-w-[200px] max-h-[260px] overflow-y-auto rounded-[8px] border border-mac-border bg-mac-elevated py-1 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
                      style={{ right: flyoutPos.right, bottom: flyoutPos.bottom }}
                    >
                      {skillItems.map((s) => (
                        <MenuRow
                          key={s.id}
                          label={s.label}
                          description={s.description}
                          onClick={() => { onPickSkill(s.id); closeAll(); }}
                        />
                      ))}
                    </div>,
                    document.body,
                  )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 审批模式选择 pill（Codex 风格，向上展开）。 */
function ApprovalSelector({ value, onChange, disabled }: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const active = APPROVAL_OPTIONS.find((o) => o.id === value) ?? APPROVAL_OPTIONS[1];
  const ActiveIcon = active.Icon;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="审批模式"
        title="审批模式"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors disabled:opacity-40 ${
          active.caution
            ? 'border-mac-red/40 bg-mac-red/8 text-mac-red hover:bg-mac-red/12'
            : 'border-mac-border/60 bg-white/5 text-mac-text-muted/80 hover:bg-white/8'
        }`}
      >
        <ActiveIcon size={12} className={active.caution ? 'text-mac-red' : 'text-mac-text-muted/70'} />
        <span className="max-w-[88px] truncate">{active.label}</span>
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-[280px] rounded-[10px] border border-mac-border bg-mac-elevated p-1 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <div className="px-2.5 py-1.5 text-[11px] text-mac-text-muted/50">应如何批准操作?</div>
          {APPROVAL_OPTIONS.map((opt) => {
            const Icon = opt.Icon;
            const selected = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => { onChange(opt.id); setOpen(false); }}
                className="flex w-full items-start gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors hover:bg-white/5"
              >
                <Icon size={15} className={`mt-0.5 shrink-0 ${opt.caution ? 'text-mac-red' : 'text-mac-text-muted/70'}`} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[12px] font-medium text-foreground">{opt.label}</span>
                  <span className="text-[11px] text-mac-text-muted/50">{opt.description}</span>
                </span>
                {selected ? <Check size={14} className="mt-0.5 shrink-0 text-mac-blue" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 配置/模式选择器下拉 */
function SelectorDropdown({ label, options, value, onChange, disabled }: {
  label: string;
  options: { id: string; label: string; description?: string }[];
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex h-6 items-center gap-1 rounded-full border border-mac-border/60 bg-white/5 px-2 text-[11px] text-mac-text-muted/80 transition-colors hover:bg-white/8 disabled:opacity-40"
      >
        <span className="max-w-[100px] truncate">{label}</span>
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 min-w-[160px] max-h-[200px] overflow-y-auto rounded-[8px] border border-mac-border bg-mac-elevated shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                opt.id === value ? 'bg-mac-blue/15 text-white' : 'text-mac-text-muted/80 hover:bg-white/5'
              }`}
            >
              <div className="flex flex-col min-w-0">
                <span className="truncate">{opt.label}</span>
                {opt.description ? (
                  <span className="truncate text-[10px] text-mac-text-muted/40">{opt.description}</span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
