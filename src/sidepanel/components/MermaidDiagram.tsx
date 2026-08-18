import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconTooltipButton } from './IconTooltipButton';
import { KoboyoIcon } from './KoboyoIcon';

interface MermaidDiagramProps {
  source: string;
}

interface RenderedDiagram {
  svg: string;
}

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

async function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        htmlLabels: false,
        maxTextSize: 50_000,
        maxEdges: 500,
        theme: 'base',
        fontFamily: 'Inter, "Microsoft YaHei UI", "PingFang SC", sans-serif',
        secure: [
          'secure',
          'securityLevel',
          'startOnLoad',
          'suppressErrorRendering',
          'maxTextSize',
          'maxEdges',
          'theme',
          'themeCSS',
          'themeVariables',
          'fontFamily',
          'htmlLabels',
        ],
        themeVariables: {
          background: '#ffffff',
          primaryColor: '#eef3ff',
          primaryTextColor: '#1d2a41',
          primaryBorderColor: '#6f98ee',
          secondaryColor: '#f7f9fc',
          secondaryTextColor: '#35445c',
          secondaryBorderColor: '#b5c3d8',
          tertiaryColor: '#f1f5fa',
          tertiaryTextColor: '#35445c',
          tertiaryBorderColor: '#c4cfdd',
          lineColor: '#70819a',
          textColor: '#2c3a50',
          noteBkgColor: '#fff9e8',
          noteBorderColor: '#e3c871',
          clusterBkg: '#f8fafd',
          clusterBorder: '#c9d4e3',
        },
        flowchart: {
          curve: 'basis',
          htmlLabels: false,
          useMaxWidth: true,
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

function sanitizeSvg(svg: string) {
  const documentNode = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (documentNode.querySelector('parsererror')) throw new Error('图表 SVG 无法解析。');
  const root = documentNode.documentElement;
  root.querySelectorAll('script, foreignObject').forEach((element) => element.remove());
  root.querySelectorAll('style').forEach((element) => {
    element.textContent = (element.textContent ?? '')
      .replace(/@import[^;]+;?/gi, '')
      .replace(/url\((?!["']?#)[^)]+\)/gi, 'none');
  });
  root.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      if ((attribute.name === 'href' || attribute.name === 'xlink:href')
        && !attribute.value.startsWith('#')) element.removeAttribute(attribute.name);
    });
  });
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'Mermaid 图表');
  root.removeAttribute('height');
  root.removeAttribute('width');
  return root.outerHTML;
}

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const reactId = useId();
  const [state, setState] = useState<{ status: 'loading' | 'rendered' | 'error'; diagram?: RenderedDiagram }>({
    status: 'loading',
  });
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [expanded, setExpanded] = useState(false);
  const normalizedSource = source.trim();

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    if (!normalizedSource || normalizedSource.length > 50_000) {
      setState({ status: 'error' });
      return () => {
        active = false;
      };
    }
    const renderId = `yemai-mermaid-${reactId.replace(/[^a-z0-9_-]/gi, '')}-${Date.now()}`;
    void loadMermaid()
      .then((mermaid) => mermaid.render(renderId, normalizedSource))
      .then(({ svg }) => {
        if (active) setState({ status: 'rendered', diagram: { svg: sanitizeSvg(svg) } });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [normalizedSource, reactId]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setExpanded(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [expanded]);

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(normalizedSource);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 1800);
    }
  };

  if (state.status === 'error' || !state.diagram) {
    if (state.status === 'loading') {
      return (
        <div className="mermaid-card mermaid-card--loading" role="status">
          <span className="activity-spinner" aria-hidden="true" />
          正在绘制流程图…
        </div>
      );
    }
    return (
      <div className="mermaid-fallback">
        <header>
          <span>图表解析失败，已显示源码</span>
          <button className="pressable" type="button" onClick={copySource}>
            {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}
          </button>
        </header>
        <pre><code>{normalizedSource}</code></pre>
      </div>
    );
  }

  return (
    <>
      <section className="mermaid-card" aria-label="Mermaid 流程图">
        <header>
          <span>流程图</span>
          <div className="mermaid-actions">
            <IconTooltipButton
              className="mermaid-action pressable"
              type="button"
              onClick={copySource}
              aria-label="复制 Mermaid 源码"
              tooltip={copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制源码'}
            >
              <KoboyoIcon name={copyState === 'copied' ? 'solid-checkmark' : 'copy'} size={13} />
            </IconTooltipButton>
            <IconTooltipButton
              className="mermaid-action pressable"
              type="button"
              onClick={() => setExpanded(true)}
              aria-label="查看大图"
              tooltip="查看大图"
            >
              <KoboyoIcon name="selection" size={13} />
            </IconTooltipButton>
          </div>
        </header>
        <button
          className="mermaid-canvas pressable"
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="打开 Mermaid 图表大图"
        >
          <span dangerouslySetInnerHTML={{ __html: state.diagram.svg }} />
        </button>
      </section>

      {expanded && createPortal(
        <div
          className="mermaid-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Mermaid 图表大图"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setExpanded(false);
          }}
        >
          <button
            className="image-lightbox-close pressable"
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="关闭图表大图"
            autoFocus
          >
            <KoboyoIcon name="cross" size={15} />
          </button>
          <div className="mermaid-lightbox__canvas" dangerouslySetInnerHTML={{ __html: state.diagram.svg }} />
        </div>,
        document.body,
      )}
    </>
  );
}
