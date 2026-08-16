import type { CSSProperties } from 'react';
import { getFileType } from '../fileTypes';

interface FileTypeIconProps {
  filename: string;
  mime?: string;
  variant?: 'draft' | 'token';
  className?: string;
}

function FileTypeGlyph({ kind, label }: { kind: ReturnType<typeof getFileType>['kind']; label: string }) {
  if (kind === 'spreadsheet') {
    return (
      <g className="file-type-icon__grid" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="21" y="27" width="22" height="18" rx="2" />
        <path d="M28.3 27v18M35.6 27v18M21 33h22M21 39h22" />
      </g>
    );
  }

  if (kind === 'text') {
    return (
      <g className="file-type-icon__lines" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.1">
        <path d="M20 29h24M20 36h19M20 43h22" />
      </g>
    );
  }

  if (kind === 'image') {
    return (
      <g className="file-type-icon__image" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8">
        <circle cx="38.5" cy="30" r="2.5" />
        <path d="m20 44 8.5-9 6 6 4-4 6 7Z" />
      </g>
    );
  }

  return (
    <text className="file-type-icon__label" x="32" y="41" textAnchor="middle">
      {label}
    </text>
  );
}

export function FileTypeIcon({ filename, mime, variant = 'draft', className = '' }: FileTypeIconProps) {
  const type = getFileType(filename, mime);

  return (
    <svg
      className={`file-type-icon file-type-icon--${variant} file-type-icon--${type.kind}${className ? ` ${className}` : ''}`}
      viewBox="0 0 64 72"
      role="img"
      aria-label={type.description}
      focusable="false"
      style={{ '--file-type-color': `var(--file-type-${type.kind})` } as CSSProperties}
    >
      <path
        className="file-type-icon__page"
        d="M9 2.5h31.2L55 17.3V63a6.5 6.5 0 0 1-6.5 6.5h-39A6.5 6.5 0 0 1 3 63V9a6.5 6.5 0 0 1 6-6.5Z"
      />
      <path className="file-type-icon__fold" d="M40.2 2.5v10.8a4 4 0 0 0 4 4H55" />
      <FileTypeGlyph kind={type.kind} label={type.label} />
      <path className="file-type-icon__pulse" d="M16 59.5h8.5l2.5-3.7 3.6 7.2 3-5.2 2.2 1.7H44" />
    </svg>
  );
}
