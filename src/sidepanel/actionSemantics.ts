import type { ReadingCardRow } from '../data/database';
import type { YemaiBackupCounts } from '../data/localBackup';
import type { KoboyoIconName } from './components/KoboyoIcon';

export type SemanticAction =
  | 'export-all-cards'
  | 'export-card-markdown'
  | 'export-backup'
  | 'select-backup';

export type ActionFeedbackState = 'idle' | 'working' | 'success' | 'error';

interface ActionPresentation {
  icon: KoboyoIconName;
  label: string;
  spinning: boolean;
}

const IDLE_PRESENTATIONS: Record<SemanticAction, ActionPresentation> = {
  'export-all-cards': { icon: 'card-download', label: '导出全部', spinning: false },
  'export-card-markdown': { icon: 'document-download', label: '导出 Markdown', spinning: false },
  'export-backup': { icon: 'database-download', label: '导出备份', spinning: false },
  'select-backup': { icon: 'file-upload', label: '选择备份', spinning: false },
};

const STATE_LABELS: Record<SemanticAction, Record<Exclude<ActionFeedbackState, 'idle'>, string>> = {
  'export-all-cards': { working: '正在导出…', success: '已下载', error: '重新导出' },
  'export-card-markdown': { working: '正在导出…', success: '已下载', error: '重新导出' },
  'export-backup': { working: '正在整理…', success: '已开始下载', error: '重新导出' },
  'select-backup': { working: '正在检查…', success: '换一个文件', error: '重新选择' },
};

export function actionPresentation(action: SemanticAction, state: ActionFeedbackState): ActionPresentation {
  const idle = IDLE_PRESENTATIONS[action];
  if (state === 'idle') return idle;
  return {
    icon: state === 'working' ? 'cycle' : state === 'success' ? 'solid-checkmark' : idle.icon,
    label: STATE_LABELS[action][state],
    spinning: state === 'working',
  };
}

export interface ReadingCardRemovalUndo {
  card: ReadingCardRow;
  index: number;
  expiresAt: number;
}

export function removeReadingCardForUndo(
  cards: ReadingCardRow[],
  card: ReadingCardRow,
  now: number,
): { cards: ReadingCardRow[]; undo: ReadingCardRemovalUndo } {
  const index = Math.max(0, cards.findIndex((item) => item.id === card.id));
  return {
    cards: cards.filter((item) => item.id !== card.id),
    undo: { card, index, expiresAt: now + 5_000 },
  };
}

export function restoreReadingCardFromUndo(
  cards: ReadingCardRow[],
  undo: ReadingCardRemovalUndo,
  now: number,
): ReadingCardRow[] {
  if (now > undo.expiresAt || cards.some((item) => item.id === undo.card.id)) return cards;
  const index = Math.min(undo.index, cards.length);
  return [...cards.slice(0, index), undo.card, ...cards.slice(index)];
}

export type HistoryDeletionAction =
  | { kind: 'conversation'; title: string; messageCount: number }
  | { kind: 'archived'; conversationCount: number; messageCount: number };

interface HistoryDeletionPresentation {
  icon: KoboyoIconName;
  title: string;
  description: string;
  affected: string;
  preserved: string;
  confirmLabel: string;
}

export function historyDeletionPresentation(action: HistoryDeletionAction): HistoryDeletionPresentation {
  if (action.kind === 'conversation') {
    return {
      icon: 'archive',
      title: `删除“${action.title}”？`,
      description: '删除后无法恢复。',
      affected: `该会话及 ${action.messageCount} 条消息`,
      preserved: '收藏卡片和上传文件',
      confirmLabel: '删除会话',
    };
  }
  return {
    icon: 'history-clear',
    title: `清空 ${action.conversationCount} 条已归档历史？`,
    description: '删除后无法恢复。',
    affected: `${action.conversationCount} 个归档会话及 ${action.messageCount} 条消息`,
    preserved: '其他会话和收藏卡片',
    confirmLabel: '清空已归档',
  };
}

interface InlineImpactPresentation {
  placement: 'inline';
  icon: KoboyoIconName;
  affected: string;
  preserved: string;
}

export function clearHistoryImpact(counts: YemaiBackupCounts): InlineImpactPresentation {
  return {
    placement: 'inline',
    icon: 'history-clear',
    affected: `${counts.conversations} 个会话、${counts.messages} 条消息和临时资源`,
    preserved: `${counts.readingCards} 张收藏卡片和连接设置`,
  };
}

export function replaceKnowledgeImpact(
  current: YemaiBackupCounts,
  incoming: YemaiBackupCounts,
): InlineImpactPresentation & { currentMessages: number; incomingMessages: number } {
  return {
    placement: 'inline',
    icon: 'database-replace',
    affected: `${current.conversations} 个会话、${current.messages} 条消息和 ${current.readingCards} 张收藏卡片`,
    preserved: '连接设置和界面偏好',
    currentMessages: current.messages,
    incomingMessages: incoming.messages,
  };
}
