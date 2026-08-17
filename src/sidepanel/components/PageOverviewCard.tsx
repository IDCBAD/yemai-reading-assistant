import { useLayoutEffect, useState } from 'react';
import type { PageOverview, PageOverviewTreeNode } from '../pageOverview';
import { KoboyoIcon } from './KoboyoIcon';

interface PageOverviewCardProps {
  overview: PageOverview;
  onUseFollowUp: (question: string) => void;
}

const BRANCH_STEM_HEIGHT = 18;
const BRANCH_WIDTH = 36;

interface BranchGeometry {
  height: number;
  anchors: number[];
}

function sameGeometry(current: BranchGeometry | null, next: BranchGeometry) {
  return current?.height === next.height
    && current.anchors.length === next.anchors.length
    && current.anchors.every((anchor, index) => anchor === next.anchors[index]);
}

function OverviewBranches({ list, itemCount }: { list: HTMLUListElement | null; itemCount: number }) {
  const [geometry, setGeometry] = useState<BranchGeometry | null>(null);

  useLayoutEffect(() => {
    if (!list || itemCount === 0) return;
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const listRect = list.getBoundingClientRect();
        const items = Array.from(list.children)
          .filter((child): child is HTMLLIElement => child instanceof HTMLLIElement);
        const anchors = items.map((item) => {
          const row = item.querySelector<HTMLElement>(':scope > .page-overview-tree-row');
          if (!row) return 0;
          const rowRect = row.getBoundingClientRect();
          return Math.round((rowRect.top - listRect.top + rowRect.height / 2) * 10) / 10;
        });
        const height = Math.max(1, Math.round(listRect.height * 10) / 10);
        const next = { height, anchors };
        setGeometry((current) => sameGeometry(current, next) ? current : next);
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    Array.from(list.children).forEach((child) => {
      if (child instanceof HTMLElement) observer.observe(child);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [itemCount, list]);

  if (!geometry || geometry.anchors.length === 0) return null;
  const shiftedAnchors = geometry.anchors.map((anchor) => anchor + BRANCH_STEM_HEIGHT);
  const lastAnchor = shiftedAnchors[shiftedAnchors.length - 1]!;
  const svgHeight = geometry.height + BRANCH_STEM_HEIGHT;

  return (
    <svg
      className="page-overview-tree-branches"
      width={BRANCH_WIDTH}
      height={svgHeight}
      viewBox={`0 0 ${BRANCH_WIDTH} ${svgHeight}`}
      aria-hidden="true"
      focusable="false"
    >
      <path className="page-overview-tree-trunk" d={`M 1 0 V ${lastAnchor}`} />
      {shiftedAnchors.map((anchor, index) => (
        <path
          className="page-overview-tree-arm"
          d={`M 1 ${Math.max(0, anchor - 12)} C 1 ${anchor - 4}, 7 ${anchor}, 15 ${anchor} H 34`}
          key={`branch-${index}`}
        />
      ))}
    </svg>
  );
}

function OverviewTree({ nodes, depth = 0 }: { nodes: PageOverviewTreeNode[]; depth?: number }) {
  const [list, setList] = useState<HTMLUListElement | null>(null);

  return (
    <ul
      className={`page-overview-tree-list${depth > 0 ? ' page-overview-tree-list--nested' : ''}`}
      ref={setList}
    >
      {depth > 0 && <OverviewBranches list={list} itemCount={nodes.length} />}
      {nodes.map((node) => (
        <li className="page-overview-tree-item" key={node.id}>
          <div className="page-overview-tree-row">
            <span className="page-overview-tree-dot" aria-hidden="true" />
            <span className="page-overview-tree-text">{node.text}</span>
          </div>
          {node.children.length > 0 && <OverviewTree nodes={node.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export function PageOverviewCard({ overview, onUseFollowUp }: PageOverviewCardProps) {
  return (
    <section className="page-overview" aria-label="当前网页总览">
      <header className="page-overview-header">
        <span className="page-overview-heading-icon" aria-hidden="true">
          <KoboyoIcon name="file" size={16} />
        </span>
        <h2>总览</h2>
      </header>

      <p className="page-overview-summary">{overview.summary}</p>

      <section className="page-overview-section page-overview-outline">
        <h3 className="visually-hidden">内容大纲</h3>
        <OverviewTree nodes={overview.outline} />
      </section>

      <section className="page-overview-section">
        <h3>关键结论</h3>
        <ul className="page-overview-takeaways">
          {overview.takeaways.map((takeaway, index) => (
            <li key={`takeaway-${index}`}>
              <span className="page-overview-list-mark" aria-hidden="true" />
              <span>{takeaway}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="page-overview-section">
        <h3>重要概念</h3>
        <dl className="page-overview-concepts">
          {overview.concepts.map((concept) => (
            <div className="page-overview-concept" key={concept.id}>
              <dt>{concept.name}</dt>
              {concept.description && <dd>{concept.description}</dd>}
            </div>
          ))}
        </dl>
      </section>

      <section className="page-overview-section page-overview-follow-ups">
        <h3>值得追问</h3>
        <div className="page-overview-follow-up-list">
          {overview.followUps.map((question, index) => (
            <button
              className="page-overview-follow-up pressable"
              type="button"
              onClick={() => onUseFollowUp(question)}
              key={`follow-up-${index}`}
            >
              <span>{question}</span>
              <KoboyoIcon name="edit" size={12} />
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
