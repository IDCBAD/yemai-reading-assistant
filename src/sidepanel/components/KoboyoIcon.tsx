import type { CSSProperties } from 'react';

export type KoboyoIconName =
  | 'archive'
  | 'bot'
  | 'bookmark'
  | 'bookmark-minus'
  | 'card-download'
  | 'copy'
  | 'cross'
  | 'cycle'
  | 'database-download'
  | 'database-replace'
  | 'document-download'
  | 'edit'
  | 'eye'
  | 'eye-off'
  | 'file'
  | 'file-upload'
  | 'fork'
  | 'globe'
  | 'history-clear'
  | 'link'
  | 'link-off'
  | 'paperclip'
  | 'plus'
  | 'quote'
  | 'search'
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
