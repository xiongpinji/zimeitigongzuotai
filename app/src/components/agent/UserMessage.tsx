import { CopyButton } from './CopyButton';

export function UserMessage({ content }: { content: string }) {
  return (
    // group + items-end：hover 时在气泡上方露出复制按钮。
    <div className="group flex flex-col items-end gap-1 self-end max-w-[85%]">
      <div
        // userSelect:text：允许鼠标拖拽选中并手动复制。
        className="bg-mac-blue text-white rounded-2xl rounded-br-sm px-3.5 py-2 text-[13px] leading-normal whitespace-pre-wrap break-words"
        style={{ userSelect: 'text', WebkitUserSelect: 'text', cursor: 'auto' }}
      >
        {content}
      </div>
      {content ? (
        <CopyButton
          text={content}
          label="复制消息"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        />
      ) : null}
    </div>
  );
}
