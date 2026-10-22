import { useEffect, useRef, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import type { API, ChatRun, AgentAnswers, AgentQuestionRequest } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { CheckboxRow } from './ui/checkbox';
import { showToast } from './ui/toast';
import { agentLabel } from '../config/agents';
import { errorMessage } from '../lib/errors';

/**
 * One style for approval and question cards above the composer: a card with 12px padding,
 * a 16px icon and a 13/600 title.
 */
export const requestCardClass =
  'request-card space-y-3 rounded-xl border bg-card p-3 text-card-foreground shadow-sm focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none';
export const requestTitleClass = 'text-sm font-semibold';

// Drafts survive panel remounts in this process only. Secret answers are never retained.
const drafts = new Map<string, AgentAnswers>();
export function AgentQuestions({
  api,
  run,
  onUpdate,
  pendingOnly = false,
}: {
  api: API;
  run: ChatRun;
  onUpdate: (run: ChatRun) => void;
  /** Shows only the questions that wait for an answer. */
  pendingOnly?: boolean;
}) {
  return (
    <>
      {!!run.unsupportedRequests && (
        <div role="status" className={requestCardClass}>
          <h3 className={requestTitleClass}>Kalkidan declined a request it cannot show</h3>
          <p className="text-xs text-muted-foreground">
            No permission was given. Ask the agent to send its question as a message.
          </p>
        </div>
      )}
      {run.requests
        ?.filter((request) => !pendingOnly || request.status === 'pending')
        .map((request) => (
          <QuestionForm
            key={JSON.stringify([request.runId, request.id])}
            api={api}
            request={request}
            active={run.status === 'running'}
            onUpdate={onUpdate}
          />
        ))}
    </>
  );
}
function QuestionForm({
  api,
  request,
  active,
  onUpdate,
}: {
  api: API;
  request: AgentQuestionRequest;
  active: boolean;
  onUpdate: (run: ChatRun) => void;
}) {
  const key = JSON.stringify([request.runId, request.id]);
  const [answers, setAnswers] = useState<AgentAnswers>(() => drafts.get(key) || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const pending = request.status === 'pending' && active;
  useEffect(() => {
    if (!pending) drafts.delete(key);
  }, [key, pending]);
  function change(id: string, value: string[]) {
    setAnswers((previous) => {
      const next = { ...previous, [id]: value };
      const saved = Object.fromEntries(
        Object.entries(next).filter(([id]) => !request.questions.find((q) => q.id === id)?.secret),
      );
      drafts.set(key, saved);
      while (drafts.size > 40) drafts.delete(drafts.keys().next().value!);
      return next;
    });
  }
  const agent = agentLabel(request.provider);
  const count = request.questions.length;
  const title = count === 1 ? `${agent} asks a question` : `${agent} asks ${count} questions`;
  return (
    <form
      aria-label="Agent questions"
      tabIndex={-1}
      className={requestCardClass}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!pending || submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setError('');
        try {
          await api.chatRespond(request.runId, request.id, answers);
          drafts.delete(key);
          setAnswers({});
          showToast(`Answer sent to ${agent}.`);
          onUpdate(await api.chatStatus(request.runId));
        } catch (error) {
          setError(errorMessage(error));
          try {
            onUpdate(await api.chatStatus(request.runId));
          } catch {}
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      <div className="flex items-center gap-2">
        <MessageCircleQuestion size={16} className="shrink-0" aria-hidden="true" />
        <h3 className={requestTitleClass}>{title}</h3>
      </div>
      {!pending ? (
        <p role="status" className="text-xs text-muted-foreground">
          {request.status === 'answered' ? 'Answer sent.' : 'This request is no longer active.'}
        </p>
      ) : (
        <>
          {request.questions.map((q) => {
            const value = answers[q.id] || [];
            const custom = value.filter((v) => !q.options.some((o) => o.label === v)).join(', ');
            return (
              <fieldset key={q.id} className="grid gap-2" disabled={busy}>
                <legend className="mb-2 text-sm font-medium">{q.question}</legend>
                {q.options.map((option) => (
                  <CheckboxRow
                    key={option.label}
                    type={q.kind === 'multiple-choice' ? 'checkbox' : 'radio'}
                    name={key + q.id}
                    label={option.label}
                    description={option.description || undefined}
                    checked={value.includes(option.label)}
                    onChange={(e) =>
                      change(
                        q.id,
                        q.kind === 'multiple-choice'
                          ? e.target.checked
                            ? [...value, option.label]
                            : value.filter((v) => v !== option.label)
                          : [option.label],
                      )
                    }
                  />
                ))}
                {q.allowOther && (
                  <Input
                    aria-label={q.options.length ? `Other answer: ${q.label}` : q.label}
                    type={q.secret ? 'password' : 'text'}
                    autoComplete="off"
                    maxLength={4000}
                    value={custom}
                    placeholder={q.options.length ? 'Or enter your answer' : 'Your answer'}
                    onChange={(e) => change(q.id, e.target.value ? [e.target.value] : [])}
                  />
                )}
              </fieldset>
            );
          })}
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={busy || request.questions.some((q) => !answers[q.id]?.length)}
            >
              {busy ? 'Sending…' : 'Send answer'}
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </form>
  );
}
