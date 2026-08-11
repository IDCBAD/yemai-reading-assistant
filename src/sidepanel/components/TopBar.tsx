import { KoboyoIcon } from './KoboyoIcon';
import { YemaiMark } from './YemaiMark';

interface TopBarProps {
  tabCount: number;
  onOpenSettings: () => void;
}

export function TopBar({ tabCount, onOpenSettings }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          <YemaiMark />
        </span>
        <h1 className="brand-name" translate="no">页脉</h1>
      </div>

      <div className="topbar-meta">
        <span>{tabCount} 个工作页</span>
        <button
          className="icon-button pressable"
          type="button"
          onClick={onOpenSettings}
          aria-label="打开设置"
          title="设置"
        >
          <KoboyoIcon name="settings" size={18} />
        </button>
      </div>
    </header>
  );
}
