import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clampImageView, fitImageScale, zoomImageView, type ImageView } from '../artifactPreview';
import { PreviewDialog } from './PreviewDialog';
import { KoboyoIcon } from './KoboyoIcon';
import { IconTooltipButton } from './IconTooltipButton';
import { PreviewHeader } from './PreviewHeader';

export function ImageViewer({ src, filename }: { src: string; filename: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [view, setView] = useState<ImageView>({ scale: 1, x: 0, y: 0 });
  const current = useRef(view); current.current = view;
  const [fitted, setFitted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; view: ImageView } | null>(null);
  const fit = size ? fitImageScale(size.width, size.height, bounds.width, bounds.height) : 1;
  const minScale = Math.min(fit, 0.1);
  const constrain = (next: ImageView) => size
    ? clampImageView(next, size.width, size.height, bounds.width, bounds.height) : next;
  const reset = () => { setFitted(true); setView({ scale: fit, x: 0, y: 0 }); };
  const zoom = (scale: number, x = 0, y = 0) => {
    setFitted(false);
    setView((previous) => constrain(zoomImageView(previous, Math.max(minScale, Math.min(8, scale)), x, y)));
  };
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!size) return;
    setView((previous) => fitted ? { scale: fit, x: 0, y: 0 } : constrain(previous));
  }, [size, bounds, fit, fitted]);
  useEffect(() => {
    const node = viewport.current;
    if (!node || !size) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      zoom(current.current.scale * Math.exp(-event.deltaY * 0.002), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [size, bounds, fit]);
  return <div className="preview-image-viewer">
    <div ref={viewport} className={`preview-image-canvas${dragging ? ' is-dragging' : ''}`} tabIndex={0} role="region" aria-label="图片画布，可滚轮缩放、拖动，使用加减键缩放"
      onDoubleClick={() => { if (fitted) zoom(1); else reset(); }}
      onKeyDown={(event) => {
        if (!size) return;
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(view.scale * 1.25); }
        if (event.key === '-') { event.preventDefault(); zoom(view.scale / 1.25); }
        if (event.key === '0') { event.preventDefault(); reset(); }
        const offsets: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
        const offset = offsets[event.key];
        if (offset) { event.preventDefault(); setView(constrain({ ...view, x: view.x + offset[0], y: view.y + offset[1] })); }
      }}
      onPointerDown={(event) => {
        if (!size || event.button !== 0 || drag.current) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.id !== event.pointerId) return;
        setView(constrain({ ...drag.current.view, x: drag.current.view.x + event.clientX - drag.current.x, y: drag.current.view.y + event.clientY - drag.current.y }));
      }}
      onPointerUp={() => { drag.current = null; setDragging(false); }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}>
      {failed ? <div className="preview-status" role="alert"><p>图片加载失败，可以重试或下载后查看。</p><button type="button" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>重试</button></div>
        : <><img key={attempt} src={src} alt={filename} draggable={false} referrerPolicy="no-referrer" decoding="async"
          style={{ visibility: size ? 'visible' : 'hidden', width: size?.width, height: size?.height,
            transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          onLoad={(event) => { setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setFitted(true); }}
          onError={() => { setFailed(true); setSize(null); }} />
          {!size && <div className="preview-status" role="status">正在加载图片…</div>}</>}
    </div>
    <div className="preview-image-controls" aria-label="图片缩放工具">
      <div className="preview-zoom-group">
        <IconTooltipButton className="preview-icon-button" type="button" aria-label="缩小图片" tooltip="缩小图片" disabled={!size || view.scale <= minScale} onClick={() => zoom(view.scale / 1.25)}><span className="preview-zoom-minus" aria-hidden="true">−</span></IconTooltipButton>
        <output aria-live="polite">{size ? `${Math.round(view.scale * 100)}%` : '—'}</output>
        <IconTooltipButton className="preview-icon-button" type="button" aria-label="放大图片" tooltip="放大图片" disabled={!size || view.scale >= 8} onClick={() => zoom(view.scale * 1.25)}><KoboyoIcon name="plus" /></IconTooltipButton>
      </div>
      <span className="preview-tool-divider" aria-hidden="true" />
      <div className="preview-size-group">
        <button type="button" disabled={!size} aria-pressed={fitted} onClick={reset}>适应窗口</button>
        <button type="button" disabled={!size} aria-pressed={!fitted && view.scale === 1} onClick={() => zoom(1)}>原始尺寸</button>
      </div>
    </div>
  </div>;
}

export function ImagePreview({ src, filename, downloadUrl, onClose }: { src: string; filename: string; downloadUrl?: string; onClose: () => void }) {
  return <PreviewDialog label={`图片预览：${filename}`} onClose={onClose}>
    <PreviewHeader filename={filename} downloadUrl={downloadUrl} onClose={onClose} closeLabel="关闭图片预览" />
    <ImageViewer key={src} src={src} filename={filename} />
  </PreviewDialog>;
}
