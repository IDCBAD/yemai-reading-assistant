import { KoboyoIcon } from './KoboyoIcon';

interface TopBarProps {
  conversationTitle: string;
  tabCount: number;
  onOpenSettings: () => void;
}

export function TopBar({ conversationTitle, tabCount, onOpenSettings }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          页
        </span>
        <span className="brand-copy">
          <h1 className="brand-name">页边</h1>
          <span className="brand-context" title={conversationTitle}>
            {conversationTitle}
          </span>
        </span>
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
