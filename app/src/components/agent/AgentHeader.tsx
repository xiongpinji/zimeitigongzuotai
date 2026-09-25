import { X } from 'lucide-react';
import { useAgentStore } from '../../store/agent';
import { Button } from '../../ui';

export function AgentHeader() {
  // 注意：status 由 AcpConnectionsProvider 将 active 会话状态镜像进来，
  // AgentHeader 本身挂在 provider 作用域之外，只能通过 store 读全局镜像值。
  const status = useAgentStore((s) => s.status);
  const toggleSidebar = useAgentStore((s) => s.toggleSidebar);

  const statusColor =
    status === 'connected' || status === 'prompting'
      ? '#32D74B'
      : status === 'connecting'
        ? '#FFD60A'
        : status === 'error'
          ? '#FF453A'
          : '#636366';

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-mac-separator shrink-0">
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: statusColor }}
      />
      <div className="flex-1" />
      <Button variant="ghost" size="sm" iconOnly onClick={toggleSidebar} title="关闭面板">
        <X size={14} />
      </Button>
    </div>
  );
}
