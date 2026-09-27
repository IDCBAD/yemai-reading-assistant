import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  validateAgentUuid,
  type InternalV2Credentials,
  type WorkosConnectionSettings,
} from '../../services/workosConnection';
import { YEMAI_AGENT_MD_TEMPLATE } from '../../services/recommendedAgentTemplate';
import {
  formatStorageBytes,
  type LocalStorageUsage,
} from '../../services/storageUsage';
import type {
  LocalBackupExportReceipt,
  LocalBackupImportMode,
  LocalBackupImportReceipt,
  LocalBackupPreview,
  LocalBackupStatus,
} from '../../services/localBackup';
import type { WorkosTransportKind } from '../../services/workosTransport';
import {
  actionPresentation,
  clearHistoryImpact,
  replaceKnowledgeImpact,
} from '../actionSemantics';
import { buildConversationForest, type ConversationTreeNode } from '../conversationHierarchy';
import type { Conversation, OpenConversationTab } from '../types';
import { uploadChannelCapabilities } from '../fileTypes';
import { FileTypeIcon } from './FileTypeIcon';
import { IconTooltipButton } from './IconTooltipButton';
import { KoboyoIcon, type KoboyoIconName } from './KoboyoIcon';
import type { QaDirectoryState } from '../../services/obsidianQaBrowser';

interface HistoryPopoverProps {
  open: boolean;
  conversations: Conversation[];
  openTabs: OpenConversationTab[];
  activeId: string;
  maxTabs: number;
  onClose: () => void;
  onSelect: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteArchived: (id: string) => void;
  onClearArchived: () => void;
}

export function HistoryPopover({
  open,
  conversations,
  openTabs,
  activeId,
  maxTabs,
  onClose,
  onSelect,
  onArchive,
  onRestore,
  onDeleteArchived,
  onClearArchived,
}: HistoryPopoverProps) {
  const [view, setView] = useState<'active' | 'archived'>('active');
  const activeConversations = conversations.filter((conversation) => conversation.archivedAt === undefined);
  const archivedConversations = conversations.filter((conversation) => conversation.archivedAt !== undefined);
  const visibleConversations = view === 'active' ? activeConversations : archivedConversations;
  const conversationForest = buildConversationForest(visibleConversations);

  useEffect(() => {
    if (!open) return;
    setView('active');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const renderConversationNode = (node: ConversationTreeNode): ReactNode => {
    const { conversation, children } = node;
    const openIndex = openTabs.findIndex((tab) => tab.conversationId === conversation.id);
    const canOpen = view !== 'archived' && (openIndex >= 0 || openTabs.length < maxTabs);
    const detail = openIndex >= 0
      ? `${conversation.subtitle} · 已在工作页 ${openIndex + 1}`
      : !canOpen && view !== 'archived'
        ? `${conversation.subtitle} · 请先关闭一个工作页`
        : conversation.subtitle;
    return (
      <li className={`conversation-tree-node${conversation.branch ? ' is-branch' : ''}`} key={conversation.id}>
        <div className={`conversation-item${conversation.id === activeId ? ' is-active' : ''}`}>
          <button
            className="conversation-open-button"
            type="button"
            onClick={() => onSelect(conversation.id)}
            disabled={!canOpen}
            title={!canOpen && view !== 'archived' ? `最多打开 ${maxTabs} 个工作页，请先关闭一个` : undefined}
          >
            <span className="conversation-icon" aria-hidden="true">
              <KoboyoIcon name={conversation.branch ? 'fork' : 'quote'} size={14} />
            </span>
            <span className="conversation-copy">
              <strong>{conversation.title}</strong>
              <small>{detail}</small>
            </span>
            <span className="conversation-tab-count" title={`${conversation.pages.length} 个页面来源`}>
              {conversation.pages.length}
            </span>
          </button>
          <div className="conversation-row-actions">
            {view === 'active' ? (
              <IconTooltipButton
                className="conversation-row-action pressable"
                type="button"
                onClick={() => onArchive(conversation.id)}
                disabled={openIndex >= 0}
                aria-label={`归档会话：${conversation.title}`}
                tooltip={openIndex >= 0 ? '请先关闭对应工作页' : '归档'}
              >
                <KoboyoIcon name="archive" size={13} />
              </IconTooltipButton>
            ) : (
              <>
                <IconTooltipButton
                  className="conversation-row-action pressable"
                  type="button"
                  onClick={() => onRestore(conversation.id)}
                  aria-label={`恢复会话：${conversation.title}`}
                  tooltip="恢复到历史"
                >
                  <KoboyoIcon name="cycle" size={13} />
                </IconTooltipButton>
                <IconTooltipButton
                  className="conversation-row-action is-danger pressable"
                  type="button"
                  onClick={() => onDeleteArchived(conversation.id)}
                  aria-label={`永久删除会话：${conversation.title}`}
                  tooltip="永久删除本地记录"
                >
                  <KoboyoIcon name="trash" size={13} />
                </IconTooltipButton>
              </>
            )}
          </div>
        </div>
        {children.length > 0 && (
          <ol className="conversation-tree-children">
            {children.map((child) => renderConversationNode(child))}
          </ol>
        )}
      </li>
    );
  };

  return (
    <div className="history-popover-layer">
      <button className="history-scrim" type="button" tabIndex={-1} onClick={onClose} aria-label="关闭历史会话" />
      <aside className="history-popover" aria-label="历史会话">
        <div className="history-popover-header">
          <div>
            <p className="eyebrow">Sessions</p>
            <h2>历史会话</h2>
          </div>
          <span>{visibleConversations.length}</span>
        </div>
        <div className="history-filter" role="tablist" aria-label="历史会话分类">
          <button
            className={view === 'active' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={view === 'active'}
            onClick={() => setView('active')}
          >
            会话 <span>{activeConversations.length}</span>
          </button>
          <button
            className={view === 'archived' ? 'is-active' : ''}
            type="button"
            role="tab"
            aria-selected={view === 'archived'}
            onClick={() => setView('archived')}
          >
            归档 <span>{archivedConversations.length}</span>
          </button>
          {view === 'archived' && archivedConversations.length > 0 ? (
            <button className="history-clear-archived pressable" type="button" onClick={onClearArchived}>
              <KoboyoIcon name="history-clear" size={13} />
              清空已归档
            </button>
          ) : (
            <small>仅整理本地列表</small>
          )}
        </div>
        <nav className="conversation-list" aria-label="会话列表">
          {visibleConversations.length === 0 && (
            <div className="conversation-empty">
              <KoboyoIcon name="archive" size={17} />
              <span>{view === 'active' ? '还没有历史会话' : '归档中没有会话'}</span>
            </div>
          )}
          {visibleConversations.length > 0 && (
            <ol className="conversation-tree">
              {conversationForest.map((node) => renderConversationNode(node))}
            </ol>
          )}
        </nav>
      </aside>
    </div>
  );
}

interface SettingsDrawerProps {
  open: boolean;
  settings: WorkosConnectionSettings;
  connectionIssue: string | null;
  bubbleEnabled: boolean;
  storageUsage: LocalStorageUsage | null;
  storageUsageIssue: string | null;
  backupStatus: LocalBackupStatus | null;
  backupStatusIssue: string | null;
  qaDirectoryState: QaDirectoryState;
  onSaveConnection: (settings: WorkosConnectionSettings) => Promise<void>;
  onTestConnection: (settings: WorkosConnectionSettings) => Promise<void>;
  onImportWorkosCredentials: () => Promise<InternalV2Credentials>;
  onRemoveCredentials: (kind: WorkosTransportKind) => Promise<void>;
  onBubbleEnabledChange: (enabled: boolean) => void;
  onExportBackup: () => Promise<LocalBackupExportReceipt>;
  onInspectBackup: (file: File) => Promise<LocalBackupPreview>;
  onImportBackup: (file: File, mode: LocalBackupImportMode) => Promise<LocalBackupImportReceipt>;
  onClose: () => void;
  onClearHistory: () => void;
  onChooseQaDirectory: () => Promise<void>;
  onReconnectQaDirectory: () => Promise<void>;
  onDisconnectQaDirectory: () => Promise<void>;
}

export function SettingsDrawer({
  open,
  settings,
  connectionIssue,
  bubbleEnabled,
  storageUsage,
  storageUsageIssue,
  backupStatus,
  backupStatusIssue,
  qaDirectoryState,
  onSaveConnection,
  onTestConnection,
  onImportWorkosCredentials,
  onRemoveCredentials,
  onBubbleEnabledChange,
  onExportBackup,
  onInspectBackup,
  onImportBackup,
  onClose,
  onClearHistory,
  onChooseQaDirectory,
  onReconnectQaDirectory,
  onDisconnectQaDirectory,
}: SettingsDrawerProps) {
  const [showToken, setShowToken] = useState(false);
  const [draft, setDraft] = useState(settings);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [testState, setTestState] = useState<'idle' | 'testing' | 'passed' | 'error'>('idle');
  const [importState, setImportState] = useState<'idle' | 'importing' | 'imported' | 'error'>('idle');
  const [copyTemplateState, setCopyTemplateState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [backupExportState, setBackupExportState] = useState<'idle' | 'exporting' | 'exported' | 'error'>('idle');
  const [backupExportIssue, setBackupExportIssue] = useState<string | null>(null);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPreview, setBackupPreview] = useState<LocalBackupPreview | null>(null);
  const [backupImportState, setBackupImportState] = useState<'idle' | 'inspecting' | 'ready' | 'importing' | 'imported' | 'error'>('idle');
  const [backupImportIssue, setBackupImportIssue] = useState<string | null>(null);
  const [replaceBackupConfirmOpen, setReplaceBackupConfirmOpen] = useState(false);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const backupFileInputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [qaDirectoryBusy, setQaDirectoryBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setShowToken(false);
    setSaveState('idle');
    setTestState('idle');
    setImportState('idle');
    setCopyTemplateState('idle');
    setBackupExportState('idle');
    setBackupExportIssue(null);
    setBackupFile(null);
    setBackupPreview(null);
    setBackupImportState('idle');
    setBackupImportIssue(null);
    setReplaceBackupConfirmOpen(false);
    setClearHistoryConfirmOpen(false);
    setLocalError(null);
    setQaDirectoryBusy(false);
  }, [open, settings]);

  const patchDraft = (patch: Partial<WorkosConnectionSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveState('idle');
    setTestState('idle');
    setImportState('idle');
    setLocalError(null);
  };

  const submitConnection = () => {
    setSaveState('saving');
    setLocalError(null);
    void onSaveConnection(draft)
      .then(() => setSaveState('saved'))
      .catch((error: unknown) => {
        setSaveState('error');
        setLocalError(error instanceof Error ? error.message : 'Token 保存失败。');
      });
  };

  const testConnection = () => {
    setTestState('testing');
    setLocalError(null);
    void onTestConnection(draft)
      .then(() => setTestState('passed'))
      .catch((error: unknown) => {
        setTestState('error');
        setLocalError(error instanceof Error ? error.message : '连接测试失败。');
      });
  };

  const importWorkosCredentials = () => {
    setImportState('importing');
    setSaveState('idle');
    setTestState('idle');
    setLocalError(null);
    void onImportWorkosCredentials()
      .then((credentials) => {
        setDraft((current) => ({ ...current, internalV2: credentials }));
        setImportState('imported');
      })
      .catch((error: unknown) => {
        setImportState('error');
        setLocalError(error instanceof Error ? error.message : 'WorkOS 登录信息读取失败。');
      });
  };

  const agentUuidError = draft.agentUuid.trim() ? validateAgentUuid(draft.agentUuid) : null;
  const activeConfigured = validateAgentUuid(draft.agentUuid) === null && (draft.transport === 'public-v1'
    ? Boolean(draft.publicApiToken.trim())
    : Boolean(
        draft.internalV2.accessToken.trim()
        && draft.internalV2.userUuid.trim()
        && draft.internalV2.organizationUuid.trim(),
      ));

  const copyAgentTemplate = async () => {
    try {
      await navigator.clipboard.writeText(YEMAI_AGENT_MD_TEMPLATE);
      setCopyTemplateState('copied');
      window.setTimeout(() => setCopyTemplateState('idle'), 1600);
    } catch {
      setCopyTemplateState('error');
      window.setTimeout(() => setCopyTemplateState('idle'), 2000);
    }
  };

  const exportBackup = () => {
    setBackupExportState('exporting');
    setBackupExportIssue(null);
    void onExportBackup()
      .then(() => {
        setBackupExportState('exported');
        window.setTimeout(() => setBackupExportState('idle'), 800);
      })
      .catch((error: unknown) => {
        setBackupExportState('error');
        setBackupExportIssue(error instanceof Error ? error.message : '本地备份导出失败，请重试。');
      });
  };

  const inspectBackup = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    setBackupFile(file);
    setBackupPreview(null);
    setBackupImportIssue(null);
    setReplaceBackupConfirmOpen(false);
    if (!file) {
      setBackupImportState('idle');
      return;
    }
    setBackupImportState('inspecting');
    void onInspectBackup(file)
      .then((preview) => {
        setBackupPreview(preview);
        setBackupImportState('ready');
      })
      .catch((error: unknown) => {
        setBackupImportState('error');
        setBackupImportIssue(error instanceof Error ? error.message : '无法读取这份备份，请换一个文件重试。');
      });
  };

  const importBackup = (mode: LocalBackupImportMode) => {
    if (!backupFile || !backupPreview) return;
    setBackupImportState('importing');
    setBackupImportIssue(null);
    setReplaceBackupConfirmOpen(false);
    void onImportBackup(backupFile, mode)
      .then(() => setBackupImportState('imported'))
      .catch((error: unknown) => {
        setBackupImportState('error');
        setBackupImportIssue(error instanceof Error ? error.message : '备份导入失败，本机数据没有改变；请重试或换一份备份。');
      });
  };

  const lastBackupLabel = backupStatus?.lastExportedAt
    ? new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(backupStatus.lastExportedAt))
    : '尚未导出';
  const backupExportPresentation = actionPresentation(
    'export-backup',
    backupExportState === 'exporting'
      ? 'working'
      : backupExportState === 'exported'
        ? 'success'
        : backupExportState,
  );
  const backupFilePresentation = actionPresentation(
    'select-backup',
    backupImportState === 'inspecting'
      ? 'working'
      : backupPreview
        ? 'success'
        : backupImportState === 'error'
          ? 'error'
          : 'idle',
  );
  const clearImpact = backupStatus ? clearHistoryImpact(backupStatus.counts) : null;
  const replaceImpact = backupStatus && backupPreview
    ? replaceKnowledgeImpact(backupStatus.counts, backupPreview.counts)
    : null;
  if (!open) return null;

  return (
    <div className="overlay-layer">
      <button className="overlay-scrim" type="button" tabIndex={-1} onClick={onClose} aria-label="关闭设置" />
      <aside className="drawer drawer--right" role="dialog" aria-label="设置" aria-modal="true">
        <div className="drawer-header">
          <h2>设置</h2>
          <button className="icon-button pressable" type="button" onClick={onClose} aria-label="关闭设置">
            <KoboyoIcon name="cross" size={16} />
          </button>
        </div>

        <div className="settings-content">
          <form
            className="settings-section"
            onSubmit={(event) => {
              event.preventDefault();
              submitConnection();
            }}
          >
            <strong>WorkOS 连接</strong>
            <label htmlFor="workos-agent-uuid">Agent UUID</label>
            <div className="agent-uuid-field">
              <input
                id="workos-agent-uuid"
                name="workosAgentUuid"
                value={draft.agentUuid}
                onChange={(event) => patchDraft({ agentUuid: event.target.value })}
                placeholder="粘贴你自己的 Agent UUID"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(agentUuidError)}
              />
            </div>
            {agentUuidError && <p className="token-error" role="alert">{agentUuidError}</p>}

            <label>连接通道</label>
            <div className="transport-picker" role="radiogroup" aria-label="WorkOS 连接通道">
              <button
                className={draft.transport === 'public-v1' ? 'is-active' : ''}
                type="button"
                role="radio"
                aria-checked={draft.transport === 'public-v1'}
                onClick={() => patchDraft({ transport: 'public-v1' })}
              >
                <strong>官方 API</strong>
                <small>v1 · 单 Token</small>
              </button>
              <button
                className={draft.transport === 'internal-v2' ? 'is-active' : ''}
                type="button"
                role="radio"
                aria-checked={draft.transport === 'internal-v2'}
                onClick={() => patchDraft({ transport: 'internal-v2' })}
              >
                <strong>实验性实时连接</strong>
                <small>v2 · 多轮流式</small>
              </button>
            </div>
            <div className="transport-capabilities" aria-label="当前连接支持的附件类型">
              <span>当前连接支持</span>
              <div className="capability-logo-loop">
                <div className="capability-logo-track">
                  {[false, true].map((duplicate) => (
                    <ul
                      className="capability-logo-group"
                      key={duplicate ? 'duplicate' : 'primary'}
                      aria-hidden={duplicate || undefined}
                    >
                      {uploadChannelCapabilities(draft.transport).map((capability) => (
                        <li key={capability.id}>
                          <span className="capability-logo-icon" aria-hidden="true">
                            <FileTypeIcon
                              filename={capability.filename}
                              mime={capability.mime}
                              variant="token"
                            />
                          </span>
                          <span>{capability.label}</span>
                        </li>
                      ))}
                    </ul>
                  ))}
                </div>
              </div>
            </div>

            {draft.transport === 'public-v1' ? (
              <>
                <label htmlFor="workos-token">WorkOS API Token</label>
                <div className="token-field">
                  <input
                    id="workos-token"
                    name="workosToken"
                    type={showToken ? 'text' : 'password'}
                    value={draft.publicApiToken}
                    onChange={(event) => patchDraft({ publicApiToken: event.target.value })}
                    placeholder="输入你的 AP_… Token"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="token-visibility pressable" type="button" onClick={() => setShowToken((value) => !value)} aria-label={showToken ? '隐藏 Token' : '显示 Token'}>
                    <KoboyoIcon name={showToken ? 'eye-off' : 'eye'} size={16} />
                  </button>
                </div>
                <p className="field-help">v1 暂不支持稳定的多轮流式对话。</p>
              </>
            ) : (
              <>
                <div className="experimental-note">
                  <p>实验功能，WorkOS 更新后可能暂时不可用。</p>
                </div>
                <div className={`credential-import is-${importState}`}>
                  <div>
                    <strong>WorkOS 登录信息</strong>
                  </div>
                  <button
                    className="credential-import-button pressable"
                    type="button"
                    disabled={importState === 'importing'}
                    onClick={importWorkosCredentials}
                    aria-live="polite"
                  >
                    <KoboyoIcon
                      name={importState === 'importing'
                        ? 'cycle'
                        : importState === 'imported'
                          ? 'solid-checkmark'
                          : importState === 'error'
                            ? 'cross'
                            : 'globe'}
                      size={13}
                      className={importState === 'importing' ? 'is-spinning' : ''}
                    />
                    <span>
                      {importState === 'importing'
                        ? '正在读取…'
                        : importState === 'imported'
                          ? '已填入'
                          : importState === 'error'
                            ? '重新获取'
                            : '从 WorkOS 获取'}
                    </span>
                  </button>
                </div>
                <label htmlFor="workos-v2-token">登录 Access Token</label>
                <div className="token-field">
                  <input
                    id="workos-v2-token"
                    name="workosV2Token"
                    type={showToken ? 'text' : 'password'}
                    value={draft.internalV2.accessToken}
                    onChange={(event) => patchDraft({
                      internalV2: { ...draft.internalV2, accessToken: event.target.value },
                    })}
                    placeholder="WorkOS 网页端 Access Token"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="token-visibility pressable" type="button" onClick={() => setShowToken((value) => !value)} aria-label={showToken ? '隐藏 Token' : '显示 Token'}>
                    <KoboyoIcon name={showToken ? 'eye-off' : 'eye'} size={16} />
                  </button>
                </div>
                <div className="identity-grid">
                  <label htmlFor="workos-user-uuid">
                    <span>User UUID</span>
                    <input
                      id="workos-user-uuid"
                      value={draft.internalV2.userUuid}
                      onChange={(event) => patchDraft({
                        internalV2: { ...draft.internalV2, userUuid: event.target.value },
                      })}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label htmlFor="workos-organization-uuid">
                    <span>Organization UUID</span>
                    <input
                      id="workos-organization-uuid"
                      value={draft.internalV2.organizationUuid}
                      onChange={(event) => patchDraft({
                        internalV2: { ...draft.internalV2, organizationUuid: event.target.value },
                      })}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                </div>
              </>
            )}
            {(localError || connectionIssue) && (
              <p className="token-error" role="alert">{localError ?? connectionIssue}</p>
            )}
            <div className="connection-actions">
              <button
                className={`secondary-button connection-test-button is-${testState} pressable`}
                type="button"
                disabled={!activeConfigured || testState === 'testing'}
                onClick={testConnection}
                aria-live="polite"
              >
                {testState === 'testing' && <KoboyoIcon name="cycle" size={13} className="is-spinning" />}
                {testState === 'passed' && <KoboyoIcon name="solid-checkmark" size={13} />}
                {testState === 'error' && <KoboyoIcon name="cross" size={13} />}
                <span>
                  {testState === 'testing'
                    ? '正在测试…'
                    : testState === 'passed'
                      ? '连接正常'
                      : testState === 'error'
                        ? '连接失败'
                        : '测试连接'}
                </span>
              </button>
              <button
                className="save-token-button pressable"
                type="submit"
                disabled={!activeConfigured || saveState === 'saving'}
              >
                {saveState === 'saving' ? '正在保存…' : saveState === 'saved' ? '已保存' : '保存连接'}
              </button>
            </div>
            {activeConfigured && (
              <button
                className="remove-token-button pressable"
                type="button"
                onClick={() => {
                  void onRemoveCredentials(draft.transport)
                    .then(() => {
                      setDraft((current) => current.transport === 'public-v1'
                        ? { ...current, publicApiToken: '' }
                        : { ...current, internalV2: { accessToken: '', userUuid: '', organizationUuid: '' } });
                      setSaveState('idle');
                      setTestState('idle');
                    })
                    .catch((error: unknown) => setLocalError(error instanceof Error ? error.message : '连接凭证移除失败。'));
                }}
              >
                移除当前通道凭证
              </button>
            )}
          </form>

          <section className="settings-section agent-template-section">
            <div className="agent-template-heading">
              <div>
                <strong>Agent.md 推荐模板</strong>
                <p>约定上下文和来源边界。使用过旧模板时请重新复制覆盖。</p>
              </div>
              <button
                className="copy-template-button pressable"
                type="button"
                onClick={() => void copyAgentTemplate()}
                aria-label={copyTemplateState === 'copied' ? 'Agent.md 模板已复制' : '复制 Agent.md 推荐模板'}
              >
                <KoboyoIcon name={copyTemplateState === 'copied' ? 'solid-checkmark' : 'copy'} size={13} />
                <span aria-live="polite">
                  {copyTemplateState === 'copied' ? '已复制' : copyTemplateState === 'error' ? '复制失败' : '复制模板'}
                </span>
              </button>
            </div>
            <details className="agent-template-preview">
              <summary>查看完整模板</summary>
              <pre><code>{YEMAI_AGENT_MD_TEMPLATE}</code></pre>
            </details>
          </section>

          <section className="settings-section qa-directory-section">
            <div className="qa-directory-heading">
              <div>
                <strong>Obsidian 问答目录</strong>
                <p>在 Obsidian 知识库中选择一个文件夹。只有你勾选收藏并点击保存，才会逐张新建 Markdown。</p>
              </div>
              <span className={`qa-directory-state is-${qaDirectoryState.kind}`}>
                {qaDirectoryState.kind === 'ready'
                  ? '已连接'
                  : qaDirectoryState.kind === 'needs-permission'
                    ? '需要授权'
                    : qaDirectoryState.kind === 'unsupported'
                      ? '不可用'
                      : qaDirectoryState.kind === 'error'
                        ? '访问失败'
                        : '未连接'}
              </span>
            </div>
            {'name' in qaDirectoryState && qaDirectoryState.name && (
              <div className="qa-directory-name"><KoboyoIcon name="file" size={14} /><span>{qaDirectoryState.name}</span></div>
            )}
            {qaDirectoryState.kind === 'unsupported' && <p role="status">当前浏览器不支持持续访问本地目录，请使用最新版 Chrome。</p>}
            {qaDirectoryState.kind === 'error' && <p className="token-error" role="alert">{qaDirectoryState.message}</p>}
            <div className="qa-directory-actions">
              {(qaDirectoryState.kind === 'unconfigured' || qaDirectoryState.kind === 'error' || qaDirectoryState.kind === 'ready') && (
                <button
                  type="button"
                  className="secondary-button pressable"
                  disabled={qaDirectoryBusy}
                  onClick={() => {
                    setQaDirectoryBusy(true);
                    void onChooseQaDirectory().catch(() => undefined).finally(() => setQaDirectoryBusy(false));
                  }}
                >{qaDirectoryBusy ? '正在选择…' : qaDirectoryState.kind === 'ready' ? '更换目录' : '选择目录'}</button>
              )}
              {qaDirectoryState.kind === 'needs-permission' && (
                <button
                  type="button"
                  className="secondary-button pressable"
                  disabled={qaDirectoryBusy}
                  onClick={() => {
                    setQaDirectoryBusy(true);
                    void onReconnectQaDirectory().catch(() => undefined).finally(() => setQaDirectoryBusy(false));
                  }}
                >{qaDirectoryBusy ? '正在授权…' : '重新授权'}</button>
              )}
              {(qaDirectoryState.kind === 'ready' || qaDirectoryState.kind === 'needs-permission') && (
                <button type="button" className="remove-token-button pressable" disabled={qaDirectoryBusy} onClick={() => void onDisconnectQaDirectory()}>
                  断开连接（保留所有文件）
                </button>
              )}
            </div>
            <p className="field-help">页脉只新建文件，不覆盖或删除现有文件。按文件内的收藏 ID 判断是否已保存；文件名使用日期和标题，同名加序号。旧目录连接不会自动迁入。</p>
          </section>

          <section className="settings-section settings-section--row">
            <div>
              <strong>划词悬浮入口</strong>
              <p>侧边栏关闭时，划词显示快捷入口。</p>
            </div>
            <button className={`switch pressable${bubbleEnabled ? ' is-on' : ''}`} type="button" role="switch" aria-checked={bubbleEnabled} onClick={() => onBubbleEnabledChange(!bubbleEnabled)}>
              <span />
            </button>
          </section>

          <section className="settings-section storage-usage-section">
            <strong>本地知识占用</strong>
            {storageUsage ? (
              <>
                <div className="storage-usage-card">
                  <div>
                    <span>已使用</span>
                    <strong>约 {formatStorageBytes(storageUsage.knowledgeBytes)}</strong>
                  </div>
                  <small>本机</small>
                </div>
                <div className="storage-usage-breakdown">
                  <span>会话与卡片 {formatStorageBytes(storageUsage.historyBytes)}</span>
                  <span>配置 {formatStorageBytes(storageUsage.settingsBytes)}</span>
                </div>
              </>
            ) : (
              <p>{storageUsageIssue ?? '正在计算本地知识占用…'}</p>
            )}
            {storageUsage && storageUsageIssue && <p role="status">{storageUsageIssue}</p>}
          </section>

          <section className="settings-section local-backup-section">
            <div className="local-backup-heading">
              <div>
                <strong>本地数据备份</strong>
                <p>这里只备份会话和收藏卡片。Obsidian 问答文件不包含在备份中，请在 Obsidian 中单独备份。</p>
              </div>
            </div>
            {backupStatus ? (
              <dl className="local-backup-counts" aria-label="本地知识资产数量">
                <div><dt>会话</dt><dd>{new Intl.NumberFormat('zh-CN').format(backupStatus.counts.conversations)}</dd></div>
                <div><dt>消息</dt><dd>{new Intl.NumberFormat('zh-CN').format(backupStatus.counts.messages)}</dd></div>
                <div><dt>来源</dt><dd>{new Intl.NumberFormat('zh-CN').format(backupStatus.counts.sources)}</dd></div>
                <div><dt>产物</dt><dd>{new Intl.NumberFormat('zh-CN').format(backupStatus.counts.artifacts)}</dd></div>
                <div><dt>收藏卡片</dt><dd>{new Intl.NumberFormat('zh-CN').format(backupStatus.counts.readingCards)}</dd></div>
              </dl>
            ) : (
              <p>{backupStatusIssue ?? '正在统计本地知识资产…'}</p>
            )}
            <div className="local-backup-action-row">
              <div>
                <span>上次导出</span>
                <strong>{lastBackupLabel}</strong>
              </div>
              <button
                className={`local-backup-export-button is-${backupExportState} pressable`}
                type="button"
                disabled={!backupStatus || backupExportState === 'exporting'}
                onClick={exportBackup}
                aria-live="polite"
              >
                <KoboyoIcon
                  name={backupExportPresentation.icon}
                  size={14}
                  className={backupExportPresentation.spinning ? 'is-spinning' : ''}
                />
                {backupExportPresentation.label}
              </button>
            </div>
            {(backupExportIssue || (backupStatus && backupStatusIssue)) && (
              <p className="local-backup-error" role="status">{backupExportIssue ?? backupStatusIssue}</p>
            )}
            <div className="local-backup-import">
              <div className="local-backup-import-heading">
                <div>
                  <strong>从备份恢复</strong>
                  <p>导入本地备份文件。</p>
                </div>
                <button
                  className="local-backup-file-button pressable"
                  type="button"
                  disabled={backupImportState === 'inspecting' || backupImportState === 'importing'}
                  onClick={() => backupFileInputRef.current?.click()}
                  aria-live="polite"
                >
                  <KoboyoIcon
                    name={backupFilePresentation.icon}
                    size={14}
                    className={backupFilePresentation.spinning ? 'is-spinning' : ''}
                  />
                  {backupFilePresentation.label}
                </button>
                <input
                  ref={backupFileInputRef}
                  className="local-backup-file-input"
                  type="file"
                  name="yemaiBackupFile"
                  aria-label="选择本地备份文件"
                  accept=".json,.yemai.json,application/json"
                  onChange={inspectBackup}
                  tabIndex={-1}
                />
              </div>
              {backupPreview && (
                <div className="local-backup-preview">
                  <div className="local-backup-preview-copy">
                    <strong title={backupPreview.filename}>{backupPreview.filename}</strong>
                    <span>
                      页脉 {backupPreview.appVersion} · {formatStorageBytes(backupPreview.bytes)} · {' '}
                      {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(backupPreview.exportedAt))}
                    </span>
                  </div>
                  <p>
                    {new Intl.NumberFormat('zh-CN').format(backupPreview.counts.conversations)} 个会话 · {' '}
                    {new Intl.NumberFormat('zh-CN').format(backupPreview.counts.messages)} 条消息 · {' '}
                    {new Intl.NumberFormat('zh-CN').format(backupPreview.counts.readingCards)} 张卡片
                  </p>
                  <div className="local-backup-import-actions">
                    <button
                      className="local-backup-merge-button pressable"
                      type="button"
                      disabled={backupImportState === 'importing' || backupImportState === 'imported'}
                      onClick={() => importBackup('merge')}
                      aria-live="polite"
                    >
                      {backupImportState === 'importing'
                        ? '正在写入…'
                        : backupImportState === 'imported'
                          ? '导入完成，即将刷新'
                          : '合并到本机'}
                    </button>
                    <button
                      className="local-backup-replace-button pressable"
                      type="button"
                      disabled={backupImportState === 'importing' || backupImportState === 'imported'}
                      aria-expanded={replaceBackupConfirmOpen}
                      aria-controls="replace-knowledge-impact"
                      onClick={() => setReplaceBackupConfirmOpen((current) => !current)}
                    >
                      替换全部…
                    </button>
                  </div>
                </div>
              )}
              {replaceBackupConfirmOpen && backupPreview && (
                <div
                  id="replace-knowledge-impact"
                  className="destructive-impact-panel"
                  role="region"
                  aria-labelledby="replace-knowledge-impact-title"
                >
                  <div className="destructive-impact-heading">
                    <span><KoboyoIcon name="database-replace" size={19} /></span>
                    <div>
                      <strong id="replace-knowledge-impact-title">替换本地数据？</strong>
                    </div>
                  </div>
                  {replaceImpact && (
                    <div className="knowledge-count-comparison" aria-label="替换前后消息数量">
                      <div><span>当前本机</span><strong>{replaceImpact.currentMessages} 条消息</strong></div>
                      <span aria-hidden="true">→</span>
                      <div><span>导入后</span><strong>{replaceImpact.incomingMessages} 条消息</strong></div>
                    </div>
                  )}
                  <dl className="destructive-impact-list">
                    <div className="is-affected"><dt>将替换</dt><dd>{replaceImpact?.affected ?? '现有本地知识资产'}</dd></div>
                    <div><dt>仍保留</dt><dd>{replaceImpact?.preserved ?? '连接设置和界面偏好'}</dd></div>
                  </dl>
                  <div className="destructive-impact-actions">
                    <button className="secondary-button pressable" type="button" onClick={() => setReplaceBackupConfirmOpen(false)}>取消</button>
                    <button className="danger-confirm pressable" type="button" onClick={() => importBackup('replace')}>替换全部知识</button>
                  </div>
                </div>
              )}
              {backupImportIssue && <p className="local-backup-error" role="alert">{backupImportIssue}</p>}
            </div>
          </section>

          <section className="settings-section settings-section--danger">
            <strong>删除本地数据</strong>
            <button
              className="danger-button pressable"
              type="button"
              aria-expanded={clearHistoryConfirmOpen}
              aria-controls="clear-history-impact"
              onClick={() => setClearHistoryConfirmOpen((current) => !current)}
            >
              <KoboyoIcon name="history-clear" size={16} />
              清空本地历史
            </button>
            {clearHistoryConfirmOpen && (
              <div
                id="clear-history-impact"
                className="destructive-impact-panel"
                role="region"
                aria-labelledby="clear-history-impact-title"
              >
                <div className="destructive-impact-heading">
                  <span><KoboyoIcon name="history-clear" size={19} /></span>
                  <div>
                    <strong id="clear-history-impact-title">清空本地历史？</strong>
                    <p>完成后会创建一个新的空会话；提问前不会出现在历史搜索中。</p>
                  </div>
                </div>
                <dl className="destructive-impact-list">
                  <div className="is-affected"><dt>将删除</dt><dd>{clearImpact?.affected ?? '全部本机会话、消息和临时资源'}</dd></div>
                  <div><dt>仍保留</dt><dd>{clearImpact?.preserved ?? '收藏卡片和连接设置'}</dd></div>
                </dl>
                <div className="destructive-impact-actions">
                  <button className="secondary-button pressable" type="button" onClick={() => setClearHistoryConfirmOpen(false)}>取消</button>
                  <button className="danger-confirm pressable" type="button" onClick={onClearHistory}>清空本地历史</button>
                </div>
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  icon: KoboyoIconName;
  title: string;
  description: string;
  affected: string;
  preserved: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  icon,
  title,
  description,
  affected,
  preserved,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialogRef.current?.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialogRef.current?.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-layer" role="presentation">
      <button className="dialog-scrim" type="button" tabIndex={-1} onClick={onCancel} aria-label="取消当前操作" />
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
      >
        <span className="dialog-icon" aria-hidden="true"><KoboyoIcon name={icon} size={19} /></span>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-description">{description}</p>
        <dl className="confirm-dialog-scope">
          <div className="is-affected"><dt>将删除</dt><dd>{affected}</dd></div>
          <div><dt>仍保留</dt><dd>{preserved}</dd></div>
        </dl>
        <div className="dialog-actions">
          <button ref={cancelRef} className="secondary-button pressable" type="button" onClick={onCancel}>取消</button>
          <button className="danger-confirm pressable" type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
