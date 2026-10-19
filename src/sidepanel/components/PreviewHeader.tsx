import { IconTooltipButton } from './IconTooltipButton';
import { KoboyoIcon } from './KoboyoIcon';

export function PreviewHeader({ filename, downloadUrl, onClose, closeLabel, onOpenTab, opening = false, fullscreen = false, onToggleFullscreen }: {
  filename: string;
  downloadUrl?: string;
  onClose: () => void;
  closeLabel: string;
  onOpenTab?: () => void;
  opening?: boolean;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  return <header className="artifact-preview-header">
    <strong title={filename}>{filename}</strong>
    <div className="artifact-preview-actions" aria-label="文件操作">
      {onOpenTab && <IconTooltipButton className="preview-icon-button" type="button" disabled={opening || !downloadUrl}
        aria-label="展开查看" tooltip={opening ? '正在打开…' : '展开查看'} onClick={onOpenTab}>
        <span className="preview-open-glyph" aria-hidden="true">↗</span>
      </IconTooltipButton>}
      {onToggleFullscreen && <IconTooltipButton className="preview-icon-button" type="button"
        aria-label={fullscreen ? '退出全屏' : '进入全屏'} tooltip={fullscreen ? '退出全屏（Esc）' : '进入全屏'}
        aria-pressed={fullscreen} onClick={onToggleFullscreen}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={fullscreen ? 'M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5' : 'M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5'} />
        </svg>
      </IconTooltipButton>}
      {downloadUrl && <a className="preview-icon-button" href={downloadUrl} download={filename} target="_blank" rel="noreferrer"
        aria-label="下载文件" title="下载文件"><KoboyoIcon name="document-download" /></a>}
      <span className="preview-tool-divider" aria-hidden="true" />
      <button className="preview-icon-button" type="button" data-preview-close aria-label={closeLabel} title="关闭预览" onClick={onClose}>
        <KoboyoIcon name="cross" />
      </button>
    </div>
  </header>;
}
