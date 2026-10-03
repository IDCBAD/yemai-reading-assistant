import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** One modal for both search and material details; the rest of the panel is inert. */
export function CollectionReferenceDialog({ label, onClose, children, className = '' }: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(dialogRef.current))
      .map((element) => ({ element, inert: element.inert }));
    background.forEach(({ element }) => { element.inert = true; });
    dialogRef.current?.querySelector<HTMLElement>('[data-collection-initial-focus]')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (!dialogRef.current) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); event.stopPropagation();
      }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'input:not(:disabled),textarea:not(:disabled),button:not(:disabled),a[href],[tabindex="0"]',
      )).filter((element) => element.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); return; }
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      background.forEach(({ element, inert }) => { element.inert = inert; });
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div className={`command-palette-layer collection-reference-layer${className ? ` ${className}-layer` : ''}`}>
    <button className="command-palette-scrim" type="button" tabIndex={-1} aria-label={`关闭${label}`} onClick={onClose} />
    <section className={`command-palette collection-reference-dialog ${className}`} ref={dialogRef}
      role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
      {children}
    </section>
  </div>, document.body);
}
