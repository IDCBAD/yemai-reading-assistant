import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AssistantArtifact } from '../types';
import { attachmentFormatLabel, getFileType } from '../fileTypes';
import { FileTypeIcon } from './FileTypeIcon';
import { KoboyoIcon } from './KoboyoIcon';

interface AssistantArtifactsProps {
  artifacts: AssistantArtifact[];
}

function safeArtifactUrl(value?: string) {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

function formatArtifactSize(bytes?: number) {
  if (bytes === undefined) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function ArtifactFileCard({ artifact }: { artifact: AssistantArtifact }) {
  const type = getFileType(artifact.filename, artifact.mime);
  const size = formatArtifactSize(artifact.size);
  const artifactUrl = safeArtifactUrl(artifact.url);
  const unavailable = artifact.status !== 'available' || !artifactUrl;

  return (
    <article className={`assistant-artifact-file is-${type.kind}${unavailable ? ' is-unavailable' : ''}`}>
      <FileTypeIcon filename={artifact.filename} mime={artifact.mime} variant="draft" />
      <span className="assistant-artifact-file__copy">
        <strong title={artifact.filename}>{artifact.filename}</strong>
        <small>
          {type.description}
          {type.kind === 'generic' ? '' : ` · ${attachmentFormatLabel(artifact.filename, artifact.mime)}`}
          {size ? ` · ${size}` : ''}
        </small>
      </span>
      {unavailable ? (
        <span className="assistant-artifact-unavailable">暂不可用</span>
      ) : (
        <a
          className="assistant-artifact-download pressable"
          href={artifactUrl}
          target="_blank"
          rel="noreferrer"
          download={artifact.filename}
          aria-label={`下载 ${artifact.filename}`}
        >
          下载
        </a>
      )}
    </article>
  );
}

export function AssistantArtifacts({ artifacts }: AssistantArtifactsProps) {
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());
  const [activeImage, setActiveImage] = useState<AssistantArtifact | null>(null);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const imageArtifacts = useMemo(() => artifacts.filter((artifact) =>
    artifact.kind === 'image'
    && artifact.status === 'available'
    && Boolean(safeArtifactUrl(artifact.thumbnailUrl) ?? safeArtifactUrl(artifact.url))
    && !failedImageIds.has(artifact.id)), [artifacts, failedImageIds]);
  const fileArtifacts = useMemo(() => artifacts.filter((artifact) =>
    !imageArtifacts.some((image) => image.id === artifact.id)), [artifacts, imageArtifacts]);
  const visibleFiles = filesExpanded ? fileArtifacts : fileArtifacts.slice(0, 2);

  const closeImage = () => setActiveImage(null);

  useEffect(() => {
    if (!activeImage) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeImage();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeImage]);

  if (artifacts.length === 0) return null;

  return (
    <section className="assistant-artifacts" aria-label="Agent 生成的文件">
      {imageArtifacts.length > 0 && (
        <div className={`assistant-artifact-images${imageArtifacts.length > 1 ? ' is-grid' : ''}`}>
          {imageArtifacts.map((artifact) => {
            const src = safeArtifactUrl(artifact.thumbnailUrl) ?? safeArtifactUrl(artifact.url)!;
            const downloadUrl = safeArtifactUrl(artifact.url);
            return (
              <article className="assistant-artifact-image" key={artifact.id}>
                <button
                  className="assistant-artifact-image__preview pressable"
                  type="button"
                  onClick={() => setActiveImage(artifact)}
                  aria-label={`查看大图：${artifact.filename}`}
                >
                  <img
                    src={src}
                    alt={artifact.filename}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => setFailedImageIds((current) => new Set(current).add(artifact.id))}
                  />
                </button>
                <footer>
                  <span title={artifact.filename}>{artifact.filename}</span>
                  {downloadUrl && (
                    <a
                      href={downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      download={artifact.filename}
                      aria-label={`下载 ${artifact.filename}`}
                    >
                      下载
                    </a>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {visibleFiles.length > 0 && (
        <div className="assistant-artifact-files">
          {visibleFiles.map((artifact) => <ArtifactFileCard artifact={artifact} key={artifact.id} />)}
          {fileArtifacts.length > 2 && (
            <button
              className="assistant-artifact-more pressable"
              type="button"
              onClick={() => setFilesExpanded((current) => !current)}
              aria-expanded={filesExpanded}
            >
              <span className={`disclosure-caret${filesExpanded ? ' is-open' : ''}`} aria-hidden="true" />
              {filesExpanded ? '收起文件' : `还有 ${fileArtifacts.length - 2} 个文件`}
            </button>
          )}
        </div>
      )}

      {activeImage && (safeArtifactUrl(activeImage.url) ?? safeArtifactUrl(activeImage.thumbnailUrl)) && createPortal(
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`图片预览：${activeImage.filename}`}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeImage();
          }}
        >
          <button
            className="image-lightbox-close pressable"
            type="button"
            onClick={closeImage}
            aria-label="关闭图片预览"
            autoFocus
          >
            <KoboyoIcon name="cross" size={15} />
          </button>
          <img
            src={safeArtifactUrl(activeImage.url) ?? safeArtifactUrl(activeImage.thumbnailUrl)}
            alt={activeImage.filename}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
              setFailedImageIds((current) => new Set(current).add(activeImage.id));
              closeImage();
            }}
          />
          <span className="image-lightbox-caption">{activeImage.filename}</span>
        </div>,
        document.body,
      )}
    </section>
  );
}
