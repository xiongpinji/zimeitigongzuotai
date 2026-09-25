import React from 'react';
import { createRoot } from 'react-dom/client';
import { OverlayProvider, ToastProvider } from './ui';
import { MotionProvider } from './ui/lib/motion';
import App from './App';
import './ui/styles/tailwind.css';
import './ui/styles/tokens.css';
import './ui/styles/base.css';

createRoot(document.getElementById('root')!).render(
  <MotionProvider>
    <OverlayProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </OverlayProvider>
  </MotionProvider>,
);
