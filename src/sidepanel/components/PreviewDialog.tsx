import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function PreviewDialog({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(dialog.current))
      .map((element) => ({ element, inert: element.inert }));
    background.forEach(({ element }) => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('[data-preview-close]')?.focus();
    const keydown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== dialog.current) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? [])
        .filter((element) => element.getClientRects().length > 0);
      const first = elements[0]; const last = elements[elements.length - 1];
      if (!first || !last) { event.preventDefault(); dialog.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', keydown, true);
      background.forEach(({ element, inert }) => { element.inert = inert; });
      previousFocus?.focus();
    };
  }, []);
  return createPortal(<div className="artifact-preview-backdrop" onClick={(event) => {
    if (event.target === event.currentTarget) close.current();
  }}><div ref={dialog} className="artifact-preview-dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
    {children}
  </div></div>, document.body);
}
