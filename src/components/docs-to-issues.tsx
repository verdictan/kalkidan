import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { API, ProjectGroup, TrackerBoard } from '../types';
import type { ProjectDoc } from '../domain/docs';
import { splitDocPlan, type DocsIssuePlan, type DocsIssuePlanResult } from '../domain/docs-plan';
import { docsPlanStateLabel, plural } from '../domain/planning-labels';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { CheckboxRow } from './ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { SectionHeader } from './ui/page-header';
import { Textarea } from './ui/textarea';
import { showToast } from './ui/toast';
import { DocPagePicker } from './doc-page-picker';
import { ErrorAlert, openTasksPage, ReviewRow, FormSelect } from './planning-kit';
import { errorMessage } from '../lib/errors';

type Entry = DocsIssuePlan['entries'][number];
const otherRepository = '__other';

function readRequest(key: string): DocsIssuePlan | undefined {
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
}

/** Removes entry `index` and moves the parent and blocker numbers of the later entries. */
function removeEntry(entries: Entry[], index: number): Entry[] {
  const move = (value: number) => (value > index ? value - 1 : value);
  return entries
    .filter((_, i) => i !== index)
    .map((entry) => ({
      ...entry,
      parent: entry.parent === undefined || entry.parent === index ? undefined : move(entry.parent),
      blockedBy: entry.blockedBy?.filter((value) => value !== index).map(move),
    }));
}

/** Adds the doc page to the related docs of each new task. */
async function linkDoc(
  api: API,
  groupId: string,
  doc: { id: string; title: string },
  itemIds: string[],
) {
  if (typeof api.setTaskDocLinks === 'function') {
    const links = (await api.taskDocLinks?.(groupId)) || {};
    for (const itemId of itemIds)
      await api.setTaskDocLinks(groupId, itemId, [...new Set([...(links[itemId] || []), doc.id])]);
    return;
  }
  // Older desktop builds keep the related docs of a task in local storage.
  for (const itemId of itemIds)
    try {
      const key = `kalkidan-task-docs:${groupId}:${itemId}`;
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      const docs = Array.isArray(value) ? value : [];
      if (!docs.some((entry: { id?: string }) => entry?.id === doc.id))
        localStorage.setItem(key, JSON.stringify([...docs, { id: doc.id, title: doc.title }]));
    } catch {
      // Storage can be unavailable. The task then has no related doc.
    }
}

/**
 * Create tasks from a doc page: each level-two heading becomes an issue that you can edit.
 * With `pageId`, the dialog starts with that page.
 */
export function DocsToIssuesDialog({
  api,
  group,
  open,
  onOpenChange,
  pageId,
}: {
  api: API;
  group: ProjectGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId?: string;
}) {
  const [board, setBoard] = useState<TrackerBoard>();
  const [picker, setPicker] = useState(false),
    [doc, setDoc] = useState<ProjectDoc>(),
    [entries, setEntries] = useState<Entry[]>([]),
    [repository, setRepository] = useState(''),
    [custom, setCustom] = useState(false),
    [reference, setReference] = useState(false),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<DocsIssuePlanResult>(),
    [request, setRequest] = useState<DocsIssuePlan>();
  const pending = useRef(false);
  const key = board ? `kalkidan-docs-issues:${group.id}:${board.project.id}` : '';

  async function choose(id: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await api.docsRead(group.id, id);
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

  // Each time the dialog opens: load the board, read a saved plan, and open the given page.
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    setError('');
    setResult(undefined);
    void api
      .trackerBoard(group.id)
      .then((value) => {
        if (disposed) return;
        setBoard(value);
        const saved = readRequest(`kalkidan-docs-issues:${group.id}:${value.project.id}`);
        setRequest(saved);
        const known = [
          ...new Set(value.items.flatMap((item) => (item.repository ? [item.repository] : []))),
        ];
        setRepository((current) => current || (known.length === 1 ? known[0] : ''));
        if (!saved && pageId && doc?.id !== pageId) void choose(pageId);
      })
      .catch((failure) => {
        if (!disposed) setError(errorMessage(failure));
      });
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, group.id, open, pageId]);

  const repositories = [
    ...new Set(board?.items.flatMap((item) => (item.repository ? [item.repository] : [])) || []),
  ].sort();
  const update = (index: number, change: Partial<Entry>) =>
    setEntries((values) =>
      values.map((value, i) => (i === index ? { ...value, ...change } : value)),
    );
  const validRepository = /^[\w.-]+\/[\w.-]+$/.test(repository.trim());

  function preview() {
    if (!entries.length || !validRepository) return;
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
      if (doc) localStorage.setItem(`${key}:doc`, JSON.stringify({ id: doc.id, title: doc.title }));
      setRequest(next);
      setReview(false);
    } catch {
      setError('Kalkidan cannot save a recovery record. Turn on local storage, then try again.');
    }
  }
  function restart() {
    try {
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}:doc`);
    } catch {
      // Storage can be unavailable.
    }
    setRequest(undefined);
    setResult(undefined);
    setReview(false);
  }
  async function publish() {
    if (!request || !review || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await api.trackerDocsPlan(group.id, request);
      setResult(value);
      const created = value.rows.filter((row) => row.state === 'complete');
      let source: { id: string; title: string } | undefined;
      try {
        source = JSON.parse(localStorage.getItem(`${key}:doc`) || 'null') || undefined;
      } catch {
        source = undefined;
      }
      const ids = created.flatMap((row) => (row.itemId ? [row.itemId] : []));
      if (source && ids.length)
        await linkDoc(api, group.id, source, ids).catch(() => {
          showToast({
            message: 'The tasks were created, but Kalkidan could not link the doc page to them.',
            tone: 'error',
          });
        });
      window.dispatchEvent(
        new CustomEvent('kalkidan-github-writes', { detail: { groupId: group.id } }),
      );
      if (created.length)
        showToast({
          message: `Created ${plural(created.length, 'task')}${source ? ` from ${source.title}` : ''}.`,
          actions: [{ label: 'Open tasks', onClick: () => openTasksPage(group.id) }],
        });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const finished = !!result?.rows.every((row) => row.state === 'complete');
  const state = (index: number) => result?.rows.find((row) => row.index === index)?.state;
  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent size="lg" layout="scroll">
        <DialogHeader>
          <DialogTitle>Create tasks from a doc page</DialogTitle>
          <DialogDescription>
            Each level-two heading of the page becomes an issue. Edit the issues, then create them.
            Kalkidan does not send project memory.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid content-start gap-4">
          {!request ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-sm">
                  {doc ? (
                    <>
                      <span className="text-muted-foreground">Page: </span>
                      <span className="font-medium">{doc.title || 'Untitled'}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Choose a doc page to start.</span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant={doc ? 'ghost' : 'outline'}
                  disabled={busy}
                  onClick={() => setPicker(true)}
                >
                  {doc ? 'Change page' : 'Choose source document'}
                </Button>
              </div>
              {entries.length > 0 && (
                <>
                  <div className="planning-form-grid">
                    <label className="form-label">
                      Repository
                      {repositories.length && !custom ? (
                        <FormSelect
                          label="Plan issue repository"
                          value={repository}
                          disabled={busy}
                          onChange={(value) => {
                            if (value === otherRepository) {
                              setCustom(true);
                              setRepository('');
                            } else setRepository(value);
                          }}
                          options={[
                            ...repositories.map((value) => ({ value, label: value })),
                            { value: otherRepository, label: 'Other repository…' },
                          ]}
                        />
                      ) : (
                        <Input
                          aria-label="Plan issue repository"
                          placeholder="owner/repository"
                          value={repository}
                          disabled={busy}
                          aria-invalid={!!repository && !validRepository}
                          onChange={(event) => setRepository(event.target.value)}
                        />
                      )}
                      {!!repository && !validRepository && (
                        <span className="field-error">Write the repository as owner/name.</span>
                      )}
                    </label>
                  </div>
                  {entries.map((entry, index) => {
                    const heading = `issue-plan-${index}`;
                    return (
                      <section
                        key={index}
                        role="group"
                        aria-labelledby={heading}
                        className="panel issue-plan-entry"
                      >
                        <SectionHeader
                          size="sm"
                          as="h4"
                          title={<span id={heading}>Issue {index + 1}</span>}
                          actions={
                            entries.length > 1 ? (
                              <Button
                                size="xs"
                                variant="ghost"
                                disabled={busy}
                                aria-label={`Remove issue ${index + 1}`}
                                onClick={() => setEntries(removeEntry(entries, index))}
                              >
                                Remove
                              </Button>
                            ) : undefined
                          }
                        />
                        <label className="form-label">
                          Title
                          <Input
                            aria-label={`Issue ${index + 1} title`}
                            maxLength={256}
                            value={entry.title}
                            disabled={busy}
                            onChange={(event) => update(index, { title: event.target.value })}
                          />
                        </label>
                        <label className="form-label">
                          Description
                          <Textarea
                            aria-label={`Issue ${index + 1} description`}
                            maxLength={18000}
                            rows={4}
                            value={entry.body}
                            disabled={busy}
                            onChange={(event) => update(index, { body: event.target.value })}
                          />
                        </label>
                        {index > 0 && (
                          <div className="planning-form-grid">
                            <label className="form-label">
                              Parent
                              <FormSelect
                                label="Parent"
                                value={entry.parent === undefined ? '' : String(entry.parent)}
                                disabled={busy}
                                onChange={(value) =>
                                  update(index, {
                                    parent: value === '' ? undefined : Number(value),
                                  })
                                }
                                options={[
                                  { value: '', label: 'No parent' },
                                  ...entries.slice(0, index).map((value, i) => ({
                                    value: String(i),
                                    label: `${i + 1}. ${value.title}`,
                                  })),
                                ]}
                              />
                            </label>
                            <fieldset className="grid gap-2" disabled={busy}>
                              <legend className="form-label mb-2">Blocked by</legend>
                              {entries.slice(0, index).map((value, i) => (
                                <CheckboxRow
                                  key={i}
                                  label={`${i + 1}. ${value.title}`}
                                  checked={entry.blockedBy?.includes(i) || false}
                                  onChange={(event) =>
                                    update(index, {
                                      blockedBy: event.target.checked
                                        ? [...(entry.blockedBy || []), i]
                                        : (entry.blockedBy || []).filter((id) => id !== i),
                                    })
                                  }
                                />
                              ))}
                            </fieldset>
                          </div>
                        )}
                        {board?.items.some(
                          (item) =>
                            item.title.trim().toLowerCase() === entry.title.trim().toLowerCase(),
                        ) && (
                          <Alert size="sm">
                            <AlertDescription>
                              A task with this title is on the board. Check it before you add
                              another one.
                            </AlertDescription>
                          </Alert>
                        )}
                      </section>
                    );
                  })}
                  <CheckboxRow
                    label="Add the page name and version to each description."
                    checked={reference}
                    disabled={busy}
                    onChange={(event) => setReference(event.target.checked)}
                  />
                </>
              )}
            </>
          ) : (
            <>
              <SectionHeader
                size="sm"
                as="h4"
                title={`Create ${plural(request.entries.length, 'issue')} in ${request.repository}`}
              />
              <div className="review-list">
                {request.entries.map((entry, index) => {
                  const value = state(index);
                  return (
                    <ReviewRow
                      key={index}
                      title={`${index + 1}. ${entry.title}`}
                      meta={`${entry.parent === undefined ? 'No parent' : `Parent: issue ${entry.parent + 1}`} · Blocked by: ${entry.blockedBy?.map((value) => value + 1).join(', ') || 'none'}`}
                      status={value ? docsPlanStateLabel(value) : undefined}
                    >
                      <div className="prose-ui pt-1" data-size="sm">
                        <Markdown skipHtml remarkPlugins={[remarkGfm]}>
                          {entry.body || '_No description_'}
                        </Markdown>
                      </div>
                    </ReviewRow>
                  );
                })}
              </div>
              {!finished && (
                <p className="form-help">
                  Each description also gets a hidden marker with the plan ID. If an issue fails,
                  the issues that Kalkidan created stay. "Try again" continues with those issues. It
                  does not delete them or create them again.
                </p>
              )}
              {!finished && (
                <CheckboxRow
                  label="I checked the descriptions, the repository and the links."
                  checked={review}
                  disabled={busy}
                  onChange={(event) => setReview(event.target.checked)}
                />
              )}
            </>
          )}
          <ErrorAlert>{error}</ErrorAlert>
          {board && !board.writable && (
            <p className="form-help">You can only read this board. Ask the owner for access.</p>
          )}
        </DialogBody>
        <DialogFooter>
          {!request ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={
                  busy ||
                  !board?.writable ||
                  !validRepository ||
                  !entries.length ||
                  entries.some((entry) => !entry.title.trim())
                }
                onClick={preview}
              >
                Review {plural(entries.length, 'issue')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={restart}>
                {result ? 'Start a new plan' : 'Back'}
              </Button>
              {finished ? (
                <Button onClick={() => onOpenChange(false)}>Done</Button>
              ) : (
                <Button
                  disabled={busy || !review || !board?.writable}
                  onClick={() => void publish()}
                >
                  {busy
                    ? 'Creating issues…'
                    : result
                      ? 'Try again'
                      : `Create ${plural(request.entries.length, 'issue')}`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
        <DocPagePicker
          api={api}
          groupId={group.id}
          open={picker}
          onOpenChange={setPicker}
          onPick={(value) => {
            setPicker(false);
            void choose(value.id);
          }}
          title="Choose a doc page for the tasks"
        />
      </DialogContent>
    </Dialog>
  );
}
