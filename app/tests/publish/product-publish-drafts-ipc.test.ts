import { describe, expect, it, vi } from 'vitest';
import { PRODUCT_PUBLISH_DRAFT_CHANNELS, registerProductPublishDraftIpc } from
  '../../electron/publish/product-publish-drafts-ipc';

describe('product publish draft IPC', () => {
  it('only permits the owner window, returns safe projections, and does not expose paths', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>();
    const service = {
      preview: vi.fn(async () => ({ entries: [{ accountId: 'a', platform: 'douyin',
        batchId: 'b', planId: 'p', videoVariantId: 'v', outputSha256: 'a'.repeat(64),
        commerceBlocked: false }], duplicateVersionRisks: [] })),
      stage: vi.fn(async () => ({ created: 1, existing: 0,
        preview: { entries: [], duplicateVersionRisks: [] } })),
    };
    registerProductPublishDraftIpc({
      ipc: { handle: (channel, handler) => { handlers.set(channel, handler); } },
      allowedSender: (event) => event === 'owner', service,
    });
    const preview = handlers.get(PRODUCT_PUBLISH_DRAFT_CHANNELS.preview)!;
    const stage = handlers.get(PRODUCT_PUBLISH_DRAFT_CHANNELS.stage)!;
    expect(await preview('other', [{ filePath: 'C:\\private.mp4' }]))
      .toEqual({ ok: false, code: 'forbidden' });
    expect(service.preview).not.toHaveBeenCalled();
    expect(await preview('owner', [])).toMatchObject({ ok: true, entries: [{ accountId: 'a' }] });
    expect(await stage('owner', [])).toMatchObject({ ok: true, created: 1, existing: 0 });
    expect(JSON.stringify(await preview('owner', []))).not.toContain('private.mp4');
  });

  it('maps errors to fixed codes without forwarding path or exception message', async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>();
    registerProductPublishDraftIpc({
      ipc: { handle: (channel, handler) => { handlers.set(channel, handler); } },
      allowedSender: () => true,
      service: { preview: async () => { throw Object.assign(new Error('C:\\secret'),
        { code: 'review_not_ready' }); },
      stage: async () => { throw new Error('C:\\secret'); } },
    });
    expect(await handlers.get(PRODUCT_PUBLISH_DRAFT_CHANNELS.preview)!('owner'))
      .toEqual({ ok: false, code: 'review_not_ready' });
    expect(await handlers.get(PRODUCT_PUBLISH_DRAFT_CHANNELS.stage)!('owner'))
      .toEqual({ ok: false, code: 'internal_error' });
  });
});
