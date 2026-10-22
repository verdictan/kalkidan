import { useEffect, useRef, useState } from 'react';
import { CircleSlash, MessageCircleQuestion } from 'lucide-react';
import type { API, ChatRun, AgentAnswers, AgentQuestionRequest } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { CheckboxRow } from './ui/checkbox';
import { showToast } from './ui/toast';
import { agentLabel } from '../config/agents';
import { errorMessage } from '../lib/errors';
import { ChatCard } from './chat-card';

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
        <ChatCard
          as="div"
          role="status"
          icon={CircleSlash}
          title="Kalkidan declined a request it cannot show"
        >
          <p className="chat-card-body">
            No permission was given. Ask the agent to send its question as a message.
          </p>
        </ChatCard>
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
    <ChatCard
      as="form"
      label="Agent questions"
      tabIndex={-1}
      icon={MessageCircleQuestion}
      title={title}
      actions={
        pending && (
          <Button
            type="submit"
            size="sm"
            disabled={busy || request.questions.some((q) => !answers[q.id]?.length)}
          >
            {busy ? 'Sending…' : 'Send answer'}
          </Button>
        )
      }
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
      {!pending ? (
        <p role="status" className="chat-card-body">
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
        </>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </ChatCard>
  );
}
