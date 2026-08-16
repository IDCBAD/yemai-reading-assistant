import type { CSSProperties } from 'react';

export type KoboyoIconName =
  | 'archive'
  | 'bot'
  | 'copy'
  | 'cross'
  | 'cycle'
  | 'edit'
  | 'eye'
  | 'eye-off'
  | 'file'
  | 'fork'
  | 'globe'
  | 'link'
  | 'link-off'
  | 'paperclip'
  | 'plus'
  | 'quote'
  | 'send'
  | 'selection'
  | 'settings'
  | 'shield-check'
  | 'solid-checkmark'
  | 'solid-history'
  | 'stop-generating-square'
  | 'trash';

interface KoboyoIconProps {
  name: KoboyoIconName;
  size?: number;
  className?: string;
}

export function KoboyoIcon({ name, size = 16, className = '' }: KoboyoIconProps) {
  return (
    <span
      className={`koboyo-icon${className ? ` ${className}` : ''}`}
      style={
        {
          '--koboyo-icon': `url("/icons/koboyo/${name}.svg")`,
          '--koboyo-size': `${size}px`,
        } as CSSProperties
      }
      aria-hidden="true"
    />
  );
}
