import { useState } from 'react';
import type { API, TrackerBoard } from '../types';
import type { ProjectDoc, ProjectDocMetadata } from '../domain/docs';
import {
  projectServicePermissions,
  type ProjectServiceOperation,
  type ProjectServiceResult,
  type ProjectServicesStatus,
} from '../domain/project-services';
import { words } from '../domain/planning-labels';
import { fullTime } from '../lib/relative-time';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { Input } from './ui/input';
import { SectionHeader } from './ui/page-header';
import { showToast } from './ui/toast';
import { ActionRow, ErrorAlert, ReviewRow, ToolSection, FormSelect } from './planning-kit';
import { errorMessage } from '../lib/errors';
import { isOpaqueId, serviceName } from '../domain/verdictan';
import { ManagedHistoryView } from './managed-history';

/** Plain words for each project service action. */
const operationLabels: Record<ProjectServiceOperation, string> = {
  'review.list': 'Read the reviews',
  'review.decide': 'Approve or deny a review',
  'context.settings': 'Read the knowledge settings',
  'context.configure': 'Turn shared knowledge on or off',
  'context.search': 'Search the shared knowledge',
  'context.list': 'List the shared knowledge',
  'context.publish': 'Publish a doc page as shared knowledge',
  'context.delete': 'Delete shared knowledge',
  'operation.inspect': 'Check an action',
};
const operationLabel = (value: unknown) =>
  operationLabels[value as ProjectServiceOperation] || words(value, 'Action');

type View = 'history' | 'reviews' | 'context';
const views: { value: View; label: string }[] = [
  { value: 'history', label: 'Task usage and policy history' },
  { value: 'reviews', label: 'Reviews and approvals' },
  { value: 'context', label: 'Shared knowledge (Context Fabric)' },
];
/** History uses `history.list` through the managed history view, not a project operation. */
const listOperations: Record<Exclude<View, 'history'>, ProjectServiceOperation> = {
  reviews: 'review.list',
  context: 'context.list',
};
const listOperation = (kind: View) => {
  if (kind === 'history') throw Error('Open the history view to read the history.');
  return listOperations[kind];
};

const rows = (result?: ProjectServiceResult) =>
  Array.isArray(result?.items)
    ? result.items.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
const text = (value: unknown) => (typeof value === 'string' ? value : '');
/** Service text for display. Internal IDs show as an empty value. */
const visible = (value: unknown) => {
  const result = text(value);
  return result && !isOpaqueId(result) ? result : '';
};
/** A copy for review text without IDs, revisions, or ID-like values. */
function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, item]) => !/(^id$|_id$|revision$)/.test(key) && withoutIds(item) !== '')
        .map(([key, item]) => [key, withoutIds(item)]),
    );
  return typeof value === 'string' && isOpaqueId(value) ? '' : value;
}
const genericRecord = {
  history: 'Usage record',
  reviews: 'Review request',
  context: 'Knowledge entry',
} as const;

/** Managed-agent services of the project: history, reviews and shared knowledge. */
export function ProjectServicesPanel({
  api,
  groupId,
  board,
}: {
  api: API;
  groupId: string;
  /** The board gives the task filter. Without a board, the services show for all tasks. */
  board?: TrackerBoard;
}) {
  const [documents, setDocuments] = useState<ProjectDocMetadata[]>([]);
  const [document, setDocument] = useState<ProjectDoc>();
  const [status, setStatus] = useState<ProjectServicesStatus>();
  const [result, setResult] = useState<ProjectServiceResult>();
  const [kind, setKind] = useState<View>('history');
  const [task, setTask] = useState(''),
    [query, setQuery] = useState(''),
    [reason, setReason] = useState('');
  const [consent, setConsent] = useState<ProjectServiceResult>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [pending, setPending] = useState<{
    operation: ProjectServiceOperation;
    fields: Record<string, unknown>;
  }>();
  const allowed = (operation: ProjectServiceOperation) =>
    status?.operations.includes(operation) &&
    status.permissions.includes(projectServicePermissions[operation]);
  // `history.list` needs no project permission check.
  const historyAvailable = !!status?.historyList;
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    setResult(undefined);
    if (kind === 'context') {
      setDocuments(await api.docsMetadata(groupId));
      setConsent(
        await api.projectServicesRequest(groupId, { operation: 'context.settings', fields: {} }),
      );
    }
    setResult(
      await api.projectServicesRequest(groupId, {
        operation: listOperation(kind),
        fields: task && kind !== 'context' ? { task_id: task } : {},
      }),
    );
  }
  function review(
    operation: ProjectServiceOperation,
    fields: Record<string, unknown>,
    revision: unknown,
  ) {
    if (!text(revision)) {
      setError('Load the data again to get the current version.');
      return;
    }
    setPending({
      operation,
      fields: { ...fields, operation_id: crypto.randomUUID(), expected_revision: revision },
    });
  }
  const receipt = (value: ProjectServiceResult) =>
    value.receipt_id
      ? `${operationLabel(pending?.operation)}: ${words(value.state)}.`
      : `${operationLabel(pending?.operation)}: done.`;
  return (
    <section aria-label="Agent services" className="grid gap-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setStatus(await api.projectServicesStatus(groupId));
              setResult(undefined);
              setPending(undefined);
            })
          }
        >
          {status ? 'Check again' : 'Check project services'}
        </Button>
      </div>
      {status && !status.available && !status.historyList && (
        <Alert size="sm">
          <AlertDescription>
            {status.message || 'Managed agent services are not available for this project.'}
          </AlertDescription>
        </Alert>
      )}
      {(status?.available || status?.historyList) && (
        <>
          {!!status.pendingOperations?.length && (
            <div className="review-list">
              {status.pendingOperations.map((operation) => (
                <ReviewRow
                  key={operation.id}
                  title={operationLabel(operation.operation)}
                  meta="Result not known"
                  status={{ label: 'Check needed', tone: 'warning' }}
                >
                  <div className="review-row-actions">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy || !allowed('operation.inspect')}
                      onClick={() =>
                        void run(async () =>
                          setResult(
                            await api.projectServicesRequest(groupId, {
                              operation: 'operation.inspect',
                              fields: { operation_id: operation.id },
                            }),
                          ),
                        )
                      }
                    >
                      Check the result
                    </Button>
                  </div>
                </ReviewRow>
              ))}
            </div>
          )}
          <div className="planning-form-grid">
            <label className="form-label">
              View
              <FormSelect
                label="Project service view"
                value={kind}
                disabled={busy}
                onChange={(value) => {
                  setKind(value as View);
                  setResult(undefined);
                  setPending(undefined);
                }}
                options={views
                  .filter((view) => view.value === 'history' || status.available)
                  .map((view) => ({ value: view.value, label: view.label }))}
              />
            </label>
            {['history', 'reviews'].includes(kind) && (
              <label className="form-label">
                Task
                <FormSelect
                  label="Project service task"
                  value={task}
                  disabled={busy}
                  onChange={(value) => {
                    setTask(value);
                    setResult(undefined);
                  }}
                  options={[
                    ...(kind === 'reviews' ? [{ value: '', label: 'All tasks' }] : []),
                    ...(board?.items || []).map((item) => ({ value: item.id, label: item.title })),
                  ]}
                />
              </label>
            )}
          </div>
          {kind === 'history' ? (
            historyAvailable ? (
              <ManagedHistoryView
                api={api}
                target={task ? { kind: 'task', groupId, taskId: task } : undefined}
              />
            ) : (
              <p className="form-help">Your account cannot read the history of this project.</p>
            )
          ) : (
            <ActionRow>
              <Button
                variant="outline"
                disabled={busy || !allowed(listOperation(kind))}
                onClick={() => void run(load)}
              >
                Load current data
              </Button>
            </ActionRow>
          )}
          {kind === 'reviews' && (
            <label className="form-label">
              Decision reason
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
              />
              <span className="form-help mt-0">
                Write a reason before you approve or deny a review.
              </span>
            </label>
          )}
          {kind === 'context' && (
            <>
              <p className="form-help">
                Shared knowledge is off until you turn it on for this project. Agents get only the
                passages that you search for. Kalkidan does not add docs to agent prompts.
              </p>
              {consent && (
                <ReviewRow
                  title="Shared knowledge"
                  status={
                    consent.enabled === true
                      ? { label: 'On', tone: 'success' }
                      : { label: 'Off', tone: 'muted' }
                  }
                  aside={
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy || !allowed('context.configure')}
                      onClick={() =>
                        review(
                          'context.configure',
                          { enabled: consent.enabled !== true },
                          consent.revision,
                        )
                      }
                    >
                      {consent.enabled === true ? 'Turn off' : 'Turn on'}
                    </Button>
                  }
                />
              )}
              <div className="flex items-end gap-2">
                <label className="form-label min-w-0 flex-1">
                  Search the shared knowledge
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    maxLength={1000}
                  />
                </label>
                <Button
                  variant="outline"
                  disabled={
                    busy || !query.trim() || consent?.enabled !== true || !allowed('context.search')
                  }
                  onClick={() =>
                    void run(async () =>
                      setResult(
                        await api.projectServicesRequest(groupId, {
                          operation: 'context.search',
                          fields: { query, limit: 5, max_characters: 4000 },
                        }),
                      ),
                    )
                  }
                >
                  Search
                </Button>
              </div>
            </>
          )}
          {kind === 'context' && consent?.enabled === true && (
            <ToolSection title="Publish a doc page">
              <label className="form-label max-w-[360px]">
                Doc page
                <FormSelect
                  label="Doc page"
                  className="w-full"
                  value={document?.id || ''}
                  disabled={busy}
                  onChange={(id) => {
                    setDocument(undefined);
                    if (id) void run(async () => setDocument(await api.docsRead(groupId, id)));
                  }}
                  options={documents.map((doc) => ({
                    value: doc.id,
                    label: doc.title || 'Untitled',
                  }))}
                />
              </label>
              {document && (
                <>
                  <pre className="planning-pre">{document.markdown}</pre>
                  <ActionRow>
                    <Button
                      variant="outline"
                      disabled={busy || !allowed('context.publish')}
                      onClick={() =>
                        review(
                          'context.publish',
                          {
                            source: { id: document.id, revision: document.revision },
                            content: document.markdown,
                          },
                          consent.revision,
                        )
                      }
                    >
                      Review the publication
                    </Button>
                  </ActionRow>
                </>
              )}
            </ToolSection>
          )}
          {result && (
            <p className="form-help">Loaded {fullTime(text(result.observed_at)) || 'now'}</p>
          )}
          {rows(result).length > 0 && (
            <div className="review-list">
              {rows(result).map((row, index, all) => (
                <ReviewRow
                  key={text(row.id) || index}
                  // Service names only. A record without a name gets a numbered generic label.
                  title={
                    serviceName(row.title, row.label, row.name) ||
                    (all.length > 1 ? `${genericRecord[kind]} ${index + 1}` : genericRecord[kind])
                  }
                  status={
                    kind === 'reviews' && text(row.status)
                      ? {
                          label: words(row.status),
                          tone: ['pending', 'queued', 'claimed'].includes(text(row.status))
                            ? 'warning'
                            : 'muted',
                        }
                      : undefined
                  }
                  meta={
                    kind === 'reviews' ? (
                      text(row.reason_code) ? (
                        words(row.reason_code)
                      ) : undefined
                    ) : kind === 'context' ? (
                      <>
                        Source:{' '}
                        {documents.find((doc) => doc.id === text(row.source_id))?.title ||
                          serviceName(row.source_title) ||
                          'Project document'}{' '}
                        · Author: {serviceName(row.author_name) || 'Project member'}
                        {visible(row.deletion_state) ? ` · ${words(row.deletion_state)}` : ''}
                      </>
                    ) : undefined
                  }
                >
                  {kind === 'context' && (
                    <p className="text-sm whitespace-pre-wrap">{text(row.content)}</p>
                  )}
                  {kind === 'reviews' &&
                    ['pending', 'queued', 'claimed'].includes(text(row.status)) &&
                    (!row.reviewer_id || row.reviewer_id === result?.actor_id) && (
                      <div className="review-row-actions">
                        {(['approve', 'deny'] as const).map((decision) => (
                          <Button
                            key={decision}
                            size="xs"
                            variant="outline"
                            disabled={busy || !reason.trim() || !allowed('review.decide')}
                            onClick={() =>
                              review(
                                'review.decide',
                                { escalation_id: row.escalation_id, decision, reason },
                                row.revision,
                              )
                            }
                          >
                            {decision === 'approve' ? 'Approve' : 'Deny'}
                          </Button>
                        ))}
                      </div>
                    )}
                  {kind === 'context' && (
                    <div className="review-row-actions">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy || !allowed('context.delete')}
                        onClick={() =>
                          review('context.delete', { knowledge_id: row.knowledge_id }, row.revision)
                        }
                      >
                        Delete knowledge
                      </Button>
                    </div>
                  )}
                </ReviewRow>
              ))}
            </div>
          )}
          {result && rows(result).length === 0 && (
            <EmptyState compact>
              {result.receipt_id
                ? `Action ${visible(result.state) ? words(result.state) : 'recorded'}. Verdictan recorded a receipt.`
                : 'No records.'}
            </EmptyState>
          )}
          {result && typeof result.cursor === 'string' && (
            <ActionRow>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    setResult(
                      await api.projectServicesRequest(groupId, {
                        operation: listOperation(kind),
                        fields: {
                          cursor: result.cursor,
                          ...(task && kind === 'reviews' ? { task_id: task } : {}),
                        },
                      }),
                    ),
                  )
                }
              >
                Next page
              </Button>
            </ActionRow>
          )}
          {pending && (
            <section className="panel grid gap-3" aria-label="Review project action">
              <SectionHeader size="sm" as="h4" title={operationLabel(pending.operation)} />
              <dl className="meta-list">
                {Object.entries(pending.fields)
                  // IDs and revisions stay in the request. They are not shown.
                  .filter(
                    ([key, value]) =>
                      !['operation_id', 'expected_revision'].includes(key) &&
                      !key.endsWith('_id') &&
                      !(typeof value === 'string' && isOpaqueId(value)),
                  )
                  .map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt>{words(key)}</dt>
                      <dd>
                        {typeof value === 'string' || typeof value === 'boolean' ? (
                          typeof value === 'boolean' ? (
                            value ? (
                              'Yes'
                            ) : (
                              'No'
                            )
                          ) : (
                            <span className="whitespace-pre-wrap">{value}</span>
                          )
                        ) : (
                          <pre className="planning-pre">
                            {JSON.stringify(withoutIds(value), null, 2)}
                          </pre>
                        )}
                      </dd>
                    </div>
                  ))}
              </dl>
              <p className="form-help">
                This action uses your current project permissions. A review decision does not start
                an agent again or send a request again.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  disabled={busy || !allowed('operation.inspect')}
                  onClick={() =>
                    void run(async () =>
                      setResult(
                        await api.projectServicesRequest(groupId, {
                          operation: 'operation.inspect',
                          fields: { operation_id: pending.fields.operation_id },
                        }),
                      ),
                    )
                  }
                >
                  Check the result
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setPending(undefined)}>
                  Cancel
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const source = pending.fields.source as
                        { id: string; revision: string } | undefined;
                      const value =
                        pending.operation === 'context.publish' && source
                          ? await api.projectPublishDoc(
                              groupId,
                              source.id,
                              source.revision,
                              String(pending.fields.operation_id),
                              String(pending.fields.expected_revision),
                            )
                          : await api.projectServicesRequest(groupId, pending);
                      showToast(receipt(value));
                      setPending(undefined);
                      setResult(value);
                    })
                  }
                >
                  Confirm action
                </Button>
              </div>
            </section>
          )}
        </>
      )}
      <ErrorAlert>{error}</ErrorAlert>
    </section>
  );
}
