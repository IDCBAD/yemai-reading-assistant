import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { KoboyoIcon, type KoboyoIconName } from './KoboyoIcon';
import '../collectionQuickMenu.css';

interface CollectionQuickMenuProps {
  onExport: () => void;
  onLatest: () => void;
  canReturnLatest: boolean;
  exportDisabled: boolean;
  exportLabel: string;
  exportIcon: KoboyoIconName;
  exporting: boolean;
  exportStatus?: string;
}

/** Small, local actions only: the owning collection keeps its scroll and export state. */
export function CollectionQuickMenu({
  onExport, onLatest, canReturnLatest, exportDisabled, exportLabel, exportIcon,
  exporting, exportStatus,
}: CollectionQuickMenuProps) {
  const [open, setOpen] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [available, setAvailable] = useState({ width: 320, height: 180 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const id = useId();
  const menuId = `${id}-actions`;
  const horizontal = available.height < 110 || available.width < 220;
  const short = !horizontal && available.height < 145;

  useLayoutEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const next = { width: parent.clientWidth, height: parent.clientHeight };
      setAvailable((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const show = (fromKeyboard: boolean) => {
    setKeyboard(fromKeyboard);
    focusOnOpen.current = fromKeyboard;
    setOpen(true);
  };
  const enabledItems = () => Array.from(
    menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
  );

  useEffect(() => {
    if (!open) return;
    const pointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const keyDown = (event: globalThis.KeyboardEvent) => {
      // Focused controls handle this in React before a collection's own Escape handler.
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        setKeyboard(true);
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('keydown', keyDown);
    return () => {
      document.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('keydown', keyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    (enabledItems()[0] ?? triggerRef.current)?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    // A live collection update can remove the currently focused latest action.
    if (open && document.activeElement === document.body) triggerRef.current?.focus({ preventScroll: true });
  }, [open, canReturnLatest, exportDisabled]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (open && event.key === 'Tab') setKeyboard(true);
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setKeyboard(true);
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    setKeyboard(true);
    if (!open) {
      show(true);
      return;
    }
    const items = enabledItems();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const backward = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : index < 0 ? (backward ? items.length - 1 : 0)
        : (index + (backward ? -1 : 1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={rootRef}
      className={`collection-quick-menu${open ? ' is-open' : ''}${keyboard ? ' is-keyboard' : ''}${canReturnLatest ? '' : ' is-single'}${horizontal ? ' is-horizontal' : short ? ' is-short' : ''}`}
      style={{
        '--quick-tooltip-max': `${Math.max(40, Math.min(118, available.width - (horizontal ? 128 : 152)))}px`,
        '--quick-tooltip-top': available.height < 94 ? '28px' : '-38px',
        '--quick-status-max': `${Math.max(40, Math.min(230, available.width - 88))}px`,
      } as CSSProperties}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="collection-quick-trigger"
        aria-label={open ? '收起快捷操作' : '收藏快捷操作'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={(event) => {
          if (open) {
            setKeyboard(event.detail === 0);
            close();
          } else show(event.detail === 0);
        }}
      >
        <KoboyoIcon name={open ? 'cross' : 'plus'} size={18} />
      </button>
      <div ref={menuRef} id={menuId} role="menu" aria-label="收藏快捷操作" aria-hidden={!open} inert={!open}>
        <div className="collection-quick-action collection-quick-export">
          <button
            type="button"
            role="menuitem"
            className="collection-quick-item"
            aria-label={exportLabel}
            aria-describedby={`${id}-export-label`}
            aria-busy={exporting}
            disabled={exportDisabled}
            tabIndex={open ? 0 : -1}
            onClick={(event) => { setKeyboard(event.detail === 0); close(true); onExport(); }}
          >
            <KoboyoIcon name={exportIcon} size={18} className={exporting ? 'is-spinning' : ''} />
          </button>
          <span className="collection-quick-tooltip" id={`${id}-export-label`} role="tooltip">{exportLabel}</span>
        </div>
        {canReturnLatest && (
          <div className="collection-quick-action collection-quick-latest">
            <button
              type="button"
              role="menuitem"
              className="collection-quick-item"
              aria-label="回到最新"
              aria-describedby={`${id}-latest-label`}
              tabIndex={open ? 0 : -1}
              onClick={(event) => { setKeyboard(event.detail === 0); close(true); onLatest(); }}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="m5 10 5-5 5 5M10 5v11M5 2.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="collection-quick-tooltip" id={`${id}-latest-label`} role="tooltip">回到最新</span>
          </div>
        )}
      </div>
      {exportStatus && <span className="collection-quick-status" role="status">{exportStatus}</span>}
    </div>
  );
}
