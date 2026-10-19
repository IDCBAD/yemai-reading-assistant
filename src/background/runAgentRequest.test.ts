import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkosProgressDisconnected, WorkosRemoteStopAccepted, WorkosRemoteStopError } from '../services/workosTransport';
import type { WorkosConnectionSettings } from '../services/workosConnection';
import type { ChatMessage, Conversation, WorkspaceState } from '../sidepanel/types';
import { runAgentRequest, type AgentRequestHost, type SerializableAgentRequest } from './runAgentRequest';
import { WorkosSseParser, type WorkosSseCallbacks } from '../services/workosSse';
import { WORKOS_INTERNAL_V2_BASE_URL, type ExecuteRequest } from '../services/workosTransport';

const transportMock = vi.hoisted(() => ({ createWorkosTransport: vi.fn() }));
vi.mock('./createTransport', () => ({ createBackgroundTransport: transportMock.createWorkosTransport }));

const AGENT_UUID = '11111111-1111-4111-8111-111111111111';
const connection: WorkosConnectionSettings = {
  schemaVersion: 2,
  agentUuid: AGENT_UUID,
  transport: 'public-v1',
  publicApiToken: 'AP_test-token',
  internalV2: { accessToken: '', userUuid: '', organizationUuid: '' },
};

function message(id: string, role: ChatMessage['role'], status: ChatMessage['status']): ChatMessage {
  return { id, role, content: role === 'user' ? '问题' : '', createdAt: 1, status };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1', title: '会话', subtitle: '', updatedAt: 1,
    page: { title: '', site: '', url: '', status: 'not-read' }, pages: [],
    messages: [message('u1', 'user', 'complete'), message('a1', 'assistant', 'queued')],
    draftInput: '', draftContextItems: [], ...overrides,
  };
}

function workspace(initialConversation = conversation()): WorkspaceState {
  return {
    conversations: [initialConversation],
    openTabs: [{ id: 'tab1', conversationId: initialConversation.id, openedAt: 1 }],
    activeOpenTabId: 'tab1',
  };
}

function request(needsPageRead = false): SerializableAgentRequest {
  return {
    conversationId: 'c1', messageId: 'a1', userMessage: message('u1', 'user', 'complete'), needsPageRead,
    ...(needsPageRead ? { pageTarget: { tabId: 7, expectedUrl: 'https://example.com/' } } : {}),
  };
}

function createHost(initial = workspace(), extra: Partial<AgentRequestHost> = {}) {
  let state = initial;
  const host: AgentRequestHost = {
    getWorkspace: () => state,
    updateConversation: (id, updater) => {
      state = {
        ...state,
        conversations: state.conversations.map((item) => item.id === id ? updater(item) : item),
      };
    },
    discardQueued: vi.fn(() => []),
    preparePage: vi.fn(async () => ({})),
    connection,
    ...extra,
  };
  return {
    host,
    get state() { return state; },
    set state(next: WorkspaceState) { state = next; },
  };
}

function makeTransport(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'public-v1',
    createConversation: vi.fn(async () => 'remote-created'),
    executeStream: vi.fn(async (_uuid: string, _body: unknown, callbacks: { onText(text: string): void }) => callbacks.onText('回答')),
    ...overrides,
  };
}

describe('runAgentRequest background runner', () => {
  beforeEach(() => transportMock.createWorkosTransport.mockReset());

  it('does not attach replayed historical files to a later answer, while retaining a newly generated file', async () => {
    const firstFile = { id: 'material-old-1', kind: 'html' as const, filename: '旧解释.html', url: 'https://files.example.com/old-1.html', status: 'available' as const };
    const secondFile = { id: 'material-old-2', kind: 'html' as const, filename: '另一个旧解释.html', url: 'https://files.example.com/old-2.html', status: 'available' as const };
    const freshFile = { id: 'material-new', kind: 'html' as const, filename: '旧解释.html', url: 'https://files.example.com/new.html', status: 'available' as const };
    const fixture = createHost(workspace(conversation({ remoteUuid: 'remote-existing', remoteTransport: 'internal-v2', remoteAgentUuid: AGENT_UUID, remoteApiBase: WORKOS_INTERNAL_V2_BASE_URL, messages: [
      message('old-u1', 'user', 'complete'), { ...message('old-a1', 'assistant', 'complete'), artifacts: [firstFile], activities: [{ id: `part-${firstFile.id}`, kind: 'tool', title: '生成文件', status: 'completed' }] },
      message('old-u2', 'user', 'complete'), { ...message('old-a2', 'assistant', 'complete'), artifacts: [secondFile], activities: [{ id: `part-${secondFile.id}`, kind: 'tool', title: '生成文件', status: 'completed' }] },
      message('u1', 'user', 'complete'), message('a1', 'assistant', 'queued'),
    ] })));
    transportMock.createWorkosTransport.mockReturnValue(makeTransport({ kind: 'internal-v2', executeStream: vi.fn(async (_id: string, body: ExecuteRequest, callbacks: WorkosSseCallbacks) => {
      const parser = new WorkosSseParser(callbacks, { expectedRunId: 'run-current', previousToolCallIds: body.streamContext?.previousToolCallIds });
      for (const file of [firstFile, secondFile, freshFile]) {
        parser.push(`event: message\ndata: ${JSON.stringify({ data: JSON.stringify({ type: 'message.part.updated', properties: {
          part: { id: `part-${file.id}`, messageID: `message-${file.id}`, type: 'tool', state: { status: 'completed', metadata: { material: { uuid: file.id, type: 'html', filename: file.filename, url: file.url } } } },
        } }) })}\n\n`);
      }
      callbacks.onText('这是当前轮次的回答。');
    }) }));
    await runAgentRequest(request(), new AbortController().signal, fixture.host);
    const messages = fixture.state.conversations[0]!.messages;
    expect(messages.find((m) => m.id === 'a1')?.artifacts).toEqual([freshFile]);
    expect(messages.find((m) => m.id === 'old-a1')?.artifacts).toEqual([firstFile]);
    expect(messages.find((m) => m.id === 'old-a2')?.artifacts).toEqual([secondFile]);
  });

  it('preserves partial content and known tool outcomes, discarding queued questions after progress loss', async () => {
    const queued = { ...request(), messageId: 'a2', userMessage: message('u2', 'user', 'complete') };
    const fixture = createHost(workspace(conversation({ messages: [
      message('u1', 'user', 'complete'), message('a1', 'assistant', 'queued'),
      message('u2', 'user', 'complete'), message('a2', 'assistant', 'queued'),
    ] })), { discardQueued: vi.fn(() => [queued]) });
    transportMock.createWorkosTransport.mockReturnValue(makeTransport({ kind: 'internal-v2', executeStream: vi.fn(async (_id, _request, callbacks) => {
      callbacks.onText('部分回答');
      fixture.host.updateConversation('c1', (c) => ({ ...c, messages: c.messages.map((m) => m.id === 'a1' ? {
        ...m, activities: [
          { id: 'done', kind: 'tool', title: '搜索', status: 'completed', completedAt: 10 },
          { id: 'failed', kind: 'tool', title: '下载', status: 'failed', completedAt: 20 },
          { id: 'busy', kind: 'tool', title: '分析', status: 'running', startedAt: 30 },
        ],
      } : m) }));
      throw new WorkosProgressDisconnected('remote-created', 'run-1');
    }) }));
    await runAgentRequest(request(), new AbortController().signal, fixture.host);
    const answer = fixture.state.conversations[0]!.messages[1]!;
    expect(answer).toMatchObject({ content: '部分回答', status: 'stopped',
      remoteRunUnconfirmed: { conversationUuid: 'remote-created', runId: 'run-1', agentUuid: AGENT_UUID },
      errorMessage: expect.stringContaining('任务可能仍在运行') });
    expect(answer.stopStatus).toBeUndefined();
    expect(answer.activities).toEqual([
      { id: 'done', kind: 'tool', title: '搜索', status: 'completed', completedAt: 10 },
      { id: 'failed', kind: 'tool', title: '下载', status: 'failed', completedAt: 20 },
      { id: 'busy', kind: 'tool', title: '分析', status: 'stopped', startedAt: 30, progressUnconfirmed: true, completedAt: undefined },
    ]);
    expect(fixture.host.discardQueued).toHaveBeenCalledWith('c1');
    expect(fixture.state.conversations[0]!.messages[3]).toMatchObject({ status: 'stopped', errorMessage: expect.stringContaining('未发送') });
  });

  it('records an accepted remote pause without discarding queued requests', async () => {
    const queued = { ...request(), messageId: 'a2', userMessage: message('u2', 'user', 'complete') };
    const fixture = createHost(workspace(conversation({
      remoteUuid: 'remote-1', remoteTransport: 'public-v1', remoteAgentUuid: AGENT_UUID,
      messages: [message('u1', 'user', 'complete'), message('a1', 'assistant', 'streaming')],
    })), { discardQueued: vi.fn(() => [queued]) });
    const transport = makeTransport({ executeStream: vi.fn(async () => {
      fixture.host.updateConversation('c1', (current) => ({
        ...current,
        messages: current.messages.map((item) => item.id === 'a1' ? { ...item, status: 'stopped', stopStatus: 'pending' } : item),
      }));
      throw new WorkosRemoteStopAccepted();
    }) });
    transportMock.createWorkosTransport.mockReturnValue(transport);

    await runAgentRequest(request(), new AbortController().signal, fixture.host);

    const active = fixture.state.conversations[0]?.messages.find((item) => item.id === 'a1');
    expect(active).toMatchObject({ status: 'stopped', stopStatus: 'accepted' });
    expect(fixture.host.discardQueued).not.toHaveBeenCalled();
    expect(fixture.state.conversations[0]?.messages.find((item) => item.id === 'a2')).toBeUndefined();
  });

  it('marks discarded queued requests stopped when a remote pause fails', async () => {
    const queued = { ...request(), messageId: 'a2', userMessage: message('u2', 'user', 'complete') };
    const fixture = createHost(workspace(conversation({
      remoteUuid: 'remote-1', remoteTransport: 'public-v1', remoteAgentUuid: AGENT_UUID,
      messages: [message('u1', 'user', 'complete'), message('a1', 'assistant', 'streaming'), message('u2', 'user', 'complete'), message('a2', 'assistant', 'queued')],
    })), { discardQueued: vi.fn(() => [queued]) });
    const transport = makeTransport({ executeStream: vi.fn(async () => {
      fixture.host.updateConversation('c1', (current) => ({
        ...current,
        messages: current.messages.map((item) => item.id === 'a1' ? { ...item, status: 'stopped', stopStatus: 'pending' } : item),
      }));
      throw new WorkosRemoteStopError('暂停请求超时');
    }) });
    transportMock.createWorkosTransport.mockReturnValue(transport);

    await runAgentRequest(request(), new AbortController().signal, fixture.host);

    expect(fixture.host.discardQueued).toHaveBeenCalledWith('c1');
    expect(fixture.state.conversations[0]?.messages.find((item) => item.id === 'a1'))
      .toMatchObject({ status: 'stopped', stopStatus: 'failed', errorMessage: expect.stringContaining('暂停请求超时') });
    expect(fixture.state.conversations[0]?.messages.find((item) => item.id === 'a2'))
      .toMatchObject({ status: 'stopped', stopStatus: 'local-only', errorMessage: 'WorkOS 暂停未确认，此排队问题未发送。' });
  });

  it('does not submit when page preparation is aborted', async () => {
    const transport = makeTransport();
    transportMock.createWorkosTransport.mockReturnValue(transport);
    const fixture = createHost(workspace(), {
      preparePage: vi.fn((_request: SerializableAgentRequest, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
      })),
    } as Partial<AgentRequestHost>);
    const controller = new AbortController();
    const running = runAgentRequest(request(true), controller.signal, fixture.host);
    await vi.waitFor(() => expect(fixture.host.preparePage).toHaveBeenCalledOnce());
    controller.abort();
    await expect(running).resolves.toBeUndefined();
    expect(transport.createConversation).not.toHaveBeenCalled();
    expect(transport.executeStream).not.toHaveBeenCalled();
  });

  it('does not write late conversation creation results after abort', async () => {
    let resolveCreate!: (value: string) => void;
    const create = new Promise<string>((resolve) => { resolveCreate = resolve; });
    const transport = makeTransport({ createConversation: vi.fn(() => create) });
    transportMock.createWorkosTransport.mockReturnValue(transport);
    const fixture = createHost();
    const controller = new AbortController();
    const running = runAgentRequest(request(), controller.signal, fixture.host);
    await vi.waitFor(() => expect(transport.createConversation).toHaveBeenCalledOnce());
    controller.abort();
    resolveCreate('late-remote');
    await running;
    expect(fixture.state.conversations[0]?.remoteUuid).toBeUndefined();
    expect(transport.executeStream).not.toHaveBeenCalled();
  });

  it('does not recreate a conversation deleted while remote creation is pending', async () => {
    let resolveCreate!: (value: string) => void;
    const create = new Promise<string>((resolve) => { resolveCreate = resolve; });
    const transport = makeTransport({ createConversation: vi.fn(() => create) });
    transportMock.createWorkosTransport.mockReturnValue(transport);
    const fixture = createHost();
    const running = runAgentRequest(request(), new AbortController().signal, fixture.host);
    await vi.waitFor(() => expect(transport.createConversation).toHaveBeenCalledOnce());
    fixture.state = { ...fixture.state, conversations: [], openTabs: [], activeOpenTabId: '' };
    resolveCreate('late-remote');
    await running;
    expect(fixture.state.conversations).toEqual([]);
    expect(transport.executeStream).not.toHaveBeenCalled();
  });
});
