import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SidePanel } from './SidePanel';

// Side Panel：动态流 / 链接入库 / 快捷下载与分析，均通过 DouyinClient 驱动。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
