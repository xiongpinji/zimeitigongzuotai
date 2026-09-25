import { describe, it, expect } from 'vitest';
import { registerPipelineMcpTools } from '../electron/pipeline/tools/register';
import { setActiveProjectPath } from '../electron/pipeline/context';

class FakeMcpServer {
  tools = new Map<string, { def: unknown; handler: (args: unknown) => unknown }>();
  registerTool(name: string, def: unknown, handler: (args: unknown) => unknown): void {
    this.tools.set(name, { def, handler });
  }
}

function build(): FakeMcpServer {
  const server = new FakeMcpServer();
  registerPipelineMcpTools(
    server as unknown as Parameters<typeof registerPipelineMcpTools>[0],
    () => null,
    () => '/tmp/lingji-fake-userdata',
  );
  return server;
}

describe('lingji_get_active_project', () => {
  it('returns the active project path set via setActiveProjectPath', async () => {
    setActiveProjectPath('/tmp/some/project');
    const handler = build().tools.get('lingji_get_active_project')!.handler;
    const result = (await handler({})) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.projectPath).toBe('/tmp/some/project');
  });

  it('returns null when no active project', async () => {
    setActiveProjectPath(null);
    const handler = build().tools.get('lingji_get_active_project')!.handler;
    const result = (await handler({})) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.projectPath).toBeNull();
  });
});
