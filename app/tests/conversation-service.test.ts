import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConversationDb } from '../electron/conversations/db';
import { ConversationRepository } from '../electron/conversations/repository';
import { ConversationService } from '../electron/conversations/service';

function createFixture() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
  const db = createConversationDb(tempDir);
  const repository = new ConversationRepository(db);
  const service = new ConversationService(repository);
  return { tempDir, db, repository, service };
}

describe('ConversationService', () => {
  const fixtures: Array<{ tempDir: string; db: { close: () => void } }> = [];

  afterEach(() => {
    vi.useRealTimers();
    while (fixtures.length > 0) {
      const fixture = fixtures.pop();
      if (fixture) {
        fixture.db.close();
        rmSync(fixture.tempDir, { recursive: true, force: true });
      }
    }
  });

  it('persists and lists conversations by project', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const created = fixture.service.createConversation({
      projectId: 'p1',
      agentType: 'claude-acp',
    });

    const list = fixture.service.listConversations('p1');
    expect(list[0]?.id).toBe(created.id);
    expect(list[0]?.projectId).toBe('p1');
    expect(list[0]?.status).toBe('draft_local');
    expect(list[0]?.title).toContain('新会话');

    const detail = fixture.service.getConversationDetail(created.id);
    expect(detail?.id).toBe(created.id);
    expect(detail?.externalId).toBeNull();
    expect(detail?.parentId).toBeNull();
  });

  it('stores opened conversation per project', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const first = fixture.service.createConversation({
      projectId: 'p-opened',
      agentType: 'claude-acp',
      title: 'first',
    });
    expect(fixture.service.getOpenedConversation('p-opened')).toBe(first.id);

    const second = fixture.service.createConversation({
      projectId: 'p-opened',
      agentType: 'claude-acp',
      title: 'second',
    });
    expect(fixture.service.getOpenedConversation('p-opened')).toBe(second.id);

    fixture.service.setOpenedConversation('p-opened', first.id);
    expect(fixture.service.getOpenedConversation('p-opened')).toBe(first.id);

    fixture.service.setOpenedConversation('p-opened', null);
    expect(fixture.service.getOpenedConversation('p-opened')).toBeNull();
  });

  it('restores only workspace summary on startup and resolves resume id only on explicit open', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const c1 = fixture.repository.createConversation({
      projectId: 'p-summary',
      title: 'has external id',
      agentType: 'claude-acp',
      status: 'active',
      externalId: 'session-resume-001',
      parentId: null,
      messageCount: 3,
      sessionStatsJson: null,
    });
    const c2 = fixture.repository.createConversation({
      projectId: 'p-summary',
      title: 'draft local',
      agentType: 'claude-acp',
      status: 'draft_local',
      externalId: null,
      parentId: null,
      messageCount: 0,
      sessionStatsJson: null,
    });
    fixture.service.setOpenedConversation('p-summary', c1.id);

    const summary = fixture.service.listConversationSummaries('p-summary');
    expect(summary.openedConversationId).toBe(c1.id);
    expect(summary.conversations.map((item) => item.id)).toEqual([c2.id, c1.id]);
    expect(summary.conversations.find((item) => item.id === c1.id)?.isOpened).toBe(true);
    expect(summary.conversations.find((item) => item.id === c2.id)?.isOpened).toBe(false);

    // 列表恢复阶段只提供记录，不在 service 内做隐式 ACP 连接动作。
    expect(summary.conversations.find((item) => item.id === c1.id)?.externalId).toBe('session-resume-001');

    const opened = fixture.service.openConversation('p-summary', c1.id);
    expect(opened.resumeExternalId).toBe('session-resume-001');
  });

  it('forks conversation with cleared external id and reset parent linkage', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const source = fixture.repository.createConversation({
      projectId: 'p-fork',
      title: 'source',
      agentType: 'claude-acp',
      status: 'active',
      externalId: 'session-123',
      parentId: null,
      messageCount: 5,
      sessionStatsJson: '{"tokens":42}',
    });

    const forked = fixture.service.forkConversation({
      sourceConversationId: source.id,
      title: 'forked',
    });

    expect(forked.id).not.toBe(source.id);
    expect(forked.projectId).toBe(source.projectId);
    expect(forked.parentId).toBe(source.id);
    expect(forked.externalId).toBeNull();
    expect(forked.status).toBe('draft_local');
    expect(forked.title).toBe('forked');
    expect(forked.messageCount).toBe(source.messageCount);
    expect(forked.sessionStatsJson).toBeNull();

    expect(fixture.service.getOpenedConversation('p-fork')).toBe(forked.id);
  });

  it('updates conversation title and status', () => {
    const fixture = createFixture();
    fixtures.push(fixture);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T09:27:10.106Z'));

    const created = fixture.service.createConversation({
      projectId: 'p-update',
      agentType: 'claude-acp',
      title: 'old title',
    });

    const updated = fixture.service.updateConversation(created.id, {
      title: 'new title',
      status: 'archived',
    });

    expect(updated.title).toBe('new title');
    expect(updated.status).toBe('archived');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(created.updatedAt).getTime(),
    );
  });

  it('only returns resumeExternalId during explicit openConversation', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const created = fixture.repository.createConversation({
      projectId: 'p-open',
      title: 'resume me',
      agentType: 'claude-acp',
      status: 'active',
      externalId: 'session-explicit',
      parentId: null,
      messageCount: 1,
      sessionStatsJson: null,
    });

    fixture.service.setOpenedConversation('p-open', created.id);
    expect(fixture.service.getOpenedConversation('p-open')).toBe(created.id);

    const resolution = fixture.service.openConversation('p-open', created.id);
    expect(resolution.conversation.id).toBe(created.id);
    expect(resolution.resumeExternalId).toBe('session-explicit');
  });

  it('appends persisted turns as block json and bumps message count', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const created = fixture.service.createConversation({
      projectId: 'p-turns',
      agentType: 'claude-acp',
      title: 'turn holder',
    });

    const userTurn = fixture.service.appendTurn('p-turns', created.id, {
      role: 'user',
      blocks: [{ type: 'text', text: '你好，开始写稿' }],
    });
    const assistantTurn = fixture.service.appendTurn('p-turns', created.id, {
      role: 'assistant',
      blocks: [
        { type: 'thinking', text: '先读取上下文' },
        {
          type: 'tool_call',
          toolCallId: 'tool-1',
          title: 'read_script',
          kind: 'mcp',
          status: 'completed',
          rawInput: '{"path":"original.md"}',
          rawOutput: '{"ok":true}',
        },
        { type: 'text', text: '已经生成初稿' },
        { type: 'turn_complete', stopReason: 'end_turn' },
      ],
      sessionStatsJson: '{"used":10,"size":100}',
    });

    expect(userTurn.turn.role).toBe('user');
    expect(userTurn.turn.blocks).toEqual([{ type: 'text', text: '你好，开始写稿' }]);
    expect(assistantTurn.turn.blocks[0]).toEqual({ type: 'thinking', text: '先读取上下文' });
    expect(assistantTurn.conversation.messageCount).toBe(2);

    const detail = fixture.service.getConversationDetail(created.id);
    expect(detail?.messageCount).toBe(2);
    expect(detail?.turns).toHaveLength(2);
    expect(detail?.turns[1]?.blocks).toEqual([
      { type: 'thinking', text: '先读取上下文' },
      {
        type: 'tool_call',
        toolCallId: 'tool-1',
        title: 'read_script',
        kind: 'mcp',
        status: 'completed',
        rawInput: '{"path":"original.md"}',
        rawOutput: '{"ok":true}',
      },
      { type: 'text', text: '已经生成初稿' },
      { type: 'turn_complete', stopReason: 'end_turn' },
    ]);
    expect(detail?.sessionStatsJson).toBe('{"used":10,"size":100}');
  });

  it('persists agentId and agentName on turns and reads them back', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const created = fixture.service.createConversation({
      projectId: 'p-agent-turn',
      agentType: 'claude-acp',
      title: 'agent turn test',
    });

    // Append a turn with agentId and agentName
    const result = fixture.service.appendTurn('p-agent-turn', created.id, {
      role: 'assistant',
      blocks: [{ type: 'text', text: 'hello from codex' }],
      agentId: 'codex',
      agentName: 'Codex',
    });

    expect(result.turn.agentId).toBe('codex');
    expect(result.turn.agentName).toBe('Codex');

    // Read back via detail
    const detail = fixture.service.getConversationDetail(created.id);
    expect(detail?.turns).toHaveLength(1);
    expect(detail?.turns[0]?.agentId).toBe('codex');
    expect(detail?.turns[0]?.agentName).toBe('Codex');
  });

  it('reads back undefined agentId/agentName when not provided (backward compat)', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const created = fixture.service.createConversation({
      projectId: 'p-no-agent-turn',
      agentType: 'claude-acp',
      title: 'no agent turn test',
    });

    // Append a turn without agentId/agentName
    const result = fixture.service.appendTurn('p-no-agent-turn', created.id, {
      role: 'user',
      blocks: [{ type: 'text', text: 'user message' }],
    });

    expect(result.turn.agentId).toBeUndefined();
    expect(result.turn.agentName).toBeUndefined();

    // Read back via detail
    const detail = fixture.service.getConversationDetail(created.id);
    expect(detail?.turns[0]?.agentId).toBeUndefined();
    expect(detail?.turns[0]?.agentName).toBeUndefined();
  });

  it('preserves mixed turns with and without agentId in same conversation', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const created = fixture.service.createConversation({
      projectId: 'p-mixed-turns',
      agentType: 'claude-acp',
      title: 'mixed turns test',
    });

    // Old-style turn (no agent attribution)
    fixture.service.appendTurn('p-mixed-turns', created.id, {
      role: 'user',
      blocks: [{ type: 'text', text: 'user question' }],
    });

    // New-style turn with agent attribution
    fixture.service.appendTurn('p-mixed-turns', created.id, {
      role: 'assistant',
      blocks: [{ type: 'text', text: 'claude response' }],
      agentId: 'claude-acp',
      agentName: 'Claude',
    });

    // Another new-style turn from different agent
    fixture.service.appendTurn('p-mixed-turns', created.id, {
      role: 'assistant',
      blocks: [{ type: 'text', text: 'codex response' }],
      agentId: 'codex',
      agentName: 'Codex',
    });

    const detail = fixture.service.getConversationDetail(created.id);
    expect(detail?.turns).toHaveLength(3);
    expect(detail?.turns[0]?.agentId).toBeUndefined();
    expect(detail?.turns[0]?.agentName).toBeUndefined();
    expect(detail?.turns[1]?.agentId).toBe('claude-acp');
    expect(detail?.turns[1]?.agentName).toBe('Claude');
    expect(detail?.turns[2]?.agentId).toBe('codex');
    expect(detail?.turns[2]?.agentName).toBe('Codex');
  });

  it('deletes conversation and clears opened pointer when deleting active one', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const first = fixture.service.createConversation({
      projectId: 'p-delete',
      agentType: 'claude-acp',
      title: 'first',
    });
    const second = fixture.service.createConversation({
      projectId: 'p-delete',
      agentType: 'claude-acp',
      title: 'second',
    });

    fixture.service.setOpenedConversation('p-delete', second.id);
    fixture.service.deleteConversation('p-delete', second.id);

    expect(fixture.service.getOpenedConversation('p-delete')).toBeNull();
    expect(fixture.service.getConversationDetail(second.id)).toBeNull();
    expect(fixture.service.listConversations('p-delete').map((item) => item.id)).toEqual([first.id]);
  });
});
