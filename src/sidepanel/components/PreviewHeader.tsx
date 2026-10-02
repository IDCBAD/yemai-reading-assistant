import { IconTooltipButton } from './IconTooltipButton';
import { KoboyoIcon } from './KoboyoIcon';

export function PreviewHeader({ filename, downloadUrl, onClose, closeLabel, onOpenTab, opening = false }: {
  filename: string;
  downloadUrl?: string;
  onClose: () => void;
  closeLabel: string;
  onOpenTab?: () => void;
  opening?: boolean;
}) {
  return <header className="artifact-preview-header">
    <strong title={filename}>{filename}</strong>
    <div className="artifact-preview-actions" aria-label="文件操作">
      {onOpenTab && <IconTooltipButton className="preview-icon-button" type="button" disabled={opening || !downloadUrl}
        aria-label="新标签页查看" tooltip={opening ? '正在打开…' : '新标签页查看'} onClick={onOpenTab}>
        <span className="preview-open-glyph" aria-hidden="true">↗</span>
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
