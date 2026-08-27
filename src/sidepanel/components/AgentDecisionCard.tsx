import { useEffect, useMemo, useState } from 'react';
import type { AgentDecision } from '../types';
import type { WorkosInterruptAnswers } from '../../services/workosTransport';
import { initialAgentDecisionAnswers } from '../agentDecision';
import { KoboyoIcon } from './KoboyoIcon';
import { COGNITION_CONFIRMATION_PROMPTS, COGNITION_TYPE_LABELS } from '../../cognition/candidate';

interface AgentDecisionCardProps {
  decision: AgentDecision;
  active: boolean;
  onReply: (answers: WorkosInterruptAnswers) => void;
  onReject: () => void;
}

interface AgentDecisionReceiptProps {
  decision: AgentDecision;
}

function decisionStatusCopy(decision: AgentDecision, active: boolean) {
  if (decision.status === 'submitting') return decision.submittedAction === 'reject' ? '正在跳过…' : '正在提交…';
  if (decision.status === 'submitted') return decision.submittedAction === 'reject' ? '已跳过，等待 Agent 继续' : '已提交，等待 Agent 继续';
  if (decision.status === 'replied') return '已确认';
  if (decision.status === 'rejected') return '已跳过';
  if (!active) return '当前运行已结束';
  if (decision.status === 'failed') return '提交失败，可以重试';
  return '等待你的选择';
}

export function AgentDecisionCard({ decision, active, onReply, onReject }: AgentDecisionCardProps) {
  const initialAnswers = useMemo(() => initialAgentDecisionAnswers(decision.fields), [decision.fields]);
  const [answers, setAnswers] = useState<WorkosInterruptAnswers>(() => decision.answers ?? initialAnswers);
  const [candidateTouched, setCandidateTouched] = useState(Boolean(decision.answers || decision.cognitionReceipt));
  const interactive = active && (decision.status === 'pending' || decision.status === 'failed');
  const busy = decision.status === 'submitting' || decision.status === 'submitted';
  const candidate = decision.cognitionCandidate;
  const primaryField = decision.fields[0];
  const primaryAnswer = primaryField && typeof answers[primaryField.label] === 'string'
    ? answers[primaryField.label] as string
    : '';
  const candidateReady = !candidate || Boolean(decision.cognitionReceipt) || (candidateTouched && primaryAnswer.trim());

  useEffect(() => {
    if (decision.status === 'replied' && decision.answers) setAnswers(decision.answers);
  }, [decision.answers, decision.status]);

  return (
    <section className={`agent-decision${candidate ? ' agent-decision--cognition' : ''} is-${decision.status}`} aria-labelledby={`decision-title-${decision.id}`}>
      <header className="agent-decision__header">
        <span className="agent-decision__icon" aria-hidden="true">
          <KoboyoIcon name="selection" size={15} />
        </span>
        <div>
          <h3 id={`decision-title-${decision.id}`}>{candidate ? '可能形成了新的理解' : decision.title}</h3>
          <span className="agent-decision__status" role="status">
            {busy && <i className="activity-spinner" aria-hidden="true" />}
            {decisionStatusCopy(decision, active)}
          </span>
        </div>
      </header>

      <form
        className="agent-decision__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (interactive) onReply(answers);
        }}
      >
        {candidate && (
          <div className="cognition-candidate__proposal">
            <span className="cognition-candidate__type">{COGNITION_TYPE_LABELS[candidate.type]}</span>
            <h4>{candidate.title}</h4>
            <p>{candidate.currentUnderstanding}</p>
            {candidate.changedFrom && <p className="cognition-candidate__changed">过去：{candidate.changedFrom}</p>}
          </div>
        )}
        {decision.fields.map((field, fieldIndex) => {
          const fieldId = `${decision.id}-${fieldIndex}`;
          if (field.type === 'text') {
            return (
              <label className="agent-decision__field" htmlFor={fieldId} key={fieldId}>
                <span>{candidate && fieldIndex === 0 ? COGNITION_CONFIRMATION_PROMPTS[candidate.type] : field.label}</span>
                <textarea
                  id={fieldId}
                  value={typeof answers[field.label] === 'string' ? answers[field.label] as string : ''}
                  rows={2}
                  maxLength={4_000}
                  disabled={!interactive}
                  onChange={(event) => {
                    if (candidate && fieldIndex === 0) setCandidateTouched(true);
                    setAnswers((current) => ({ ...current, [field.label]: event.target.value }));
                  }}
                />
              </label>
            );
          }

          const selected = field.type === 'multi-select'
            ? Array.isArray(answers[field.label]) ? answers[field.label] as string[] : []
            : typeof answers[field.label] === 'string' ? answers[field.label] as string : '';
          return (
            <fieldset className="agent-decision__field" disabled={!interactive} key={fieldId}>
              <legend>{field.label}</legend>
              <div className="agent-decision__options">
                {field.options.map((option, optionIndex) => {
                  const optionId = `${fieldId}-${optionIndex}`;
                  const checked = field.type === 'multi-select'
                    ? selected.includes(option)
                    : selected === option;
                  return (
                    <label className="agent-decision__option" htmlFor={optionId} key={optionId}>
                      <input
                        id={optionId}
                        name={field.type === 'single-select' ? fieldId : undefined}
                        type={field.type === 'multi-select' ? 'checkbox' : 'radio'}
                        value={option}
                        checked={checked}
                        onChange={() => {
                          if (field.type === 'single-select') {
                            setAnswers((current) => ({ ...current, [field.label]: option }));
                            return;
                          }
                          setAnswers((current) => {
                            const currentValues = Array.isArray(current[field.label]) ? current[field.label] as string[] : [];
                            return {
                              ...current,
                              [field.label]: currentValues.includes(option)
                                ? currentValues.filter((value) => value !== option)
                                : [...currentValues, option],
                            };
                          });
                        }}
                      />
                      <span>{option}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        {candidate && (
          <details className="cognition-candidate__details">
            <summary>查看 Agent 的判断依据与待验证项</summary>
            <dl>
              <div><dt>为什么值得沉淀</dt><dd>{candidate.rationale}</dd></div>
              <div><dt>建议边界</dt><dd>{candidate.boundary}</dd></div>
              {candidate.unresolved && <div><dt>仍待验证</dt><dd>{candidate.unresolved}</dd></div>}
            </dl>
          </details>
        )}

        {decision.errorMessage && (
          <p className="agent-decision__error" role="alert">{decision.errorMessage}</p>
        )}

        <footer className="agent-decision__actions">
          <button className="agent-decision__skip pressable" type="button" disabled={!interactive} onClick={onReject}>
            {candidate ? '这次不沉淀' : '跳过'}
          </button>
          <button className="agent-decision__confirm pressable" type="submit" disabled={!interactive || !candidateReady}>
            {candidate ? (decision.cognitionReceipt?.remotePending ? '重试恢复 Agent' : '形成认知') : '确认'}
          </button>
        </footer>
      </form>
    </section>
  );
}

function answerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length > 0 ? value.join('、') : '未选择';
  return value?.trim() || '未填写';
}

export function AgentDecisionReceipt({ decision }: AgentDecisionReceiptProps) {
  const [expanded, setExpanded] = useState(false);
  const replied = decision.status === 'replied';
  const answeredFields = decision.fields.filter((field) => {
    const value = decision.answers?.[field.label];
    return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
  }).length;
  const summary = decision.cognitionCandidate
    ? replied ? decision.cognitionReceipt?.available === false ? '认知文件不可用' : '已形成认知' : '这次没有沉淀'
    : replied ? `已确认 ${answeredFields} 项` : '已跳过';
  const detailId = `decision-receipt-${decision.id}`;

  return (
    <section className={`agent-decision-receipt is-${decision.status}`}>
      <button
        className="agent-decision-receipt__summary"
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="agent-decision-receipt__state" aria-hidden="true">
          <KoboyoIcon name={replied ? 'solid-checkmark' : 'cross'} size={13} />
        </span>
        <span className="agent-decision-receipt__title">{decision.cognitionCandidate?.title ?? decision.title}</span>
        <span className="agent-decision-receipt__meta">{summary}</span>
        <i className="agent-decision-receipt__chevron" aria-hidden="true" />
      </button>
      {expanded && (
        <div className="agent-decision-receipt__details" id={detailId}>
          {replied ? (
            <>
            {decision.cognitionReceipt && (
              <p>{decision.cognitionReceipt.available === false
                ? `文件不可用：${decision.cognitionReceipt.filename}（可重新连接目录或恢复文件后扫描）`
                : `已写入 ${decision.cognitionReceipt.filename}`}</p>
            )}
            <dl>
              {decision.fields.map((field) => (
                <div className="agent-decision-receipt__answer" key={`${decision.id}-${field.label}`}>
                  <dt>{field.label}</dt>
                  <dd>{answerValue(decision.answers?.[field.label])}</dd>
                </div>
              ))}
            </dl>
            </>
          ) : (
            <p>没有提交内容，Agent 已继续执行。</p>
          )}
        </div>
      )}
    </section>
  );
}
