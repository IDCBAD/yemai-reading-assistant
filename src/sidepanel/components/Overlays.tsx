import { useEffect, useState, type ReactNode } from 'react';
import { validateAgentUuid, type WorkosConnectionSettings } from '../../services/workosConnection';
import { YEMAI_AGENT_MD_TEMPLATE } from '../../services/recommendedAgentTemplate';
import type { WorkosTransportKind } from '../../services/workosTransport';
import { buildConversationForest, type ConversationTreeNode } from '../conversationHierarchy';
import type { Conversation, OpenConversationTab } from '../types';
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
}: HistoryPopoverProps) {
  const [view, setView] = useState<'active' | 'archived'>('active');
  const activeConversations = conversations.filter((conversation) => !conversation.archivedAt);
  const archivedConversations = conversations.filter((conversation) => conversation.archivedAt);
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
          {view === 'active' ? (
            <button
              className="conversation-row-action pressable"
              type="button"
              onClick={() => onArchive(conversation.id)}
              disabled={openIndex >= 0}
              aria-label={`归档会话：${conversation.title}`}
              title={openIndex >= 0 ? '请先关闭对应工作页' : '归档会话'}
            >
              <KoboyoIcon name="archive" size={13} />
            </button>
          ) : (
            <button
              className="conversation-row-action pressable"
              type="button"
              onClick={() => onRestore(conversation.id)}
              aria-label={`恢复会话：${conversation.title}`}
              title="恢复到历史会话"
            >
              <KoboyoIcon name="cycle" size={13} />
            </button>
          )}
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
          <small>仅整理本地列表</small>
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
  onSaveConnection: (settings: WorkosConnectionSettings) => Promise<void>;
  onTestConnection: (settings: WorkosConnectionSettings) => Promise<void>;
  onRemoveCredentials: (kind: WorkosTransportKind) => Promise<void>;
  onBubbleEnabledChange: (enabled: boolean) => void;
  onClose: () => void;
  onClearHistory: () => void;
}

export function SettingsDrawer({
  open,
  settings,
  connectionIssue,
  bubbleEnabled,
  onSaveConnection,
  onTestConnection,
  onRemoveCredentials,
  onBubbleEnabledChange,
  onClose,
  onClearHistory,
}: SettingsDrawerProps) {
  const [showToken, setShowToken] = useState(false);
  const [draft, setDraft] = useState(settings);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [testState, setTestState] = useState<'idle' | 'testing' | 'passed' | 'error'>('idle');
  const [copyTemplateState, setCopyTemplateState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setShowToken(false);
    setSaveState('idle');
    setTestState('idle');
    setCopyTemplateState('idle');
    setLocalError(null);
  }, [open, settings]);

  const patchDraft = (patch: Partial<WorkosConnectionSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveState('idle');
    setTestState('idle');
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
                placeholder="例如：409b06a1-…"
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
                className="secondary-button pressable"
                type="button"
                disabled={!activeConfigured || testState === 'testing'}
                onClick={testConnection}
              >
                {testState === 'testing' ? '正在测试…' : testState === 'passed' ? '连接正常' : '测试连接'}
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
              <strong>网页无法读取 Token</strong>
              <p>Token 不会发送给内容脚本，也不会进入聊天正文。</p>
            </div>
          </section>

          <section className="settings-section settings-section--danger">
            <strong>本地历史</strong>
            <p>只清除插件中的会话、Tab 和消息，不删除 WorkOS 后台数据。</p>
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
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, onCancel, onConfirm }: ConfirmDialogProps) {
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
      <button className="dialog-scrim" type="button" tabIndex={-1} onClick={onCancel} aria-label="取消清空" />
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-title">
        <span className="dialog-icon" aria-hidden="true"><KoboyoIcon name="trash" size={19} /></span>
        <h2 id="clear-title">清空本地历史？</h2>
        <p>插件中的会话、Tab 和消息会被移除，但 WorkOS 后台会话与已上传文件仍然保留。</p>
        <div className="dialog-actions">
          <button className="secondary-button pressable" type="button" onClick={onCancel}>取消</button>
          <button className="danger-confirm pressable" type="button" onClick={onConfirm}>清空本地记录</button>
        </div>
      </div>
    </div>
  );
}
