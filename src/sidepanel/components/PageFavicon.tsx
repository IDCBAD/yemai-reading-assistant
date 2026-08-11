import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';

interface PageFaviconProps {
  url: string;
  title: string;
  site?: string;
  size?: number;
  className?: string;
}

function faviconUrl(pageUrl: string, size: number) {
  if (!/^https?:\/\//iu.test(pageUrl)) return null;
  const getExtensionUrl = browser.runtime.getURL as (path: string) => string;
  const endpoint = getExtensionUrl('/_favicon/');
  return `${endpoint}?pageUrl=${encodeURIComponent(pageUrl)}&size=${Math.max(16, size * 2)}`;
}

function fallbackInitial(title: string, site: string | undefined, pageUrl: string) {
  let hostname = '';
  try {
    hostname = new URL(pageUrl).hostname.replace(/^www\./iu, '');
  } catch {
    // The title remains a useful fallback for malformed or unsupported URLs.
  }
  const label = site?.trim() || hostname || title.trim();
  return [...label][0]?.toLocaleUpperCase() || '·';
}

export function PageFavicon({
  url,
  title,
  site,
  size = 16,
  className = '',
}: PageFaviconProps) {
  const source = useMemo(() => faviconUrl(url, size), [size, url]);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [source]);

  const classes = `page-favicon${className ? ` ${className}` : ''}`;
  const style = { width: size, height: size };

  if (!source || failed) {
    return (
      <span className={`${classes} is-fallback`} style={style} aria-hidden="true">
        {fallbackInitial(title, site, url)}
      </span>
    );
  }

  return (
    <span className={classes} style={style} aria-hidden="true">
      <img
        src={source}
        width={size}
        height={size}
        alt=""
        draggable="false"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
