/** Narrow, owner-window-only bridge for reviewed composition publish drafts. */
import type { createProductPublishDraftService } from './product-publish-drafts';

export const PRODUCT_PUBLISH_DRAFT_CHANNELS = {
  preview: 'publish-v2:preview',
  stage: 'publish-v2:stage',
} as const;

type Service = Pick<ReturnType<typeof createProductPublishDraftService>, 'preview' | 'stage'>;
const ERROR_CODES = new Set([
  'invalid_input', 'no_project', 'account_missing', 'account_not_ready',
  'platform_mismatch', 'review_not_ready', 'video_ref_invalid', 'video_ref_changed',
  'invalid_task_input', 'idempotency_conflict', 'store_write_failed',
  'invalid_commerce_request', 'invalid_platform',
]);

export function registerProductPublishDraftIpc(deps: {
  ipc: { handle(channel: string, handler: (event: unknown, input?: unknown) => Promise<unknown>): void };
  allowedSender(event: unknown): boolean;
  service: Service;
}): void {
  const register = (channel: string, method: 'preview' | 'stage') => {
    deps.ipc.handle(channel, async (event, input) => {
      if (!deps.allowedSender(event)) return { ok: false, code: 'forbidden' };
      try { return { ok: true, ...await deps.service[method](input) }; }
      catch (error) {
        const rawCode = (error as { code?: unknown })?.code;
        return { ok: false, code: typeof rawCode === 'string' && ERROR_CODES.has(rawCode)
          ? rawCode : 'internal_error' };
      }
    });
  };
  register(PRODUCT_PUBLISH_DRAFT_CHANNELS.preview, 'preview');
  register(PRODUCT_PUBLISH_DRAFT_CHANNELS.stage, 'stage');
}
