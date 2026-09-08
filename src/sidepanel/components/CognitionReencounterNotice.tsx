import type { CognitionProjectionRow } from '../../cognition/cognitionLoop';

export function CognitionReencounterNotice({
  matches,
  onCompare,
  onDismiss,
}: {
  matches: Array<CognitionProjectionRow & { score: number; reason: string }>;
  onCompare: (cognition: CognitionProjectionRow) => void;
  onDismiss: () => void;
}) {
  const primary = matches[0];
  if (!primary) return null;
  return (
    <aside className="cognition-reencounter" aria-label="相关个人认知">
      <span className="cognition-reencounter__pulse" aria-hidden="true" />
      <div>
        <small>发生了一次认知重遇</small>
        <strong>{primary.title}</strong>
        <p>{primary.reason}{matches.length > 1 ? `，另有 ${matches.length - 1} 条相关认知` : ''}</p>
      </div>
      <div className="cognition-reencounter__actions">
        <button type="button" className="pressable" onClick={() => onCompare(primary)}>与当前材料对照</button>
        <button type="button" className="pressable" onClick={onDismiss}>稍后</button>
      </div>
    </aside>
  );
}
