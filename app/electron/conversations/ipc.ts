import { ipcMain, type BrowserWindow } from 'electron';
import { createConversationDb, type ConversationDatabase } from './db';
import { ConversationRepository } from './repository';
import { ConversationService } from './service';
import type { AppendConversationTurnParams, UpdateConversationParams } from './service';

interface ConversationRuntime {
  db: ConversationDatabase;
  repository: ConversationRepository;
  service: ConversationService;
}

const conversationServices = new Map<string, ConversationRuntime>();

function getConversationRuntime(projectId: string): ConversationRuntime {
  const existing = conversationServices.get(projectId);
  if (existing) {
    return existing;
  }

  const db = createConversationDb(projectId);
  const repository = new ConversationRepository(db);
  const service = new ConversationService(repository);
  const runtime = { db, repository, service };
  conversationServices.set(projectId, runtime);
  return runtime;
}

export function registerConversationIpc(_getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('conversation:list', async (_event, projectId: string) => {
    const runtime = getConversationRuntime(projectId);
    return runtime.service.listConversationSummaries(projectId);
  });

  ipcMain.handle('conversation:detail', async (_event, projectId: string, conversationId: number) => {
    const runtime = getConversationRuntime(projectId);
    const detail = runtime.service.getConversationDetail(conversationId);
    if (!detail) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    return detail;
  });

  ipcMain.handle(
    'conversation:create',
    async (_event, input: { projectId: string; agentType: string; title?: string }) => {
      const runtime = getConversationRuntime(input.projectId);
      return runtime.service.createConversation(input);
    },
  );

  ipcMain.handle(
    'conversation:fork',
    async (_event, projectId: string, sourceConversationId: number, title?: string) => {
      const runtime = getConversationRuntime(projectId);
      return runtime.service.forkConversation({
        sourceConversationId,
        title,
      });
    },
  );

  ipcMain.handle(
    'conversation:update',
    async (
      _event,
      projectId: string,
      conversationId: number,
      patch: UpdateConversationParams,
    ) => {
      const runtime = getConversationRuntime(projectId);
      return runtime.service.updateConversation(conversationId, patch);
    },
  );

  ipcMain.handle('conversation:delete', async (_event, projectId: string, conversationId: number) => {
    const runtime = getConversationRuntime(projectId);
    runtime.service.deleteConversation(projectId, conversationId);
  });

  ipcMain.handle('conversation:get-opened', async (_event, projectId: string) => {
    const runtime = getConversationRuntime(projectId);
    return runtime.service.getOpenedConversation(projectId);
  });

  ipcMain.handle(
    'conversation:set-opened',
    async (_event, projectId: string, conversationId: number | null) => {
      const runtime = getConversationRuntime(projectId);
      runtime.service.setOpenedConversation(projectId, conversationId);
    },
  );

  ipcMain.handle('conversation:open', async (_event, projectId: string, conversationId: number) => {
    const runtime = getConversationRuntime(projectId);
    return runtime.service.openConversation(projectId, conversationId);
  });

  ipcMain.handle(
    'conversation:append-turn',
    async (
      _event,
      projectId: string,
      conversationId: number,
      input: AppendConversationTurnParams,
    ) => {
      const runtime = getConversationRuntime(projectId);
      return runtime.service.appendTurn(projectId, conversationId, input);
    },
  );
}
