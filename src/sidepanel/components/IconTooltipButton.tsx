import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface TooltipPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
}

interface IconTooltipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip: string;
  children: ReactNode;
  tooltipDelay?: number;
}

export function IconTooltipButton({
  tooltip,
  children,
  tooltipDelay = 320,
  onBlur,
  onClick,
  onFocus,
  onPointerDown,
  ...buttonProps
}: IconTooltipButtonProps) {
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const showTimerRef = useRef<number | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const clearShowTimer = () => {
    if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
  };

  const show = (delay = tooltipDelay) => {
    clearShowTimer();
    showTimerRef.current = window.setTimeout(() => {
      const bounds = buttonRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const placement = bounds.top >= 48 ? 'above' as const : 'below' as const;
      setPosition({
        left: Math.max(12, Math.min(bounds.left + bounds.width / 2, window.innerWidth - 12)),
        top: placement === 'above' ? bounds.top - 8 : bounds.bottom + 8,
        placement,
      });
      showTimerRef.current = null;
    }, delay);
  };

  const hide = () => {
    clearShowTimer();
    setPosition(null);
  };

  useEffect(() => {
    if (!position) return;
    const closeForViewportChange = () => hide();
    window.addEventListener('resize', closeForViewportChange);
    window.addEventListener('scroll', closeForViewportChange, true);
    return () => {
      window.removeEventListener('resize', closeForViewportChange);
      window.removeEventListener('scroll', closeForViewportChange, true);
    };
  }, [position]);

  useEffect(() => () => clearShowTimer(), []);

  return (
    <span
      className="icon-tooltip-anchor"
      onMouseEnter={() => show()}
      onMouseLeave={hide}
    >
      <button
        {...buttonProps}
        ref={buttonRef}
        aria-describedby={position ? tooltipId : undefined}
        onFocus={(event) => {
          onFocus?.(event);
          show(0);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          hide();
        }}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          hide();
        }}
        onClick={(event) => {
          onClick?.(event);
          hide();
        }}
      >
        {children}
      </button>
      {position && createPortal(
        <span
          className="icon-tooltip"
          id={tooltipId}
          role="tooltip"
          data-placement={position.placement}
          style={{ left: position.left, top: position.top }}
        >
          {tooltip}
        </span>,
        document.body,
      )}
    </span>
  );
}
