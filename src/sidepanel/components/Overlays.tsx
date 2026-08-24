import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  validateAgentUuid,
  type InternalV2Credentials,
  type WorkosConnectionSettings,
} from '../../services/workosConnection';
import { YEMAI_AGENT_MD_TEMPLATE } from '../../services/recommendedAgentTemplate';
import {
  formatStorageBytes,
  formatStoragePercent,
  storageUsagePercent,
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
import { buildConversationForest, type ConversationTreeNode } from '../conversationHierarchy';
import type { Conversation, OpenConversationTab } from '../types';
import { uploadChannelCapabilities } from '../fileTypes';
import { IconTooltipButton } from './IconTooltipButton';
import { KoboyoIcon } from './KoboyoIcon';

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
              <KoboyoIcon name="trash" size={11} />
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
  const backupFileInputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

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
    setLocalError(null);
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
  const localStoragePercent = storageUsage ? storageUsagePercent(storageUsage) : 0;
  const storageTone = localStoragePercent >= 90 ? 'critical' : localStoragePercent >= 70 ? 'warning' : 'normal';
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
        window.setTimeout(() => setBackupExportState('idle'), 1_600);
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

  if (!open) return null;

  return (
    <div className="overlay-layer">
      <button className="overlay-scrim" type="button" tabIndex={-1} onClick={onClose} aria-label="关闭设置" />
      <aside className="drawer drawer--right" role="dialog" aria-label="设置" aria-modal="true">
        <div className="drawer-header">
          <div>
            <p className="eyebrow">本机设置</p>
            <h2>连接与隐私</h2>
          </div>
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
                aria-describedby="workos-agent-uuid-help"
                aria-invalid={Boolean(agentUuidError)}
              />
            </div>
            <p className="field-help" id="workos-agent-uuid-help">v1 与 v2 共用。更换后，下一条消息会连接新 Agent，并携带当前会话的可见上下文。</p>
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
              <ul>
                {uploadChannelCapabilities(draft.transport).map((capability) => (
                  <li key={capability}>
                    <KoboyoIcon name="solid-checkmark" size={10} />
                    {capability}
                  </li>
                ))}
              </ul>
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
                <p className="field-help">官方配置简单，但 WorkOS 当前的 v1 多轮流式存在已确认问题。</p>
              </>
            ) : (
              <>
                <div className="experimental-note">
                  <strong>个人实验通道</strong>
                  <p>使用 WorkOS 当前网页端协议。接口正式开放前，平台更新可能导致连接失效。</p>
                </div>
                <div className={`credential-import is-${importState}`}>
                  <div>
                    <strong>WorkOS 登录信息</strong>
                    <p>读取 3 项固定字段，只填入当前表单。</p>
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
                <p className="field-help">身份标识会在每次请求前按 WorkOS 网页端规则加密，只保存在本机扩展中。</p>
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
                {saveState === 'saving' ? '正在保存…' : saveState === 'saved' ? '已保存在本机' : '保存连接'}
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
                <p>复制到 WorkOS Agent 的最高优先级人设中，让 Agent 正确理解页脉的上下文和安全边界。</p>
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

          <section className="settings-section settings-section--row">
            <div>
              <strong>划词悬浮入口</strong>
              <p>侧边栏关闭时，划词后显示轻量入口。</p>
            </div>
            <button className={`switch pressable${bubbleEnabled ? ' is-on' : ''}`} type="button" role="switch" aria-checked={bubbleEnabled} onClick={() => onBubbleEnabledChange(!bubbleEnabled)}>
              <span />
            </button>
          </section>

          <section className="security-note">
            <KoboyoIcon name="shield-check" size={18} />
            <div>
              <strong>凭据仅在本机流转</strong>
              <p>只有主动获取时才读取 WorkOS 的 3 个固定字段；不会进入聊天正文，也不会自动保存。</p>
            </div>
          </section>

          <section className="settings-section storage-usage-section">
            <div className="storage-usage-heading">
              <strong>本地历史占用空间</strong>
              <span className={`is-${storageTone}`}>
                {storageUsage ? formatStoragePercent(localStoragePercent) : '计算中'}
              </span>
            </div>
            <div
              className={`storage-usage-track is-${storageTone}`}
              role="progressbar"
              aria-label="扩展本地存储占用"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={storageUsage ? Math.round(localStoragePercent) : undefined}
            >
              <span style={{ transform: `scaleX(${localStoragePercent / 100})` }} />
            </div>
            {storageUsage ? (
              <div className="storage-usage-meta">
                <span>会话与阅读卡片 {formatStorageBytes(storageUsage.historyBytes)} · 配置 {formatStorageBytes(storageUsage.settingsBytes)}</span>
                <span>合计 {formatStorageBytes(storageUsage.totalBytes)} / {formatStorageBytes(storageUsage.quotaBytes)}</span>
              </div>
            ) : (
              <p>{storageUsageIssue ?? '正在读取 Chrome 本地存储用量…'}</p>
            )}
            {storageUsage && storageUsageIssue && <p role="status">{storageUsageIssue}</p>}
            {storageUsage && storageUsage.legacyBackupBytes > 0 && (
              <p>迁移备份 {formatStorageBytes(storageUsage.legacyBackupBytes)}，稳定观察期结束后清理。</p>
            )}
            <p>历史使用 IndexedDB，配置使用扩展本地存储；可用空间为浏览器估算值。</p>
          </section>

          <section className="settings-section local-backup-section">
            <div className="local-backup-heading">
              <div>
                <strong>本地数据备份</strong>
                <p>把会话和阅读卡片保存为可迁移的页脉备份。</p>
              </div>
              <span>格式 v1</span>
            </div>
            {backupStatus ? (
              <dl className="local-backup-counts" aria-label="本地知识资产数量">
                <div><dt>会话</dt><dd>{new Intl.NumberFormat('zh-CN').format(backupStatus.counts.conversations)}</dd></div>
                <div><dt>消息</dt><dd>{new Intl.NumberFormat('zh-CN').format(backupStatus.counts.messages)}</dd></div>
                <div><dt>来源</dt><dd>{new Intl.NumberFormat('zh-CN').format(backupStatus.counts.sources)}</dd></div>
                <div><dt>产物</dt><dd>{new Intl.NumberFormat('zh-CN').format(backupStatus.counts.artifacts)}</dd></div>
                <div><dt>阅读卡片</dt><dd>{new Intl.NumberFormat('zh-CN').format(backupStatus.counts.readingCards)}</dd></div>
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
                  name={backupExportState === 'exporting'
                    ? 'cycle'
                    : backupExportState === 'exported'
                      ? 'solid-checkmark'
                      : 'file'}
                  size={14}
                  className={backupExportState === 'exporting' ? 'is-spinning' : ''}
                />
                {backupExportState === 'exporting'
                  ? '正在整理…'
                  : backupExportState === 'exported'
                    ? '已开始下载'
                    : backupExportState === 'error'
                      ? '重新导出'
                      : '导出页脉备份'}
              </button>
            </div>
            {(backupExportIssue || (backupStatus && backupStatusIssue)) && (
              <p className="local-backup-error" role="status">{backupExportIssue ?? backupStatusIssue}</p>
            )}
            <p className="local-backup-privacy">不包含 Token、身份 UUID、临时文件内容和当前界面状态。</p>
            <div className="local-backup-import">
              <div className="local-backup-import-heading">
                <div>
                  <strong>从备份恢复</strong>
                  <p>先检查文件和内容数量，再决定如何写入。</p>
                </div>
                <button
                  className="local-backup-file-button pressable"
                  type="button"
                  disabled={backupImportState === 'inspecting' || backupImportState === 'importing'}
                  onClick={() => backupFileInputRef.current?.click()}
                  aria-live="polite"
                >
                  <KoboyoIcon name="file" size={13} />
                  {backupImportState === 'inspecting' ? '正在检查…' : backupPreview ? '换一个文件' : '选择备份'}
                </button>
                <input
                  ref={backupFileInputRef}
                  className="local-backup-file-input"
                  type="file"
                  name="yemaiBackupFile"
                  aria-label="选择页脉备份文件"
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
                      onClick={() => setReplaceBackupConfirmOpen(true)}
                    >
                      替换全部…
                    </button>
                  </div>
                </div>
              )}
              {replaceBackupConfirmOpen && backupPreview && (
                <div className="local-backup-replace-confirm" role="alert">
                  <strong>确认替换全部本地知识？</strong>
                  <p>现有会话、消息、来源、产物和阅读卡片都会被这份备份替换；连接凭据与设置不受影响。</p>
                  <div>
                    <button className="secondary-button pressable" type="button" onClick={() => setReplaceBackupConfirmOpen(false)}>取消</button>
                    <button className="danger-confirm pressable" type="button" onClick={() => importBackup('replace')}>确认替换</button>
                  </div>
                </div>
              )}
              {backupImportIssue && <p className="local-backup-error" role="alert">{backupImportIssue}</p>}
            </div>
          </section>

          <section className="settings-section settings-section--danger">
            <strong>删除本地数据</strong>
            <p>清除会话、工作页和消息；阅读卡片与 WorkOS 后台数据会保留。</p>
            <button className="danger-button pressable" type="button" onClick={onClearHistory}>
              <KoboyoIcon name="trash" size={15} />
              清空本地历史
            </button>
          </section>
        </div>
      </aside>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel, onCancel, onConfirm }: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-layer" role="presentation">
      <button className="dialog-scrim" type="button" tabIndex={-1} onClick={onCancel} aria-label="取消删除" />
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <span className="dialog-icon" aria-hidden="true"><KoboyoIcon name="trash" size={19} /></span>
        <h2 id="confirm-title">{title}</h2>
        <p>{description}</p>
        <div className="dialog-actions">
          <button className="secondary-button pressable" type="button" onClick={onCancel}>取消</button>
          <button className="danger-confirm pressable" type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
