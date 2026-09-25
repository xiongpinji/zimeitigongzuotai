import { useMemo } from 'react';
import { createChromeRuntimeTransport, createDouyinClient, type DouyinClient } from '@/client';

/** 所有 UI 表面共用：构造一次经 chrome.runtime 通信的 DouyinClient。 */
export function useClient(): DouyinClient {
  return useMemo(() => createDouyinClient(createChromeRuntimeTransport()), []);
}
