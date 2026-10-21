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
import { historyCostLabel, isOpaqueId, serviceName } from '../domain/verdictan';

/** Plain words for each project service action. */
const operationLabels: Record<ProjectServiceOperation, string> = {
  'task.history': 'Read the task history',
  'review.list': 'Read the reviews',
  'review.decide': 'Approve or deny a review',
  'context.settings': 'Read the knowledge settings',
  'context.configure': 'Turn shared knowledge on or off',
  'context.search': 'Search the shared knowledge',
  'context.list': 'List the shared knowledge',
  'context.publish': 'Publish a doc page as shared knowledge',
  'context.delete': 'Delete shared knowledge',
  'admin.templates': 'Read the templates',
  'admin.template.save': 'Save a template',
  'admin.template.apply': 'Apply a template',
  'operation.inspect': 'Check an action',
};
const operationLabel = (value: unknown) =>
  operationLabels[value as ProjectServiceOperation] || words(value, 'Action');

type View = 'history' | 'reviews' | 'context' | 'templates';
const views: { value: View; label: string; operation: ProjectServiceOperation }[] = [
  { value: 'history', label: 'Task usage and policy history', operation: 'task.history' },
  { value: 'reviews', label: 'Reviews and approvals', operation: 'review.list' },
  { value: 'context', label: 'Shared knowledge (Context Fabric)', operation: 'context.list' },
  { value: 'templates', label: 'Installation and policy templates', operation: 'admin.templates' },
];
const listOperation = (kind: View) => views.find((view) => view.value === kind)!.operation;

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
const record = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

function tokens(row: Record<string, unknown>) {
  const usage = record(row.usage);
  if (usage.total_tokens != null) return String(usage.total_tokens);
  return typeof row.tokens === 'number' ? String(row.tokens) : 'Unknown';
}

/** Managed-agent services of the project: history, reviews, shared knowledge and templates. */
export function ProjectServicesPanel({
  api,
  groupId,
  board,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
}) {
  const [documents, setDocuments] = useState<ProjectDocMetadata[]>([]);
  const [document, setDocument] = useState<ProjectDoc>();
  const [templateLabel, setTemplateLabel] = useState(''),
    [policyId, setPolicyId] = useState(''),
    [policyVersion, setPolicyVersion] = useState('');
  const [status, setStatus] = useState<ProjectServicesStatus>();
  const [result, setResult] = useState<ProjectServiceResult>();
  const [kind, setKind] = useState<View>('history');
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
    if (kind === 'context') {
      setDocuments(await api.docsMetadata(groupId));
      setConsent(
        await api.projectServicesRequest(groupId, { operation: 'context.settings', fields: {} }),
      );
    }
    setResult(
      await api.projectServicesRequest(groupId, {
        operation: listOperation(kind),
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
    <section aria-labelledby="services-title" className="grid gap-3">
      <SectionHeader
        title={<span id="services-title">Managed agent services</span>}
        actions={
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
        }
      />
      <p className="form-help">
        Usage history, reviews, shared knowledge and templates for managed agents in this project.
      </p>
      {status && !status.available && (
        <Alert size="sm">
          <AlertDescription>
            {status.message || 'Managed agent services are not available for this project.'}
          </AlertDescription>
        </Alert>
      )}
      {status?.available && (
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
                options={views.map((view) => ({ value: view.value, label: view.label }))}
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
                    ...board.items.map((item) => ({ value: item.id, label: item.title })),
                  ]}
                />
              </label>
            )}
            {kind === 'templates' && (
              <label className="form-label">
                Installation ID
                <Input
                  value={installation}
                  onChange={(event) => setInstallation(event.target.value)}
                />
              </label>
            )}
          </div>
          <ActionRow>
            <Button
              variant="outline"
              disabled={busy || (kind === 'history' && !task) || !allowed(listOperation(kind))}
              onClick={() => void run(load)}
            >
              Load current data
            </Button>
          </ActionRow>
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
          {kind === 'templates' && allowed('admin.template.save') && result && (
            <ToolSection title="New administrator template">
              <div className="planning-form-grid">
                <label className="form-label">
                  Name
                  <Input
                    value={templateLabel}
                    onChange={(event) => setTemplateLabel(event.target.value)}
                  />
                </label>
                <label className="form-label">
                  Policy ID
                  <Input value={policyId} onChange={(event) => setPolicyId(event.target.value)} />
                </label>
                <label className="form-label">
                  Policy version
                  <Input
                    value={policyVersion}
                    onChange={(event) => setPolicyVersion(event.target.value)}
                  />
                </label>
              </div>
              <ActionRow>
                <Button
                  variant="outline"
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
                  Review the template
                </Button>
              </ActionRow>
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
                    kind === 'history' ? (
                      <>
                        Policy: {words(visible(row.decision_outcome) || visible(row.decision))}
                        {visible(row.reason_code) ? ` · ${words(row.reason_code)}` : ''}
                        {serviceName(row.policy_name) ? ` · ${serviceName(row.policy_name)}` : ''} ·
                        Cost:
                        {historyCostLabel(row)} · Tokens: {tokens(row)}
                        {text(record(row.usage).settlement_state) || text(row.settlement_state)
                          ? ` · ${words(text(record(row.usage).settlement_state) || text(row.settlement_state))}`
                          : ''}
                      </>
                    ) : kind === 'reviews' ? (
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
                    ) : (
                      `Version ${String(row.version || '')}${text(row.description) ? ` · ${text(row.description)}` : ''}`
                    )
                  }
                >
                  {kind === 'history' && (
                    <p className="text-xs leading-4 text-muted-foreground">
                      Audit record: {text(row.audit_id) ? 'Recorded' : 'Unavailable'}
                    </p>
                  )}
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
                  {kind === 'templates' && (
                    <div className="review-row-actions">
                      <Button
                        size="xs"
                        variant="outline"
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
                        Review the template
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
          {result &&
            Array.isArray(result.installations) &&
            result.installations.map((value, index, all) => {
              const installation = record(value);
              return (
                <ReviewRow
                  key={text(installation.installation_id) || index}
                  title={
                    serviceName(installation.name, installation.host_name) ||
                    (all.length > 1 ? `Installation ${index + 1}` : 'Installation')
                  }
                  meta={`Runtime: ${words(installation.runtime_acknowledgment)}`}
                  status={{ label: words(installation.status), tone: 'muted' }}
                />
              );
            })}
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
                          ...(task && ['history', 'reviews'].includes(kind)
                            ? { task_id: task }
                            : {}),
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
