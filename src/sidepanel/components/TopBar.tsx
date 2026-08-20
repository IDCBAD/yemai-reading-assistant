import { KoboyoIcon } from './KoboyoIcon';
import { YemaiMark } from './YemaiMark';

interface TopBarProps {
  onOpenSearch: () => void;
  onOpenSettings: () => void;
}

export function TopBar({ onOpenSearch, onOpenSettings }: TopBarProps) {
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
          aria-label="搜索阅读历史"
          title="搜索阅读历史（Ctrl/⌘ K）"
        >
          <KoboyoIcon name="search" size={18} />
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
