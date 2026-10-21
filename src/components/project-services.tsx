import { useState } from 'react';
import type { API, TrackerBoard } from '../types';
import {
  projectServicePermissions,
  type ProjectServiceOperation,
  type ProjectServiceResult,
  type ProjectServicesStatus,
} from '../domain/project-services';
import { Button } from './ui/button';
import { errorMessage } from '../lib/errors';
import { historyCostLabel, isOpaqueId, serviceName } from '../domain/verdictan';

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
  templates: 'Template',
} as const;
export function ProjectServicesPanel({
  api,
  groupId,
  board,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
}) {
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<import('../domain/docs').ProjectDocMetadata[]>([]);
  const [document, setDocument] = useState<import('../domain/docs').ProjectDoc>();
  const [templateLabel, setTemplateLabel] = useState(''),
    [policyId, setPolicyId] = useState(''),
    [policyVersion, setPolicyVersion] = useState('');
  const [status, setStatus] = useState<ProjectServicesStatus>();
  const [result, setResult] = useState<ProjectServiceResult>();
  const [kind, setKind] = useState<'history' | 'reviews' | 'context' | 'templates'>('history');
  const [task, setTask] = useState(''),
    [query, setQuery] = useState(''),
    [reason, setReason] = useState(''),
    [installation, setInstallation] = useState('');
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
    const operation =
      kind === 'history'
        ? 'task.history'
        : kind === 'reviews'
          ? 'review.list'
          : kind === 'context'
            ? 'context.list'
            : 'admin.templates';
    if (kind === 'context') {
      setDocuments(await api.docsMetadata(groupId));
      setConsent(
        await api.projectServicesRequest(groupId, { operation: 'context.settings', fields: {} }),
      );
    }
    setResult(
      await api.projectServicesRequest(groupId, {
        operation,
        fields: task && kind !== 'context' && kind !== 'templates' ? { task_id: task } : {},
      }),
    );
  }
  function review(
    operation: ProjectServiceOperation,
    fields: Record<string, unknown>,
    revision: unknown,
  ) {
    if (!text(revision)) {
      setError('Refresh to obtain the current revision.');
      return;
    }
    setPending({
      operation,
      fields: { ...fields, operation_id: crypto.randomUUID(), expected_revision: revision },
    });
  }
  return (
    <details className="border-t py-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Project governance and knowledge</summary>
      {open && (
        <div className="grid gap-3 py-3">
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              void run(async () => {
                setStatus(await api.projectServicesStatus(groupId));
                setResult(undefined);
                setPending(undefined);
              })
            }
          >
            Check project services
          </Button>
          {status && !status.available && <p role="status">{status.message}</p>}
          {status?.available && (
            <>
              {status.pendingOperations?.map((operation) => (
                <div key={operation.id} className="grid gap-2 border p-3">
                  <p>Unresolved {operation.operation}</p>
                  <Button
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
                    Inspect saved operation
                  </Button>
                </div>
              ))}
              <label>
                View{' '}
                <select
                  aria-label="Project service view"
                  disabled={busy}
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as typeof kind);
                    setResult(undefined);
                    setPending(undefined);
                  }}
                >
                  <option value="history">Task usage and policy history</option>
                  <option value="reviews">Reviews and approvals</option>
                  <option value="context">Context Fabric</option>
                  <option value="templates">Installation and policy templates</option>
                </select>
              </label>
              {['history', 'reviews'].includes(kind) && (
                <label>
                  Task{' '}
                  <select
                    aria-label="Project service task"
                    disabled={busy}
                    value={task}
                    onChange={(event) => {
                      setTask(event.target.value);
                      setResult(undefined);
                    }}
                  >
                    <option value="">{kind === 'history' ? 'Select a task' : 'All tasks'}</option>
                    {board.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button
                disabled={
                  busy ||
                  (kind === 'history' && !task) ||
                  !allowed(
                    kind === 'history'
                      ? 'task.history'
                      : kind === 'reviews'
                        ? 'review.list'
                        : kind === 'context'
                          ? 'context.list'
                          : 'admin.templates',
                  )
                }
                onClick={() => void run(load)}
              >
                Load current data
              </Button>
              {kind === 'reviews' && (
                <label>
                  Decision reason{' '}
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={1000}
                  />
                </label>
              )}
              {kind === 'context' && (
                <>
                  <p className="help-text">
                    Context Fabric is off until you enable it for this project. Searches are
                    explicit. Docs are not attached to agent prompts automatically.
                  </p>
                  {consent && (
                    <>
                      <p>Context Fabric: {consent.enabled === true ? 'Enabled' : 'Disabled'}</p>
                      <Button
                        disabled={busy || !allowed('context.configure')}
                        onClick={() =>
                          review(
                            'context.configure',
                            { enabled: consent.enabled !== true },
                            consent.revision,
                          )
                        }
                      >
                        {consent.enabled === true ? 'Disable' : 'Enable'} Context Fabric
                      </Button>
                    </>
                  )}
                  <label>
                    Search knowledge{' '}
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      maxLength={1000}
                    />
                  </label>
                  <Button
                    disabled={
                      busy ||
                      !query.trim() ||
                      consent?.enabled !== true ||
                      !allowed('context.search')
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
                    Retrieve matching passages
                  </Button>
                </>
              )}
              {kind === 'context' && consent?.enabled === true && (
                <section className="grid gap-2 border-t py-3">
                  <h4>Publish project knowledge</h4>
                  <label>
                    Source document{' '}
                    <select
                      value={document?.id || ''}
                      disabled={busy}
                      onChange={(event) => {
                        const id = event.target.value;
                        setDocument(undefined);
                        if (id) void run(async () => setDocument(await api.docsRead(groupId, id)));
                      }}
                    >
                      <option value="">Select a document</option>
                      {documents.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {document && (
                    <>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                        {document.markdown}
                      </pre>
                      <Button
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
                        Review publication
                      </Button>
                    </>
                  )}
                </section>
              )}
              {kind === 'templates' && allowed('admin.template.save') && result && (
                <section className="grid gap-2 border-t py-3">
                  <h4>Create administrator template</h4>
                  <label>
                    Name{' '}
                    <input
                      value={templateLabel}
                      onChange={(event) => setTemplateLabel(event.target.value)}
                    />
                  </label>
                  <label>
                    Policy ID{' '}
                    <input value={policyId} onChange={(event) => setPolicyId(event.target.value)} />
                  </label>
                  <label>
                    Policy version{' '}
                    <input
                      value={policyVersion}
                      onChange={(event) => setPolicyVersion(event.target.value)}
                    />
                  </label>
                  <Button
                    disabled={
                      busy || !templateLabel.trim() || !policyId.trim() || !policyVersion.trim()
                    }
                    onClick={() =>
                      review(
                        'admin.template.save',
                        {
                          template: {
                            template_id: crypto.randomUUID(),
                            label: templateLabel,
                            allowed_host_platforms: [
                              'darwin-arm64',
                              'darwin-x64',
                              'linux-arm64',
                              'linux-x64',
                            ],
                            supported_runtime_range: {
                              minimum: '0.4.1',
                              maximum_exclusive: '1.0.0',
                            },
                            policy_references: [
                              {
                                configuration_id: policyId,
                                configuration_version_id: policyVersion,
                              },
                            ],
                            installation_defaults: { mandatory_gateway: true },
                          },
                        },
                        result.revision,
                      )
                    }
                  >
                    Review new template
                  </Button>
                </section>
              )}
              {kind === 'templates' && (
                <label>
                  Installation ID{' '}
                  <input
                    value={installation}
                    onChange={(event) => setInstallation(event.target.value)}
                  />
                </label>
              )}
              {result && (
                <p className="help-text">
                  Observed {result.observed_at} · revision {result.revision}
                </p>
              )}
              {rows(result).map((row, index, all) => (
                <article key={text(row.id) || index} className="grid gap-2 border-t py-3">
                  <strong>
                    {serviceName(row.title, row.label, row.name) ||
                      (all.length > 1
                        ? `${genericRecord[kind]} ${index + 1}`
                        : genericRecord[kind])}
                  </strong>
                  {kind === 'history' && (
                    <>
                      <p>
                        Policy:{' '}
                        {visible(row.decision_outcome) || visible(row.decision) || 'Unavailable'}
                        {visible(row.reason_code) && ` · ${visible(row.reason_code)}`}
                        {serviceName(row.policy_name) && ` · ${serviceName(row.policy_name)}`}
                      </p>
                      <p>
                        Cost: {historyCostLabel(row)} · tokens:{' '}
                        {row.usage &&
                        typeof row.usage === 'object' &&
                        (row.usage as any).total_tokens != null
                          ? String((row.usage as any).total_tokens)
                          : typeof row.tokens === 'number'
                            ? row.tokens
                            : 'Unknown'}{' '}
                        · {text((row.usage as any)?.settlement_state) || text(row.settlement_state)}
                      </p>
                      <p>Audit: {text(row.audit_id) ? 'Recorded' : 'Unavailable'}</p>
                    </>
                  )}
                  {kind === 'reviews' && (
                    <>
                      <p>
                        {text(row.status)} · {text(row.reason_code)}
                      </p>
                      {['pending', 'queued', 'claimed'].includes(text(row.status)) &&
                        (!row.reviewer_id || row.reviewer_id === result?.actor_id) && (
                          <div className="flex gap-2">
                            {(['approve', 'deny'] as const).map((decision) => (
                              <Button
                                key={decision}
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
                    </>
                  )}
                  {kind === 'context' && (
                    <>
                      <p className="whitespace-pre-wrap">{text(row.content)}</p>
                      <p>
                        Source:{' '}
                        {documents.find((doc) => doc.id === text(row.source_id))?.title ||
                          serviceName(row.source_title) ||
                          'Project document'}{' '}
                        · author {serviceName(row.author_name) || 'Project member'}
                        {visible(row.deletion_state) && ` · ${visible(row.deletion_state)}`}
                      </p>
                      <Button
                        variant="outline"
                        disabled={busy || !allowed('context.delete')}
                        onClick={() =>
                          review('context.delete', { knowledge_id: row.knowledge_id }, row.revision)
                        }
                      >
                        Delete knowledge
                      </Button>
                    </>
                  )}
                  {kind === 'templates' && (
                    <>
                      <p>
                        Version {String(row.version || '')} · {text(row.description)}
                      </p>
                      <Button
                        disabled={busy || !installation.trim() || !allowed('admin.template.apply')}
                        onClick={() =>
                          review(
                            'admin.template.apply',
                            {
                              template_id: row.template_id,
                              template_version: row.version,
                              installation_id: installation,
                            },
                            result?.revision,
                          )
                        }
                      >
                        Review template application
                      </Button>
                    </>
                  )}
                </article>
              ))}
              {result && rows(result).length === 0 && (
                <p>
                  {result.receipt_id
                    ? `Operation ${visible(result.state) || 'recorded'}. Verdictan recorded a receipt.`
                    : 'No records were returned.'}
                </p>
              )}
              {result &&
                Array.isArray(result.installations) &&
                result.installations.map((installation: any, index: number, all: unknown[]) => (
                  <p key={installation.installation_id}>
                    {serviceName(installation.name, installation.host_name) ||
                      (all.length > 1 ? `Installation ${index + 1}` : 'Installation')}
                    : {visible(installation.status) || 'unknown'} · runtime acknowledgment:{' '}
                    {visible(installation.runtime_acknowledgment) || 'unknown'}
                  </p>
                ))}
              {result && typeof result.cursor === 'string' && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const operation =
                        kind === 'history'
                          ? 'task.history'
                          : kind === 'reviews'
                            ? 'review.list'
                            : kind === 'context'
                              ? 'context.list'
                              : 'admin.templates';
                      setResult(
                        await api.projectServicesRequest(groupId, {
                          operation,
                          fields: {
                            cursor: result.cursor,
                            ...(task && ['history', 'reviews'].includes(kind)
                              ? { task_id: task }
                              : {}),
                          },
                        }),
                      );
                    })
                  }
                >
                  Next page
                </Button>
              )}
              {pending && (
                <section className="grid gap-2 border p-3" aria-label="Review project action">
                  <strong>Confirm {pending.operation}</strong>
                  <dl>
                    {Object.entries(pending.fields)
                      // IDs and revisions stay in the request. They are not shown.
                      .filter(
                        ([key, value]) =>
                          !['operation_id', 'expected_revision'].includes(key) &&
                          !key.endsWith('_id') &&
                          !(typeof value === 'string' && isOpaqueId(value)),
                      )
                      .map(([key, value]) => (
                        <div key={key}>
                          <dt>{key.replaceAll('_', ' ')}</dt>
                          <dd className="max-h-48 overflow-auto whitespace-pre-wrap">
                            {typeof value === 'string'
                              ? value
                              : JSON.stringify(withoutIds(value), null, 2)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                  <p>
                    This action uses your current project permissions. A review decision does not
                    restart an agent or replay a request.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const source = pending.fields.source as
                            { id: string; revision: string } | undefined;
                          const receipt =
                            pending.operation === 'context.publish' && source
                              ? await api.projectPublishDoc(
                                  groupId,
                                  source.id,
                                  source.revision,
                                  String(pending.fields.operation_id),
                                  String(pending.fields.expected_revision),
                                )
                              : await api.projectServicesRequest(groupId, pending);
                          setPending(undefined);
                          setResult(receipt);
                        })
                      }
                    >
                      Confirm action
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => setPending(undefined)}>
                      Cancel
                    </Button>
                    <Button
                      variant="outline"
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
                      Check operation outcome
                    </Button>
                  </div>
                </section>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}
