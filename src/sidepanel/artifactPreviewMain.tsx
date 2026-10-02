import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readPreviewTab } from './previewTab';
import type { AssistantArtifact } from './types';
import { ArtifactPreview } from './components/ArtifactPreview';
import './styles.css';

function PreviewPage() {
  const [artifact, setArtifact] = useState<AssistantArtifact | null | undefined>(undefined);
  useEffect(() => {
    let request = 0;
    const open = () => {
      const current = ++request;
      setArtifact(undefined);
      void readPreviewTab().then((value) => {
        if (current !== request) return;
        setArtifact(value);
        document.title = value ? `${value.filename} · 页脉` : '页脉 · 产物预览';
      }).catch(() => { if (current === request) setArtifact(null); });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => { request++; window.removeEventListener('hashchange', open); };
  }, []);
  if (artifact === undefined) return <main className="preview-status" role="status">正在打开预览…</main>;
  if (!artifact) return <main className="preview-status"><p>预览已过期，请从产物卡片重新打开。</p><button type="button" onClick={() => window.close()}>关闭</button></main>;
  return <ArtifactPreview artifact={artifact} standalone onClose={() => window.close()} />;
}

createRoot(document.getElementById('root')!).render(<PreviewPage />);
