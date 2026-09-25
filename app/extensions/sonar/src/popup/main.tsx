import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from './PopupApp';

// Popup 表面入口。已接入 DouyinClient：挂载时调用 detectCurrentPage 验证全链路连通。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);
