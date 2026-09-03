import { KoboyoIcon } from './KoboyoIcon';
import { YemaiMark } from './YemaiMark';

interface TopBarProps {
  onOpenSearch: () => void;
  onOpenReadingCards: () => void;
  onOpenSettings: () => void;
  onOpenCognitionSignal?: () => void;
  cognitionSignalCount?: number;
  readingCardsOpen?: boolean;
  readingCardFeedbackCount?: number;
}

export function TopBar({
  onOpenSearch,
  onOpenReadingCards,
  onOpenSettings,
  readingCardsOpen = false,
  readingCardFeedbackCount = 0,
  onOpenCognitionSignal,
  cognitionSignalCount = 0,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          <YemaiMark />
        </span>
        <h1 className="brand-name" translate="no">页脉</h1>
      </div>

      <div className="topbar-meta">
        <button
          className="icon-button pressable"
          type="button"
          onClick={onOpenSearch}
          aria-label={readingCardsOpen ? '搜索收藏' : '搜索阅读历史'}
          title={`${readingCardsOpen ? '搜索收藏' : '搜索阅读历史'}（Ctrl/⌘ K）`}
        >
          <KoboyoIcon name="search" size={18} />
        </button>
        {cognitionSignalCount > 0 && (
          <button
            className="icon-button topbar-cognition-signal pressable"
            type="button"
            onClick={onOpenCognitionSignal}
            aria-label={`当前页面命中 ${cognitionSignalCount} 条个人认知`}
            title="相关个人认知"
          >
            <KoboyoIcon name="link" size={17} />
            <span aria-hidden="true">{cognitionSignalCount}</span>
          </button>
        )}
        <button
          className={`icon-button topbar-reading-cards pressable${readingCardsOpen ? ' is-active' : ''}`}
          type="button"
          onClick={onOpenReadingCards}
          aria-label={readingCardsOpen ? '关闭收藏' : '打开收藏'}
          aria-pressed={readingCardsOpen}
          title="收藏"
          data-reading-cards-trigger="true"
        >
          <KoboyoIcon name="bookmark" size={17} />
          {readingCardFeedbackCount > 0 && (
            <span className="topbar-reading-cards-badge" aria-hidden="true">
              +{readingCardFeedbackCount}
            </span>
          )}
        </button>
        <button
          className="icon-button pressable"
          type="button"
          onClick={onOpenSettings}
          aria-label="打开设置"
        >
          <KoboyoIcon name="settings" size={18} />
        </button>
      </div>
    </header>
  );
}
