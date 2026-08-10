import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BorderBeam } from 'border-beam';
import type { AgentRunSummary, Conversation, DraftAttachment, OpenConversationTab, PageContext, QuoteReference } from '../types';
import { AgentRunStatus } from './AgentRunStatus';
import { KoboyoIcon } from './KoboyoIcon';

interface ComposerProps {
  tabs: OpenConversationTab[];
  conversations: Conversation[];
  activeTabId: string;
  input: string;
  quotes: QuoteReference[];
  attachments: DraftAttachment[];
  currentPage: PageContext;
  currentPageIncluded: boolean;
  currentPageIssue: string | null;
  activeConversationIds: Set<string>;
  runSummary: AgentRunSummary | null;
  historyOpen: boolean;
  tokenState: 'loading' | 'configured' | 'missing';
  fileUploadEnabled: boolean;
  maxTabs: number;
  onSelectTab: (tabId: string) => void;
  onAddTab: () => void;
  onCloseTab: (tabId: string) => void;
  onNewConversation: () => void;
  onToggleHistory: () => void;
  onInputChange: (value: string) => void;
  onRemoveQuote: (id: string) => void;
  onRemoveAttachment: (id: string) => void;
  onCurrentPageIncludedChange: (included: boolean) => void;
  onFilesSelected: (files: FileList | null) => void;
  onAttachmentUnavailable: () => void;
  onSend: () => void;
  onStop: () => void;
}

function AttachmentState({ attachment }: { attachment: DraftAttachment }) {
  if (attachment.status === 'uploading') {
    return <span className="attachment-progress" aria-label="正在上传" />;
  }
  if (attachment.status === 'failed') {
    return <span className="attachment-error" aria-label="上传失败" title={attachment.errorMessage}>!</span>;
  }
  return <KoboyoIcon name="solid-checkmark" size={12} className="attachment-ready" />;
}

interface TabMenuState {
  tabId: string;
  left: number;
  top: number;
}

export function Composer({
  tabs,
  conversations,
  activeTabId,
  input,
  quotes,
  attachments,
  currentPage,
  currentPageIncluded,
  currentPageIssue,
  activeConversationIds,
  runSummary,
  historyOpen,
  tokenState,
  fileUploadEnabled,
  maxTabs,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onNewConversation,
  onToggleHistory,
  onInputChange,
  onRemoveQuote,
  onRemoveAttachment,
  onCurrentPageIncludedChange,
  onFilesSelected,
  onAttachmentUnavailable,
  onSend,
  onStop,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const tabButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);
  const [contextExpanded, setContextExpanded] = useState(false);
  const canAddTab = tabs.length < maxTabs;
  const contextItemCount = quotes.length + attachments.length;
  const visibleQuotes = contextExpanded ? quotes : quotes.slice(-1);
  const visibleAttachments = contextExpanded ? attachments : attachments.slice(-1);
  const hasContent =
    input.trim().length > 0 ||
    quotes.length > 0 ||
    attachments.some((attachment) => attachment.status === 'ready');
  const hasUploadingAttachments = attachments.some((attachment) => attachment.status === 'uploading');
  const canSend = hasContent && !hasUploadingAttachments;
  const composerState = [
    runSummary ? 'is-running' : 'is-idle',
    contextItemCount > 0 ? 'has-context' : '',
    hasContent ? 'has-content' : '',
  ].filter(Boolean).join(' ');

  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setTabMenu(null);
      }
    };
    const focusFrame = window.requestAnimationFrame(() => {
      tabMenuRef.current?.querySelector('button')?.focus();
    });
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [tabMenu]);

  useEffect(() => {
    tabButtonsRef.current.get(activeTabId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  useEffect(() => {
    if (contextItemCount <= 1) setContextExpanded(false);
  }, [contextItemCount]);

  const openTabMenu = (tabId: string, target: HTMLButtonElement) => {
    const bounds = target.getBoundingClientRect();
    const menuWidth = 132;
    const menuHeight = 42;
    const gutter = 8;
    const top = bounds.top >= menuHeight + gutter
      ? bounds.top - menuHeight - 4
      : Math.min(window.innerHeight - menuHeight - gutter, bounds.bottom + 4);
    setTabMenu({
      tabId,
      left: Math.max(gutter, Math.min(bounds.left, window.innerWidth - menuWidth - gutter)),
      top,
    });
  };

  return (
    <section className={`composer ${composerState}`} aria-label="消息输入工作台">
      <BorderBeam
        className="composer-beam"
        size="md"
        colorVariant="colorful"
        theme="light"
        strength={1}
        duration={3.1}
        brightness={1.65}
        saturation={1.8}
        hueRange={70}
        active={Boolean(runSummary)}
        borderRadius={16}
      >
        <div className="composer-deck">
        <div className="tab-command-row">
          <div className="tab-list" role="tablist" aria-label="已打开的独立会话">
            {tabs.map((tab, index) => {
              const conversation = conversations.find((item) => item.id === tab.conversationId);
              return (
                <button
                  ref={(element) => {
                    if (element) tabButtonsRef.current.set(tab.id, element);
                    else tabButtonsRef.current.delete(tab.id);
                  }}
                  className={`workspace-tab pressable${tab.id === activeTabId ? ' is-active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeTabId}
                  aria-haspopup="menu"
                  title={`${conversation?.title ?? '新的阅读对话'}，右键关闭`}
                  onClick={() => onSelectTab(tab.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openTabMenu(tab.id, event.currentTarget);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault();
                      openTabMenu(tab.id, event.currentTarget);
                    }
                  }}
                  key={tab.id}
                >
                  <span>{index + 1}</span>
                  {activeConversationIds.has(tab.conversationId) && (
                    <i className="tab-stream-dot" aria-label="正在生成" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="workbench-actions" aria-label="会话与标签页操作">
            <button
              className="workbench-button pressable"
              type="button"
              onClick={onAddTab}
              aria-label={canAddTab ? '新增独立会话标签页' : `最多打开 ${maxTabs} 个标签页`}
              title={canAddTab ? '新增独立会话标签页' : `最多打开 ${maxTabs} 个标签页，请先关闭一个`}
              disabled={!canAddTab}
            >
              <KoboyoIcon name="plus" size={16} />
            </button>
            <button className="workbench-button pressable" type="button" onClick={onNewConversation} aria-label="在当前标签中新建对话" title="在当前标签中新建对话">
              <KoboyoIcon name="message-square-plus" size={17} />
            </button>
            <button
              className={`workbench-button pressable${historyOpen ? ' is-active' : ''}`}
              type="button"
              onClick={onToggleHistory}
              aria-label="查看历史会话"
              title="历史会话"
              aria-expanded={historyOpen}
            >
              <KoboyoIcon name="solid-history" size={17} />
            </button>
          </div>
        </div>

        {currentPage.url && (
          <div
            className={`current-page-context current-page-context--${currentPage.status}${currentPageIssue ? ' has-issue' : ''}${currentPageIncluded ? '' : ' is-excluded'}`}
            aria-label={currentPageIncluded ? '本次提问引用的当前页面' : '当前页面未加入本次提问'}
            aria-live="polite"
          >
            <KoboyoIcon name="globe" size={14} />
            <span className="current-page-copy">
              <small>{!currentPageIncluded ? '未引用' : currentPageIssue ? '当前页未能读取' : currentPage.status === 'reading' ? '正在准备当前页' : '当前页'}</small>
              <strong title={`${currentPage.title} · ${currentPage.site}`}>{currentPage.title}</strong>
            </span>
            {currentPageIncluded && currentPage.status === 'reading' && <span className="page-context-progress" aria-hidden="true" />}
            <button
              className="current-page-toggle pressable"
              type="button"
              onClick={() => onCurrentPageIncludedChange(!currentPageIncluded)}
              aria-label={currentPageIncluded ? '取消引用当前页' : '恢复引用当前页'}
              aria-pressed={currentPageIncluded}
              title={currentPageIncluded ? '取消引用' : '恢复引用'}
            >
              <KoboyoIcon name={currentPageIncluded ? 'link' : 'link-off'} size={15} />
            </button>
          </div>
        )}

        {contextItemCount > 0 && (
          <div className={`draft-context${contextExpanded ? ' is-expanded' : ''}`} aria-label="待发送的引用和附件">
            <div className="draft-context-header">
              <span className="draft-context-summary">
                {quotes.length > 0 && `已引用 ${quotes.length} 段`}
                {quotes.length > 0 && attachments.length > 0 && ' · '}
                {attachments.length > 0 && `${attachments.length} 个附件`}
              </span>
              {contextItemCount > 1 && (
                <button
                  className="draft-context-toggle pressable"
                  type="button"
                  onClick={() => setContextExpanded((expanded) => !expanded)}
                  aria-expanded={contextExpanded}
                >
                  {contextExpanded ? '收起' : '查看全部'}
                </button>
              )}
            </div>
            <div className="draft-context-list">
            {visibleQuotes.map((quote) => (
              <div className="draft-chip draft-chip--quote" key={quote.id}>
                <KoboyoIcon name="quote" size={13} />
                <span className="draft-chip-copy">
                  <strong title={quote.pageTitle}>{quote.pageTitle}</strong>
                  <span title={quote.text}>{quote.text}</span>
                </span>
                <button className="chip-remove pressable" type="button" onClick={() => onRemoveQuote(quote.id)} aria-label={`删除引用：${quote.text}`}>
                  <KoboyoIcon name="cross" size={11} />
                </button>
              </div>
            ))}
            {visibleAttachments.map((attachment) => (
              <div className="draft-chip draft-chip--file" key={attachment.id}>
                <KoboyoIcon name="file" size={13} />
                <span className="draft-chip-copy">
                  <strong>附件 · {attachment.sizeLabel}</strong>
                  <span title={attachment.filename}>{attachment.filename}</span>
                </span>
                <AttachmentState attachment={attachment} />
                <button className="chip-remove pressable" type="button" onClick={() => onRemoveAttachment(attachment.id)} aria-label={`删除附件：${attachment.filename}`}>
                  <KoboyoIcon name="cross" size={11} />
                </button>
              </div>
            ))}
            </div>
          </div>
        )}

        <div className="composer-input-wrap">
          <textarea
            name="agent-question"
            autoComplete="off"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSend) onSend();
              }
            }}
            placeholder={quotes.length > 0
              ? `针对已引用的 ${quotes.length} 段内容提问…`
              : '继续追问，或引用新的内容…'}
            rows={2}
            aria-label="输入问题"
          />
          <div className="composer-toolbar">
            <div className="composer-tools">
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                tabIndex={-1}
                aria-hidden="true"
                name="attachments"
                accept=".pdf,.doc,.docx,.txt,.md,image/*"
                multiple
                onChange={(event) => {
                  onFilesSelected(event.target.files);
                  event.currentTarget.value = '';
                }}
              />
              <button
                className="composer-tool pressable"
                type="button"
                onClick={() => {
                  if (fileUploadEnabled) fileInputRef.current?.click();
                  else onAttachmentUnavailable();
                }}
                aria-label={fileUploadEnabled ? '添加附件' : '添加附件，需要先配置 Token'}
                title={fileUploadEnabled ? '添加附件' : '添加附件，需要先配置 Token'}
              >
                <KoboyoIcon name="paperclip" size={17} />
              </button>
              {!currentPage.url && currentPageIssue && (
                <span className="page-reference-unavailable" title={currentPageIssue}>当前页不可读取</span>
              )}
              <span className={`composer-scope composer-scope--${tokenState}`}>
                <i aria-hidden="true" />
                {tokenState === 'loading' ? '读取配置' : tokenState === 'configured' ? 'Token 已配置' : '需要 Token'}
                {' · '}Tab {tabs.findIndex((tab) => tab.id === activeTabId) + 1}/{maxTabs}
              </span>
            </div>
            <div className="composer-status-actions">
              <AgentRunStatus summary={runSummary} />
              {runSummary && (
                <button className="stop-button pressable" type="button" onClick={onStop} aria-label="停止当前任务" title="停止当前任务">
                  <KoboyoIcon name="stop-generating-square" size={15} />
                </button>
              )}
              <button
                className="send-button pressable"
                type="button"
                onClick={onSend}
                disabled={!canSend}
                aria-label={hasUploadingAttachments ? '附件上传完成后发送' : '发送消息'}
                title={hasUploadingAttachments ? '附件上传完成后发送' : '发送消息'}
              >
                <KoboyoIcon name="send" size={17} />
              </button>
            </div>
          </div>
        </div>
        </div>
      </BorderBeam>
      {tabMenu && createPortal(
        <div
          ref={tabMenuRef}
          className="tab-context-menu"
          style={{ left: tabMenu.left, top: tabMenu.top }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCloseTab(tabMenu.tabId);
              setTabMenu(null);
            }}
          >
            <KoboyoIcon name="cross" size={12} />
            关闭标签页
          </button>
        </div>,
        document.body,
      )}
    </section>
  );
}
