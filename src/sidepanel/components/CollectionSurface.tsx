import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CollectionTabs } from './CollectionTabs';
import '../collectionSurface.css';

const HeaderActionsContext = createContext<HTMLElement | null>(null);
const EscapeContext = createContext<((handler: () => boolean) => () => void) | null>(null);

/** A reader/editor may consume Escape before the surrounding collection closes. */
export function useCollectionEscape(enabled: boolean, handler: () => boolean) {
  const register = useContext(EscapeContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!enabled || !register) return;
    return register(() => handlerRef.current());
  }, [enabled, register]);
}

/** Embedded collection contents can add actions without replacing the shared header. */
export function CollectionHeaderActions({ children }: { children: ReactNode }) {
  const host = useContext(HeaderActionsContext);
  return host ? createPortal(children, host) : null;
}

interface CollectionSurfaceProps {
  open: boolean;
  active: 'answers' | 'words';
  answerCount: number;
  wordCount: number;
  paused?: boolean;
  busy?: boolean;
  onChange: (kind: 'answers' | 'words') => void;
  onClose: () => void;
  children: ReactNode;
}

export function CollectionSurface({ open, active, answerCount, wordCount, paused = false, busy, onChange, onClose, children }: CollectionSurfaceProps) {
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(open);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const keyboardRef = useRef(false);
  const escapeHandlerRef = useRef<(() => boolean) | null>(null);
  const registerEscapeRef = useRef((handler: () => boolean) => {
    escapeHandlerRef.current = handler;
    return () => { if (escapeHandlerRef.current === handler) escapeHandlerRef.current = null; };
  });
  closeRef.current = onClose;

  useEffect(() => {
    const keyboard = () => { keyboardRef.current = true; };
    const pointer = () => { keyboardRef.current = false; };
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('pointerdown', pointer, true);
    return () => {
      window.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('pointerdown', pointer, true);
    };
  }, []);

  useEffect(() => {
    let frame: number | undefined;
    let timer: number | undefined;
    if (open) {
      const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setKeyboardOpen(keyboardRef.current);
      setRendered(true);
      frame = window.requestAnimationFrame(() => {
        setVisible(true);
        panel.current?.querySelector<HTMLElement>('.collection-tabs button[aria-pressed="true"]')?.focus({ preventScroll: true });
      });
      return () => {
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        if (previous?.isConnected) previous.focus({ preventScroll: true });
      };
    }
    setVisible(false);
    timer = window.setTimeout(() => setRendered(false), 180);
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [open]);

  return <div className={`collection-surface${visible ? ' is-open' : ''}${keyboardOpen ? ' is-keyboard-open' : ''}`}
    hidden={!rendered} aria-hidden={!open || paused} inert={!open || paused || undefined}>
    <button className="collection-surface-scrim" tabIndex={-1} type="button" aria-label="关闭收藏" onClick={() => closeRef.current()} />
    <aside className="collection-surface-panel" role="dialog" aria-modal="true" aria-label="收藏" ref={panel}
      onKeyDown={(event) => {
        if (event.defaultPrevented || paused) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!escapeHandlerRef.current?.()) closeRef.current();
          return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') ?? [])]
          .filter((node) => node.tabIndex >= 0 && !node.closest('[hidden], [inert]') && node.getClientRects().length > 0);
        const first = focusable[0]; const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <CollectionTabs active={active} count={active === 'answers' ? answerCount : wordCount} onChange={() => onChange(active === 'answers' ? 'words' : 'answers')} onClose={onClose}>
        <div ref={setActionsHost} className="collection-content-actions" />
      </CollectionTabs>
      <HeaderActionsContext.Provider value={actionsHost}>
        <EscapeContext.Provider value={registerEscapeRef.current}>
          <div className="collection-surface-content" aria-busy={busy || undefined}>{children}</div>
        </EscapeContext.Provider>
      </HeaderActionsContext.Provider>
    </aside>
  </div>;
}
