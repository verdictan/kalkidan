import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { API, ChatRun, AgentAnswers, AgentQuestionRequest, ChatApproval } from '../types';
import { Button } from './ui/button';
import { agentLabel } from '../config/agents';
import { errorMessage } from '../lib/errors';
import { DiffBlock, isPatch } from './diff-review';

// Drafts survive panel remounts in this process only. Secret answers are never retained.
const drafts = new Map<string, AgentAnswers>();

/** The text that the "instead" field of an approval sends as a new message. */
export interface ComposerInstead {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
}

/** The first request that waits for the user: an approval first, then a question. */
export function waitingRequest(run: ChatRun | null | undefined) {
  if (!run || run.status !== 'running') return null;
  const approval = run.approvals?.find((item) => item.status === 'pending');
  if (approval) return { kind: 'approval' as const, approval };
  const request = run.requests?.find((item) => item.status === 'pending');
  return request ? { kind: 'question' as const, request } : null;
}

/**
 * Puts the focus in the question or the approval, unless the user types somewhere else. Then
 * the number keys choose and ⏎ answers or allows.
 */
function useFirstFocus(key: string, target: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const active = document.activeElement as HTMLElement | null;
    const busyElsewhere =
      !!active &&
      active !== document.body &&
      !active.closest('.conversation-panel') &&
      active.matches('input, textarea, select, [contenteditable="true"]');
    if (!busyElsewhere) element.focus({ preventScroll: true });
  }, [key]);
}

/**
 * The question or the approval that waits for the user. It shows in the frame of the composer,
 * in place of the text box (CH-B1). A question has its options as 36px rows with 1, 2, 3 keys and
 * "Answer ⏎". An approval shows the command, "Deny" and "Allow ⏎". The user can also tell the
 * agent what to do instead.
 */
export function ComposerAsk({
  api,
  run,
  onUpdate,
  onStop,
  instead,
}: {
  api: API;
  run: ChatRun;
  onUpdate: (run: ChatRun) => void;
  onStop: () => void;
  instead: ComposerInstead;
}) {
  const waiting = waitingRequest(run);
  if (!waiting) return null;
  return waiting.kind === 'approval' ? (
    <ApprovalAsk
      key={waiting.approval.id}
      api={api}
      run={run}
      approval={waiting.approval}
      onUpdate={onUpdate}
      instead={instead}
    />
  ) : (
    <QuestionAsk
      key={JSON.stringify([waiting.request.runId, waiting.request.id])}
      api={api}
      request={waiting.request}
      onUpdate={onUpdate}
      onStop={onStop}
    />
  );
}

/** "Codex wants to run", or "Codex wants to apply a patch". */
function approvalHeading(agent: string, approval: ChatApproval) {
  const title = approval.title.trim();
  if (approval.detail && !isPatch(approval.detail) && /^(run|execute)\b/i.test(title))
    return `${agent} wants to run`;
  return `${agent} wants to ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

function ApprovalAsk({
  api,
  run,
  approval,
  onUpdate,
  instead,
}: {
  api: API;
  run: ChatRun;
  approval: ChatApproval;
  onUpdate: (run: ChatRun) => void;
  instead: ComposerInstead;
}) {
  const agent = agentLabel(run.agent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const frame = useRef<HTMLDivElement>(null);
  useFirstFocus(approval.id, frame);
  const others = (run.approvals || []).filter((item) => item.status === 'pending').length - 1;
  async function answer(allowed: boolean) {
    setBusy(true);
    setError('');
    try {
      await api.chatApprove(run.id, approval.id, allowed);
      onUpdate(await api.chatStatus(run.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      ref={frame}
      className="composer-ask"
      role="group"
      aria-label="Agent approval"
      aria-keyshortcuts="Enter"
      tabIndex={-1}
      onKeyDown={(event) => {
        // ⏎ allows, unless the focus is in a field or on another button.
        if (event.key !== 'Enter' || event.target !== event.currentTarget || busy) return;
        event.preventDefault();
        void answer(true);
      }}
    >
      <div aria-live="polite" className="sr-only">
        Approval needed: {approval.title}
      </div>
      <p className="composer-ask-question">
        {approvalHeading(agent, approval)}
        {others > 0 && <span className="composer-ask-count">{others} more</span>}
      </p>
      {approval.detail &&
        (isPatch(approval.detail) ? (
          <DiffBlock patch={approval.detail} className="max-h-40" />
        ) : (
          <pre className="composer-ask-command">{approval.detail}</pre>
        ))}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <div className="composer-ask-foot">
        <input
          className="composer-ask-other"
          aria-label={`Tell ${agent} what to do instead`}
          placeholder={`Or tell ${agent} what to do instead`}
          value={instead.value}
          maxLength={100000}
          onChange={(event) => instead.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (instead.value.trim()) instead.onSend();
          }}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer(false)}>
          Deny
        </Button>
        <Button
          size="sm"
          disabled={busy}
          aria-keyshortcuts="Enter"
          onClick={() => void answer(true)}
        >
          Allow
          <span className="composer-ask-key-hint" aria-hidden="true">
            ⏎
          </span>
        </Button>
      </div>
    </div>
  );
}

function QuestionAsk({
  api,
  request,
  onUpdate,
  onStop,
}: {
  api: API;
  request: AgentQuestionRequest;
  onUpdate: (run: ChatRun) => void;
  onStop: () => void;
}) {
  const key = JSON.stringify([request.runId, request.id]);
  // A single choice starts on its first option, so ⏎ answers at once (CH-B1).
  const [answers, setAnswers] = useState<AgentAnswers>(
    () =>
      drafts.get(key) ||
      Object.fromEntries(
        request.questions
          .filter((q) => q.kind === 'single-choice' && q.options.length)
          .map((q) => [q.id, [q.options[0].label]]),
      ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const frame = useRef<HTMLFormElement>(null);
  useFirstFocus(key, frame);
  const agent = agentLabel(request.provider);
  const questions = request.questions;
  // The free text field shows in the footer when there is one question.
  const single = questions.length === 1;
  // The digit keys choose an option of the first question without an answer.
  const current = Math.max(
    0,
    questions.findIndex((q) => !answers[q.id]?.length),
  );
  function change(id: string, value: string[]) {
    setAnswers((previous) => {
      const next = { ...previous, [id]: value };
      const saved = Object.fromEntries(
        Object.entries(next).filter(([id]) => !questions.find((q) => q.id === id)?.secret),
      );
      drafts.set(key, saved);
      while (drafts.size > 40) drafts.delete(drafts.keys().next().value!);
      return next;
    });
  }
  function choose(index: number, optionIndex: number) {
    const q = questions[index];
    const option = q?.options[optionIndex];
    if (!q || !option) return;
    const value = answers[q.id] || [];
    change(
      q.id,
      q.kind === 'multiple-choice'
        ? value.includes(option.label)
          ? value.filter((v) => v !== option.label)
          : [...value, option.label]
        : [option.label],
    );
  }
  function keys(event: KeyboardEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    // ⏎ on the form itself answers. In a field, ⏎ submits the form as usual.
    if (event.key === 'Enter' && target === event.currentTarget) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
      return;
    }
    if (target.matches('input:not([type="radio"]):not([type="checkbox"]), textarea')) return;
    if (event.metaKey || event.ctrlKey || event.altKey || !/^[1-9]$/.test(event.key)) return;
    event.preventDefault();
    choose(current, Number(event.key) - 1);
  }
  const ready = questions.every((q) => !!answers[q.id]?.length);
  const otherField = (index: number) => {
    const q = questions[index];
    if (!q.allowOther && q.kind !== 'text') return null;
    const value = answers[q.id] || [];
    const custom = value.filter((v) => !q.options.some((o) => o.label === v)).join(', ');
    return (
      <input
        className="composer-ask-other"
        aria-label={q.options.length ? `Other answer: ${q.label}` : q.label}
        type={q.secret ? 'password' : 'text'}
        autoComplete="off"
        maxLength={4000}
        disabled={busy}
        value={custom}
        placeholder={q.options.length ? 'Something else…' : 'Your answer'}
        onChange={(e) => change(q.id, e.target.value ? [e.target.value] : [])}
      />
    );
  };
  return (
    <form
      ref={frame}
      className="composer-ask"
      aria-label="Agent question"
      aria-keyshortcuts="1 2 3 Enter"
      tabIndex={-1}
      onKeyDown={keys}
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current || !ready) return;
        submitting.current = true;
        setBusy(true);
        setError('');
        try {
          await api.chatRespond(request.runId, request.id, answers);
          drafts.delete(key);
          setAnswers({});
          onUpdate(await api.chatStatus(request.runId));
        } catch (e) {
          setError(errorMessage(e));
          try {
            onUpdate(await api.chatStatus(request.runId));
          } catch {}
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      <div className="composer-ask-body">
        {questions.map((q, index) => {
          const value = answers[q.id] || [];
          return (
            <fieldset key={q.id} className="composer-ask-fieldset" disabled={busy}>
              <legend className="composer-ask-question">{q.question}</legend>
              {q.options.map((option, optionIndex) => {
                const checked = value.includes(option.label);
                return (
                  <label
                    key={option.label}
                    className="composer-ask-option"
                    data-selected={checked || undefined}
                  >
                    <input
                      className="sr-only"
                      type={q.kind === 'multiple-choice' ? 'checkbox' : 'radio'}
                      name={key + q.id}
                      checked={checked}
                      onChange={() => choose(index, optionIndex)}
                    />
                    <span className="composer-ask-key" aria-hidden="true">
                      {optionIndex < 9 ? optionIndex + 1 : ''}
                    </span>
                    <span className="composer-ask-label">{option.label}</span>
                    {option.description && (
                      <span className="composer-ask-detail">{option.description}</span>
                    )}
                  </label>
                );
              })}
              {!single && otherField(index)}
            </fieldset>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <div className="composer-ask-foot" data-divided="">
        {single ? otherField(0) : <span className="flex-1" />}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onStop}>
          Stop
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={busy || !ready}
          aria-label={busy ? `Sending the answer to ${agent}` : 'Answer'}
          aria-keyshortcuts="Enter"
        >
          {busy ? 'Sending…' : 'Answer'}
          {!busy && (
            <span className="composer-ask-key-hint" aria-hidden="true">
              ⏎
            </span>
          )}
        </Button>
      </div>
    </form>
  );
}
