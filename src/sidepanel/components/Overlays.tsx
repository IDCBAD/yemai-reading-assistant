import { useEffect, useState } from 'react';
import type { Conversation, OpenConversationTab } from '../types';
import { KoboyoIcon } from './KoboyoIcon';

interface HistoryPopoverProps {
  open: boolean;
  conversations: Conversation[];
  openTabs: OpenConversationTab[];
  activeId: string;
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
  onClose,
  onSelect,
  onArchive,
  onRestore,
}: HistoryPopoverProps) {
  const [view, setView] = useState<'active' | 'archived'>('active');
  const activeConversations = conversations.filter((conversation) => !conversation.archivedAt);
  const archivedConversations = conversations.filter((conversation) => conversation.archivedAt);
  const visibleConversations = view === 'active' ? activeConversations : archivedConversations;

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
          {visibleConversations.map((conversation) => {
            const openIndex = openTabs.findIndex((tab) => tab.conversationId === conversation.id);
            const detail = openIndex >= 0
              ? `${conversation.subtitle} · 已在 Tab ${openIndex + 1}`
              : conversation.subtitle;
            return (
              <div
                className={`conversation-item${conversation.id === activeId ? ' is-active' : ''}`}
                key={conversation.id}
              >
                <button
                  className="conversation-open-button"
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  disabled={view === 'archived'}
                >
                  <span className="conversation-icon" aria-hidden="true">
                    <KoboyoIcon name={conversation.branch ? 'message-square-plus' : 'quote'} size={14} />
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
                    title={openIndex >= 0 ? '请先关闭对应 Tab' : '归档会话'}
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
            );
          })}
        </nav>
      </aside>
    </div>
  );
}

interface SettingsDrawerProps {
  open: boolean;
  savedToken: string;
  connectionIssue: string | null;
  bubbleEnabled: boolean;
  onSaveToken: (token: string) => Promise<void>;
  onRemoveToken: () => Promise<void>;
  onBubbleEnabledChange: (enabled: boolean) => void;
  onClose: () => void;
  onClearHistory: () => void;
}

export function SettingsDrawer({
  open,
  savedToken,
  connectionIssue,
  bubbleEnabled,
  onSaveToken,
  onRemoveToken,
  onBubbleEnabledChange,
  onClose,
  onClearHistory,
}: SettingsDrawerProps) {
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState(savedToken);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setToken(savedToken);
    setShowToken(false);
    setSaveState('idle');
    setLocalError(null);
  }, [open, savedToken]);

  const submitToken = () => {
    setSaveState('saving');
    setLocalError(null);
    void onSaveToken(token)
      .then(() => setSaveState('saved'))
      .catch((error: unknown) => {
        setSaveState('error');
        setLocalError(error instanceof Error ? error.message : 'Token 保存失败。');
      });
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
              submitToken();
            }}
          >
            <label htmlFor="workos-token">WorkOS Token</label>
            <div className="token-field">
              <input
                id="workos-token"
                name="workosToken"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  setSaveState('idle');
                  setLocalError(null);
                }}
                placeholder="输入你的 AP_… Token"
                autoComplete="off"
                spellCheck={false}
              />
              <button className="token-visibility pressable" type="button" onClick={() => setShowToken((value) => !value)} aria-label={showToken ? '隐藏 Token' : '显示 Token'}>
                <KoboyoIcon name={showToken ? 'eye-off' : 'eye'} size={16} />
              </button>
            </div>
            <p className="field-help">Token 仅保存在本机可信扩展上下文，不会发送给网页内容脚本。</p>
            {(localError || connectionIssue) && (
              <p className="token-error" role="alert">{localError ?? connectionIssue}</p>
            )}
            <button
              className="save-token-button pressable"
              type="submit"
              disabled={!token.trim() || saveState === 'saving'}
            >
              {saveState === 'saving' ? '正在保存…' : saveState === 'saved' ? '已保存在本机' : '保存 Token'}
            </button>
            {savedToken && (
              <button
                className="remove-token-button pressable"
                type="button"
                onClick={() => {
                  void onRemoveToken()
                    .then(() => {
                      setToken('');
                      setSaveState('idle');
                    })
                    .catch((error: unknown) => setLocalError(error instanceof Error ? error.message : 'Token 移除失败。'));
                }}
              >
                移除 Token
              </button>
            )}
          </form>

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
