import { useRef, useState } from 'react';
import type { API, TrackerBoard } from '../types';
import type { ProjectDoc } from '../domain/docs';
import { splitDocPlan, type DocsIssuePlan, type DocsIssuePlanResult } from '../domain/docs-plan';
import { DocPagePicker } from './doc-page-picker';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { errorMessage } from '../lib/errors';
export function DocsToIssues({
  api,
  groupId,
  board,
  onSaved,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  onSaved: () => Promise<void>;
}) {
  const key = `kalkidan-docs-issues:${groupId}:${board.project.id}`;
  const [open, setOpen] = useState(false),
    [picker, setPicker] = useState(false),
    [doc, setDoc] = useState<ProjectDoc>(),
    [entries, setEntries] = useState<DocsIssuePlan['entries']>([]),
    [repository, setRepository] = useState(''),
    [reference, setReference] = useState(false),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<DocsIssuePlanResult>();
  const [request, setRequest] = useState<DocsIssuePlan | undefined>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value &&
        typeof value.id === 'string' &&
        typeof value.repository === 'string' &&
        Array.isArray(value.entries) &&
        value.entries.length <= 20
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  });
  const pending = useRef(false);
  async function choose(id: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await api.docsRead(groupId, id);
      setDoc(value);
      setEntries(splitDocPlan(value.markdown, value.title));
      setReview(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function preview() {
    if (!entries.length || !repository.trim()) return;
    setError('');
    const next: DocsIssuePlan = {
      id: crypto.randomUUID(),
      repository: repository.trim(),
      entries: entries.map((entry) => ({
        ...entry,
        body:
          entry.body +
          (reference && doc
            ? `\n\nSource document: ${doc.title} (${doc.id}, revision ${doc.revision}).`
            : ''),
      })),
    };
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setRequest(next);
      setReview(false);
    } catch {
      setError('Cannot save the recovery record. Enable local storage before publishing.');
    }
  }
  async function publish() {
    if (!request || !review || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      setResult(await api.trackerDocsPlan(groupId, request));
      await onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="border-t py-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Plan issues from Docs</summary>
      {open && (
        <div className="grid gap-3 py-3">
          <p className="help-text">
            Choose a document explicitly. Its level-two headings become an editable proposal of up
            to 20 issues. Titles are limited to 256 characters and descriptions to 18,000
            characters. Review any shortened text. Memory is never included. Publishing creates
            project drafts, converts them to issues, then adds the reviewed relationships.
          </p>
          {!request ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setPicker(true)}>
                Choose source document
              </Button>
              {doc && (
                <p>
                  {doc.title} · source revision {doc.revision}
                </p>
              )}
              {entries.length > 0 && (
                <>
                  <label className="form-label">
                    Issue repository
                    <Input
                      aria-label="Plan issue repository"
                      placeholder="owner/repository"
                      value={repository}
                      disabled={busy}
                      onChange={(event) => setRepository(event.target.value)}
                    />
                  </label>
                  {entries.map((entry, index) => (
                    <fieldset key={index} disabled={busy} className="grid gap-2 rounded border p-3">
                      <legend>Issue {index + 1}</legend>
                      <Input
                        aria-label={`Issue ${index + 1} title`}
                        maxLength={256}
                        value={entry.title}
                        onChange={(event) =>
                          setEntries((values) =>
                            values.map((value, i) =>
                              i === index ? { ...value, title: event.target.value } : value,
                            ),
                          )
                        }
                      />
                      <Textarea
                        aria-label={`Issue ${index + 1} description`}
                        maxLength={18000}
                        value={entry.body}
                        onChange={(event) =>
                          setEntries((values) =>
                            values.map((value, i) =>
                              i === index ? { ...value, body: event.target.value } : value,
                            ),
                          )
                        }
                      />
                      <label className="form-label">
                        Parent
                        <select
                          value={entry.parent ?? ''}
                          onChange={(event) =>
                            setEntries((values) =>
                              values.map((value, i) =>
                                i === index
                                  ? {
                                      ...value,
                                      parent:
                                        event.target.value === ''
                                          ? undefined
                                          : Number(event.target.value),
                                    }
                                  : value,
                              ),
                            )
                          }
                        >
                          <option value="">No parent</option>
                          {entries.slice(0, index).map((value, i) => (
                            <option key={i} value={i}>
                              {i + 1}. {value.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      {index > 0 && (
                        <fieldset>
                          <legend>Blocked by</legend>
                          {entries.slice(0, index).map((value, i) => (
                            <label key={i} className="flex gap-2">
                              <input
                                type="checkbox"
                                checked={entry.blockedBy?.includes(i) || false}
                                onChange={(event) =>
                                  setEntries((values) =>
                                    values.map((value, j) =>
                                      j === index
                                        ? {
                                            ...value,
                                            blockedBy: event.target.checked
                                              ? [...(value.blockedBy || []), i]
                                              : (value.blockedBy || []).filter((id) => id !== i),
                                          }
                                        : value,
                                    ),
                                  )
                                }
                              />
                              {i + 1}. {value.title}
                            </label>
                          ))}
                        </fieldset>
                      )}
                      {board.items.some(
                        (item) =>
                          item.title.trim().toLowerCase() === entry.title.trim().toLowerCase(),
                      ) && (
                        <p role="status">
                          A task with this title already exists. Review it before creating another
                          issue.
                        </p>
                      )}
                    </fieldset>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={reference}
                      onChange={(event) => setReference(event.target.checked)}
                    />{' '}
                    Include the document name and revision in the published description.
                  </label>
                  <Button
                    disabled={
                      busy ||
                      !board.writable ||
                      !repository ||
                      entries.some((entry) => !entry.title.trim())
                    }
                    onClick={preview}
                  >
                    Review issue plan
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <h4>
                Publish {request.entries.length} issues to {request.repository}
              </h4>
              {request.entries.map((entry, index) => (
                <article key={index} className="grid gap-2 border-b pb-3">
                  <h5>
                    {index + 1}. {entry.title}
                  </h5>
                  <pre className="whitespace-pre-wrap text-sm">{entry.body}</pre>
                  <p className="help-text">
                    {entry.parent === undefined ? 'No parent' : `Parent: issue ${entry.parent + 1}`}{' '}
                    · Blocked by: {entry.blockedBy?.map((index) => index + 1).join(', ') || 'none'}
                  </p>
                </article>
              ))}
              <p className="help-text">
                Each description also contains an invisible recovery marker with the plan ID. A
                failure keeps created items. Resume reconciles those items; it does not delete or
                recreate them.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={review}
                  disabled={busy}
                  onChange={(event) => setReview(event.target.checked)}
                />{' '}
                I reviewed the descriptions, repository, and relationships.
              </label>
              <Button
                disabled={
                  busy ||
                  !review ||
                  !board.writable ||
                  result?.rows.every((row) => row.state === 'complete')
                }
                onClick={() => void publish()}
              >
                {busy
                  ? 'Publishing plan…'
                  : result
                    ? 'Resume issue plan'
                    : 'Publish reviewed issues'}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  localStorage.removeItem(key);
                  setRequest(undefined);
                  setResult(undefined);
                  setReview(false);
                }}
              >
                Start a different plan (keep existing items)
              </Button>
              {result?.rows.map((row) => (
                <p key={row.index} role="status">
                  Issue {row.index + 1}: {row.state} {row.message}
                </p>
              ))}
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      <DocPagePicker
        api={api}
        groupId={groupId}
        open={picker}
        onOpenChange={setPicker}
        onPick={(doc) => {
          setPicker(false);
          void choose(doc.id);
        }}
        title="Choose a document for the issue plan"
      />
    </details>
  );
}
