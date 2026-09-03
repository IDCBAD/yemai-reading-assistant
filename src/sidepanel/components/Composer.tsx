import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BorderBeam } from 'border-beam';
import type { AgentRunSummary, ContextItem, Conversation, OpenConversationTab } from '../types';
import { extractClipboardImages, namePastedImages } from '../clipboardImages';
import { DraftInputBuffer } from '../draftInputBuffer';
import { AgentRunStatus } from './AgentRunStatus';
import { ContextWorkbench } from './ContextWorkbench';
import { IconTooltipButton } from './IconTooltipButton';
import { KoboyoIcon } from './KoboyoIcon';

interface ComposerProps {
  tabs: OpenConversationTab[];
  conversations: Conversation[];
  activeTabId: string;
  input: string;
  focusRequestId: number;
  contextItems: ContextItem[];
  activeConversationIds: Set<string>;
  runSummary: AgentRunSummary | null;
  historyOpen: boolean;
  connectionState: 'loading' | 'configured' | 'missing';
  fileUploadEnabled: boolean;
  fileAccept: string;
  maxTabs: number;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewConversation: () => void;
  onToggleHistory: () => void;
  onInputChange: (value: string) => void;
  onContextIncludedChange: (id: string, included: boolean) => void;
  onRemoveContextItem: (id: string) => void;
  onRetryAttachment: (id: string) => void;
  onFilesSelected: (files: File[]) => number | void;
  onAttachmentUnavailable: () => void;
  smartSelectionActive: boolean;
  onStartSmartSelection: () => void;
  onSend: (input: string) => boolean;
  onStop: () => void;
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
  focusRequestId,
  contextItems,
  activeConversationIds,
  runSummary,
  historyOpen,
  connectionState,
  fileUploadEnabled,
  fileAccept,
  maxTabs,
  onSelectTab,
  onCloseTab,
  onNewConversation,
  onToggleHistory,
  onInputChange,
  onContextIncludedChange,
  onRemoveContextItem,
  onRetryAttachment,
  onFilesSelected,
  onAttachmentUnavailable,
  smartSelectionActive,
  onStartSmartSelection,
  onSend,
  onStop,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pasteAnnouncementTimerRef = useRef<number | null>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const tabButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const inputCommitCallbackRef = useRef(onInputChange);
  const inputBufferRef = useRef<DraftInputBuffer | null>(null);
  if (!inputBufferRef.current) {
    inputBufferRef.current = new DraftInputBuffer(input, {
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: (handle) => window.clearTimeout(handle),
    });
  }
  const inputBuffer = inputBufferRef.current;
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null);
  const [pasteAnnouncement, setPasteAnnouncement] = useState('');
  const [dragDepth, setDragDepth] = useState(0);
  const [localInput, setLocalInput] = useState(input);
  inputCommitCallbackRef.current = onInputChange;

  const resetLocalInput = (value: string) => {
    inputBuffer.reset(value);
    setLocalInput(value);
  };

  const updateLocalInput = (value: string) => {
    inputBuffer.update(value, (latest) => inputCommitCallbackRef.current(latest));
    setLocalInput(value);
  };

  const canAddTab = tabs.length < maxTabs;
  const contextItemCount = contextItems.length;
  const selections = contextItems.filter((item) => item.kind === 'selection' && item.included);
  const attachments = contextItems
    .filter((item): item is Extract<ContextItem, { kind: 'file' | 'image' }> => item.kind === 'file' || item.kind === 'image')
    .map((item) => item.attachment);
  const hasContent =
    localInput.trim().length > 0 ||
    selections.length > 0 ||
    contextItems.some((item) => item.included && (item.kind === 'file' || item.kind === 'image') && item.status === 'ready');
  const hasUploadingAttachments = contextItems.some(
    (item) => item.included && (item.kind === 'file' || item.kind === 'image') && item.status === 'preparing',
  );
  const waitingForDecision = runSummary?.stage === 'waiting-user-input';
  const canSend = hasContent && !hasUploadingAttachments && !waitingForDecision;
  const isDraggingFiles = dragDepth > 0;
  const composerState = [
    runSummary ? 'is-running' : 'is-idle',
    contextItemCount > 0 ? 'has-context' : '',
    hasContent ? 'has-content' : '',
  ].filter(Boolean).join(' ');

  useLayoutEffect(() => {
    // Keep this callback tied to the tab being left. Using the latest callback
    // here could flush the previous tab's draft into the newly selected tab.
    const commitForTab = onInputChange;
    return () => {
      inputBuffer.flush(commitForTab);
    };
  }, [activeTabId]);

  useLayoutEffect(() => {
    resetLocalInput(input);
  }, [activeTabId, focusRequestId]);

  useLayoutEffect(() => {
    if (inputBuffer.syncExternal(input)) setLocalInput(input);
  }, [input]);

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
    if (focusRequestId === 0) return;
    const focusFrame = window.requestAnimationFrame(() => {
      const textarea = inputRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [focusRequestId]);

  useEffect(() => () => {
    if (pasteAnnouncementTimerRef.current !== null) {
      window.clearTimeout(pasteAnnouncementTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const clearFileDrag = () => setDragDepth(0);
    window.addEventListener('drop', clearFileDrag);
    window.addEventListener('dragend', clearFileDrag);
    window.addEventListener('blur', clearFileDrag);
    return () => {
      window.removeEventListener('drop', clearFileDrag);
      window.removeEventListener('dragend', clearFileDrag);
      window.removeEventListener('blur', clearFileDrag);
    };
  }, []);

  const announcePaste = (message: string) => {
    setPasteAnnouncement(message);
    if (pasteAnnouncementTimerRef.current !== null) {
      window.clearTimeout(pasteAnnouncementTimerRef.current);
    }
    pasteAnnouncementTimerRef.current = window.setTimeout(() => setPasteAnnouncement(''), 2200);
  };

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
        <div
          className={`composer-deck${isDraggingFiles ? ' is-dragging-files' : ''}`}
          onDragEnter={(event) => {
            if (!Array.from(event.dataTransfer.types).includes('Files')) return;
            event.preventDefault();
            setDragDepth((value) => value + 1);
          }}
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types).includes('Files')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = fileUploadEnabled ? 'copy' : 'none';
          }}
          onDragLeave={(event) => {
            if (!Array.from(event.dataTransfer.types).includes('Files')) return;
            event.preventDefault();
            setDragDepth((value) => Math.max(0, value - 1));
          }}
          onDrop={(event) => {
            if (!Array.from(event.dataTransfer.types).includes('Files')) return;
            event.preventDefault();
            setDragDepth(0);
            const files = Array.from(event.dataTransfer.files);
            if (!files.length) return;
            if (!fileUploadEnabled) {
              onAttachmentUnavailable();
              announcePaste('文件未添加，需要先配置附件上传连接。');
              return;
            }
            const addedCount = onFilesSelected(files) ?? 0;
            if (addedCount > 0) announcePaste(`已添加 ${addedCount} 个附件。`);
          }}
        >
        {isDraggingFiles && (
          <div className="composer-drop-overlay" aria-hidden="true">
            <KoboyoIcon name="paperclip" size={17} />
            <strong>{fileUploadEnabled ? '释放以加入本次提问' : '需要先配置附件上传'}</strong>
          </div>
        )}
        <div className="tab-command-row">
          <div className="tab-list" role="tablist" aria-label="已打开的会话工作页">
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
                  title={`${conversation?.branch ? `分支 ${conversation.branch.ordinal} · ` : ''}${conversation?.title ?? '新的阅读对话'}，右键关闭`}
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
                  {conversation?.branch && (
                    <KoboyoIcon name="fork" size={7} className="workspace-tab-branch" />
                  )}
                  {activeConversationIds.has(tab.conversationId) && (
                    <i className="tab-stream-dot" aria-label="正在生成" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="workbench-actions" aria-label="会话与标签页操作">
            <IconTooltipButton
              className="workbench-button pressable"
              type="button"
              onClick={onNewConversation}
              aria-label={canAddTab ? '新对话' : `最多打开 ${maxTabs} 个工作页`}
              tooltip={canAddTab ? '新对话' : `最多打开 ${maxTabs} 个工作页，请先关闭一个`}
              disabled={!canAddTab}
            >
              <KoboyoIcon name="plus" size={16} />
            </IconTooltipButton>
            <IconTooltipButton
              className={`workbench-button pressable${historyOpen ? ' is-active' : ''}`}
              type="button"
              onClick={onToggleHistory}
              aria-label="查看历史会话"
              tooltip="历史会话"
              aria-expanded={historyOpen}
            >
              <KoboyoIcon name="solid-history" size={17} />
            </IconTooltipButton>
          </div>
        </div>

        <ContextWorkbench
          items={contextItems}
          onIncludedChange={onContextIncludedChange}
          onRemove={onRemoveContextItem}
          onRetryAttachment={onRetryAttachment}
        />

        <div className="composer-input-wrap">
          <textarea
            ref={inputRef}
            name="agent-question"
            autoComplete="off"
            value={localInput}
            onChange={(event) => updateLocalInput(event.target.value)}
            onBlur={() => inputBuffer.flush((latest) => inputCommitCallbackRef.current(latest))}
            onPaste={(event) => {
              const clipboardImages = extractClipboardImages(event.clipboardData);
              if (clipboardImages.length === 0) return;

              event.preventDefault();
              if (!fileUploadEnabled) {
                onAttachmentUnavailable();
                announcePaste('图片未添加，需要先配置附件上传连接。');
                return;
              }

              const namedImages = namePastedImages(
                clipboardImages,
                attachments.map((attachment) => attachment.filename),
              );
              const addedCount = onFilesSelected(namedImages) ?? 0;
              if (addedCount > 0) {
                announcePaste(`已添加 ${addedCount} 张粘贴图片。`);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSend && onSend(inputBuffer.value)) resetLocalInput('');
              }
            }}
            placeholder={waitingForDecision
              ? '请先完成上方选择…'
              : selections.length > 0
                ? `针对已引用的 ${selections.length} 段内容提问…`
                : '继续追问，或粘贴图片提问…'}
            rows={2}
            aria-label="输入问题"
            aria-describedby="composer-paste-hint composer-paste-status"
          />
          <span className="visually-hidden" id="composer-paste-hint">支持直接粘贴剪贴板中的图片。</span>
          <span className="visually-hidden" id="composer-paste-status" aria-live="polite">{pasteAnnouncement}</span>
          <div className="composer-toolbar">
            <div className="composer-tools">
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                tabIndex={-1}
                aria-hidden="true"
                name="attachments"
                accept={fileAccept}
                multiple
                onChange={(event) => {
                  onFilesSelected(Array.from(event.target.files ?? []));
                  event.currentTarget.value = '';
                }}
              />
              <IconTooltipButton
                className="composer-tool pressable"
                type="button"
                onClick={() => {
                  if (fileUploadEnabled) fileInputRef.current?.click();
                  else onAttachmentUnavailable();
                }}
                aria-label={fileUploadEnabled ? '添加附件' : '添加附件，需要先配置当前 WorkOS 连接'}
                tooltip={fileUploadEnabled ? '添加附件' : '添加附件 · 需要连接'}
              >
                <KoboyoIcon name="paperclip" size={17} />
              </IconTooltipButton>
              <IconTooltipButton
                className={`composer-tool pressable${smartSelectionActive ? ' is-active' : ''}`}
                type="button"
                onClick={onStartSmartSelection}
                disabled={smartSelectionActive}
                aria-label={smartSelectionActive ? '正在智能框选网页内容' : '智能框选网页内容并引用'}
                tooltip={smartSelectionActive ? '移动选择内容，Esc 取消' : '截取部分'}
              >
                <KoboyoIcon name="selection" size={17} />
              </IconTooltipButton>
              {connectionState === 'missing' && (
                <span className="composer-scope composer-scope--missing" role="status">
                  <i aria-hidden="true" />
                  需要连接
                </span>
              )}
            </div>
            <div className="composer-status-actions">
              <AgentRunStatus summary={runSummary} />
              {runSummary && (
                <IconTooltipButton className="stop-button pressable" type="button" onClick={onStop} aria-label="停止当前任务" tooltip="停止生成">
                  <KoboyoIcon name="stop-generating-square" size={15} />
                </IconTooltipButton>
              )}
              <IconTooltipButton
                className="send-button pressable"
                type="button"
                onClick={() => {
                  if (canSend && onSend(inputBuffer.value)) resetLocalInput('');
                }}
                disabled={!canSend}
                aria-label={waitingForDecision ? '请先完成 Agent 提出的选择' : hasUploadingAttachments ? '附件上传完成后发送' : '发送消息'}
                tooltip={waitingForDecision ? '请先完成上方选择' : hasUploadingAttachments ? '附件上传完成后发送' : hasContent ? '发送消息' : '输入内容后发送'}
              >
                <KoboyoIcon name="send" size={17} />
              </IconTooltipButton>
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
            disabled={tabs.length === 1}
            title={tabs.length === 1 ? '至少保留一个工作页' : '关闭工作页'}
            onClick={() => {
              onCloseTab(tabMenu.tabId);
              setTabMenu(null);
            }}
          >
            <KoboyoIcon name="cross" size={12} />
            {tabs.length === 1 ? '至少保留一个工作页' : '关闭工作页'}
          </button>
        </div>,
        document.body,
      )}
    </section>
  );
}
