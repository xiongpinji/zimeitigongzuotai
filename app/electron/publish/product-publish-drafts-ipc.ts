/** Narrow, owner-window-only bridge for reviewed composition publish drafts. */
import type { createProductPublishDraftService } from './product-publish-drafts';

export const PRODUCT_PUBLISH_DRAFT_CHANNELS = {
  preview: 'publish-v2:preview',
  stage: 'publish-v2:stage',
  list: 'publish-v2:list-drafts',
  cancel: 'publish-v2:cancel-draft',
} as const;

type Service = Pick<ReturnType<typeof createProductPublishDraftService>,
  'preview' | 'stage' | 'listDrafts' | 'cancelDraft'>;
const ERROR_CODES = new Set([
  'invalid_input', 'no_project', 'account_missing', 'account_not_ready',
  'platform_mismatch', 'review_not_ready', 'video_ref_invalid', 'video_ref_changed',
  'invalid_task_input', 'idempotency_conflict', 'store_write_failed',
  'invalid_commerce_request', 'invalid_platform',
  'draft_not_found', 'draft_not_cancellable',
]);

export function registerProductPublishDraftIpc(deps: {
  ipc: { handle(channel: string, handler: (event: unknown, input?: unknown) => Promise<unknown>): void };
  allowedSender(event: unknown): boolean;
  service: Service;
}): void {
  const reply = async (event: unknown, action: () => Promise<unknown>): Promise<unknown> => {
    if (!deps.allowedSender(event)) return { ok: false, code: 'forbidden' };
    try { return { ok: true, ...await action() as object }; }
    catch (error) {
      const rawCode = (error as { code?: unknown })?.code;
      return { ok: false, code: typeof rawCode === 'string' && ERROR_CODES.has(rawCode)
        ? rawCode : 'internal_error' };
    }
  };
  deps.ipc.handle(PRODUCT_PUBLISH_DRAFT_CHANNELS.preview,
    (event, input) => reply(event, () => deps.service.preview(input)));
  deps.ipc.handle(PRODUCT_PUBLISH_DRAFT_CHANNELS.stage,
    (event, input) => reply(event, () => deps.service.stage(input)));
  deps.ipc.handle(PRODUCT_PUBLISH_DRAFT_CHANNELS.list,
    (event) => reply(event, async () => ({ drafts: await deps.service.listDrafts() })));
  deps.ipc.handle(PRODUCT_PUBLISH_DRAFT_CHANNELS.cancel,
    (event, input) => reply(event, async () => ({ cancelled: await deps.service.cancelDraft(input) })));
}
