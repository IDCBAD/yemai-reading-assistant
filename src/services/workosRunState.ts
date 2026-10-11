import type { WorkosConnectionSettings } from './workosConnection';
import { WORKOS_INTERNAL_V2_BASE_URL } from './workosTransport';
import type { Conversation } from '../sidepanel/types';

export const UNCONFIRMED_WORKOS_SUBMIT_MESSAGE = '这个 WorkOS 会话的任务状态未确认，暂不继续发送。请在 WorkOS 查看进度，新问题可另开对话。';

/** Only block the same remote target; changing channel/agent creates a separate conversation. */
export function hasUnconfirmedWorkosRun(conversation: Conversation, connection: WorkosConnectionSettings) {
  return conversation.messages.some((message) => {
    const run = message.remoteRunUnconfirmed;
    return run && run.conversationUuid === conversation.remoteUuid
      && run.transport === connection.transport && run.agentUuid === connection.agentUuid
      && run.apiBase === WORKOS_INTERNAL_V2_BASE_URL;
  });
}
