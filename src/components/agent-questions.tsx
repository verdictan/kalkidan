import { useEffect, useRef, useState } from 'react';
import type { API, ChatRun, AgentAnswers, AgentQuestionRequest } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { errorMessage } from '../lib/errors';

// Drafts survive panel remounts in this process only. Secret answers are never retained.
const drafts = new Map<string, AgentAnswers>();
export function AgentQuestions({
  api,
  run,
  onUpdate,
}: {
  api: API;
  run: ChatRun;
  onUpdate: (run: ChatRun) => void;
}) {
  return (
    <>
      {!!run.unsupportedRequests && (
        <div role="status" className="rounded-lg border p-4 text-sm">
          <p className="font-medium">An agent request could not be displayed</p>
          <p className="mt-1 text-muted-foreground">
            Kalkidan declined the unsupported request. No permission was granted. Ask the agent to
            send its question as a message, then reply in the conversation.
          </p>
        </div>
      )}
      {run.requests?.map((request) => (
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
  return (
    <form
      aria-label="Agent questions"
      data-approval-pending={pending ? '' : undefined}
      className="space-y-4 rounded-lg bg-muted p-4"
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
      <h3 className="font-semibold">Agent questions</h3>
      {!pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {request.status === 'answered' ? 'Answer sent.' : 'This request is no longer active.'}
        </p>
      ) : (
        <>
          {request.questions.map((q) => {
            const value = answers[q.id] || [];
            const custom = value.filter((v) => !q.options.some((o) => o.label === v)).join(', ');
            return (
              <fieldset key={q.id} className="space-y-2" disabled={busy}>
                <legend className="text-sm font-medium">{q.question}</legend>
                {q.options.map((option) => (
                  <label key={option.label} className="flex gap-2 text-sm">
                    <input
                      type={q.kind === 'multiple-choice' ? 'checkbox' : 'radio'}
                      name={key + q.id}
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
                    <span>
                      {option.label}
                      {option.description && (
                        <span className="block text-muted-foreground">{option.description}</span>
                      )}
                    </span>
                  </label>
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
          <Button
            type="submit"
            size="sm"
            disabled={busy || request.questions.some((q) => !answers[q.id]?.length)}
          >
            {busy ? 'Sending…' : 'Send answer'}
          </Button>
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
