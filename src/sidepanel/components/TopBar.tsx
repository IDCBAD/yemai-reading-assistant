import { KoboyoIcon } from './KoboyoIcon';
import { YemaiMark } from './YemaiMark';

interface TopBarProps {
  onOpenSearch: (origin?: 'pointer' | 'keyboard') => void;
  onPrepareSearch: () => void;
  onOpenReadingCards: () => void;
  onPrepareReadingCards: () => void;
  onOpenSettings: () => void;
  onPrepareSettings: () => void;
  readingCardsOpen?: boolean;
  searchPreparing?: boolean;
  readingCardsPreparing?: boolean;
  readingCardFeedbackCount?: number;
}

export function TopBar({
  onOpenSearch,
  onPrepareSearch,
  onOpenReadingCards,
  onPrepareReadingCards,
  onOpenSettings,
  onPrepareSettings,
  readingCardsOpen = false,
  searchPreparing = false,
  readingCardsPreparing = false,
  readingCardFeedbackCount = 0,
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
          className={`icon-button pressable${searchPreparing ? ' is-preparing' : ''}`}
          type="button"
          onClick={(event) => onOpenSearch(event.detail === 0 ? 'keyboard' : 'pointer')}
          onPointerEnter={onPrepareSearch}
          onFocus={onPrepareSearch}
          aria-label={searchPreparing ? '正在准备搜索' : readingCardsOpen ? '搜索收藏' : '搜索阅读历史'}
          aria-busy={searchPreparing || undefined}
          title={`${readingCardsOpen ? '搜索收藏' : '搜索阅读历史'}（Ctrl/⌘ K）`}
        >
          <KoboyoIcon name="search" size={18} />
        </button>
        <button
          className={`icon-button topbar-reading-cards pressable${readingCardsOpen || readingCardsPreparing ? ' is-active' : ''}${readingCardsPreparing ? ' is-preparing' : ''}`}
          type="button"
          onClick={onOpenReadingCards}
          onPointerEnter={onPrepareReadingCards}
          onFocus={onPrepareReadingCards}
          aria-label={readingCardsPreparing ? '正在准备收藏' : readingCardsOpen ? '关闭收藏' : '打开收藏'}
          aria-pressed={readingCardsOpen || readingCardsPreparing}
          aria-busy={readingCardsPreparing || undefined}
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
          onPointerEnter={onPrepareSettings}
          onFocus={onPrepareSettings}
          aria-label="打开设置"
        >
          <KoboyoIcon name="settings" size={18} />
        </button>
      </div>
    </header>
  );
}
