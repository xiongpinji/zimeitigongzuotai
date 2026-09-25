import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Workbench } from './Workbench';

// 完整工作台：视频库 / 博主管理 / 工作流 / 设置，均通过 DouyinClient 驱动。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Workbench />
  </StrictMode>,
);
