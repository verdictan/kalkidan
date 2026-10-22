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

/**
 * One task for each top-level list item of a page. The indented lines under an item become its
 * description. A page without list items gives the same tasks as the ## headings.
 */
export function splitListItems(markdown: string, title: string) {
  const items: { title: string; body: string }[] = [];
  let current: { title: string; body: string } | undefined;
  let fence: string | undefined;
  for (const line of markdown.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker.startsWith(fence))) fence = fence ? undefined : marker;
    const item =
      !fence && !marker && /^ {0,3}(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(line);
    if (item) {
      current = { title: item[1], body: '' };
      items.push(current);
    } else if (current && (/^\s+\S/.test(line) || !line.trim())) current.body += line.trim() + '\n';
    else current = undefined;
  }
  if (!items.length) return splitDocPlan(markdown, title);
  return items.slice(0, 20).map((value) => ({
    title: value.title.slice(0, 256),
    body: value.body.trim().slice(0, 18000),
  }));
}

/** The number of ## headings that make tasks. Zero when the page has none. */
export function headingTaskCount(markdown: string) {
  const marker = '\u0000';
  const entries = splitDocPlan(markdown, marker);
  return entries.length === 1 && entries[0].title === marker ? 0 : entries.length;
}

/**
 * The tasks of a page: one task for each ## heading. A page without ## headings gives one task
 * for each top-level list item, or one task for the whole page.
 */
export function pageTasks(markdown: string, title: string) {
  return headingTaskCount(markdown)
    ? splitDocPlan(markdown, title)
    : splitListItems(markdown, title);
}

/** True when the page has top-level list items. */
export function hasListItems(markdown: string) {
  return listItemCount(markdown) > 0;
}

function listItemCount(markdown: string) {
  let fence = false;
  let count = 0;
  for (const line of markdown.split('\n')) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) fence = !fence;
    else if (!fence && /^ {0,3}(?:[-*+]|\d+[.)])\s+\S/.test(line)) count++;
  }
  return count;
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
 * Create tasks from a doc page: each ## heading (or each list item) becomes a task that you can
 * edit. Kalkidan adds each task to the board as a GitHub issue. With `pageId`, the dialog starts
 * with that page.
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<DocsIssuePlanResult>(),
    [request, setRequest] = useState<DocsIssuePlan>(),
    [byListItem, setByListItem] = useState(false);
  const pending = useRef(false);
  const form = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const key = board ? `kalkidan-docs-issues:${group.id}:${board.project.id}` : '';

  async function choose(id: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await api.docsRead(group.id, id);
      setDoc(value);
      setEntries(
        (byListItem ? splitListItems : pageTasks)(value.markdown, value.title || 'Untitled'),
      );
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
    focused.current = false;
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

  // The first field to fill gets focus: the GitHub repository, or the page when there is none.
  useEffect(() => {
    if (!open || focused.current || !board || request || busy) return;
    const target = entries.length
      ? form.current?.querySelector<HTMLElement>('[data-field="repository"] :is(button, input)')
      : form.current?.querySelector<HTMLElement>('[data-field="page"]');
    if (!target) return;
    focused.current = true;
    target.focus();
  }, [open, board, entries.length, request, busy]);
  function splitBy(listItems: boolean) {
    setByListItem(listItems);
    if (doc)
      setEntries((listItems ? splitListItems : pageTasks)(doc.markdown, doc.title || 'Untitled'));
  }
  const headings = doc ? headingTaskCount(doc.markdown) : 0;
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
  }
  async function publish() {
    if (!request || pending.current) return;
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
  const readOnly = board?.writable === false;
  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent
        size="lg"
        layout="scroll"
        // The first empty field gets focus when the page and the board load.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create tasks from a doc page</DialogTitle>
          <DialogDescription>Each list item or heading becomes a task.</DialogDescription>
        </DialogHeader>
        <DialogBody ref={form} className="grid content-start gap-4">
          {readOnly && (
            <Alert size="sm">
              <AlertDescription>
                You can only read this board. Ask the owner for access to add tasks.
              </AlertDescription>
            </Alert>
          )}
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
                  data-field="page"
                  disabled={busy}
                  onClick={() => setPicker(true)}
                >
                  {doc ? 'Change page' : 'Choose a page'}
                </Button>
              </div>
              {doc && headings > 0 && hasListItems(doc.markdown) && (
                <div className="docs-plan-split">
                  <CheckboxRow
                    label="Use the list items, not the headings"
                    checked={byListItem}
                    disabled={busy}
                    onChange={(event) => splitBy(event.target.checked)}
                  />
                </div>
              )}
              {entries.length > 0 && (
                <>
                  <div className="planning-form-grid">
                    <label className="form-label" data-field="repository">
                      GitHub repository
                      {repositories.length && !custom ? (
                        <FormSelect
                          label="GitHub repository"
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
                          aria-label="GitHub repository"
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
                          title={<span id={heading}>Task {index + 1}</span>}
                          actions={
                            entries.length > 1 ? (
                              <Button
                                size="xs"
                                variant="ghost"
                                disabled={busy}
                                aria-label={`Remove task ${index + 1}`}
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
                            aria-label={`Task ${index + 1} title`}
                            maxLength={256}
                            value={entry.title}
                            disabled={busy}
                            onChange={(event) => update(index, { title: event.target.value })}
                          />
                        </label>
                        <label className="form-label">
                          Description
                          <Textarea
                            aria-label={`Task ${index + 1} description`}
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
                              Parent task
                              <FormSelect
                                label="Parent task"
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
                    label="Add the page name and version to each description"
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
                title={`Create ${plural(request.entries.length, 'task')} in ${request.repository}`}
              />
              <div className="review-list">
                {request.entries.map((entry, index) => {
                  const value = state(index);
                  return (
                    <ReviewRow
                      key={index}
                      title={`${index + 1}. ${entry.title}`}
                      meta={`${entry.parent === undefined ? 'No parent' : `Parent: task ${entry.parent + 1}`} · Blocked by: ${entry.blockedBy?.map((value) => value + 1).join(', ') || 'none'}`}
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
              {result && !finished && (
                <p className="form-help">
                  Some tasks were not created. "Try again" continues. It does not create the other
                  tasks again.
                </p>
              )}
            </>
          )}
          <ErrorAlert>{error}</ErrorAlert>
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
                  !doc ||
                  board?.writable === false ||
                  !validRepository ||
                  !entries.length ||
                  entries.some((entry) => !entry.title.trim())
                }
                onClick={preview}
              >
                {doc && entries.length
                  ? `Review ${plural(entries.length, 'task')}`
                  : 'Review tasks'}
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
                <Button disabled={busy || board?.writable === false} onClick={() => void publish()}>
                  {busy
                    ? 'Creating tasks…'
                    : result
                      ? 'Try again'
                      : `Create ${plural(request.entries.length, 'task')}`}
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
