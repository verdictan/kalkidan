import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  projectServicePermissions,
  type ProjectServiceRequest,
  type ProjectServiceResult,
  type ProjectServicesStatus,
} from '../../src/domain/project-services';
import { parseCapabilities } from './account';
import type { DesktopClient } from './protocol';
import { writeJSON } from '../storage/atomic-json';
import { withDirectoryLock } from '../storage/directory-lock';

type Scope = {
  accountKey?: string;
  client: DesktopClient;
  organizationId: string;
  projectId: string;
  actorId: string;
};
const fields: Record<ProjectServiceRequest['operation'], string[]> = {
  'task.history': ['task_id', 'cursor'],
  'review.list': ['task_id', 'cursor'],
  'review.decide': ['escalation_id', 'decision', 'reason'],
  'context.settings': [],
  'context.configure': ['enabled'],
  'context.search': ['query', 'limit', 'max_characters', 'task_id'],
  'context.list': ['cursor'],
  'context.publish': ['source', 'content'],
  'context.delete': ['knowledge_id'],
  'operation.inspect': ['operation_id'],
};
const mutations = new Set([
  'review.decide',
  'context.configure',
  'context.publish',
  'context.delete',
]);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 10000;
function validate(request: ProjectServiceRequest) {
  if (
    !request ||
    !Object.hasOwn(fields, request.operation) ||
    !request.fields ||
    Array.isArray(request.fields) ||
    typeof request.fields !== 'object' ||
    JSON.stringify(request.fields).length > 32000
  )
    throw Error('Invalid project service request.');
  const allowed = [
    ...fields[request.operation],
    ...(mutations.has(request.operation) ? ['operation_id', 'expected_revision'] : []),
  ];
  if (Object.keys(request.fields).some((key) => !allowed.includes(key)))
    throw Error('Unsupported project service field.');
  const value = request.fields;
  if (
    mutations.has(request.operation) &&
    (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      String(value.operation_id),
    ) ||
      !text(value.expected_revision))
  )
    throw Error('A reviewed revision and operation ID are required.');
  const required = fields[request.operation].filter((key) => !['cursor', 'task_id'].includes(key));
  if (request.operation === 'task.history') required.push('task_id');
  if (required.some((key) => value[key] === undefined))
    throw Error('Required project service fields are missing.');
  if (
    request.operation === 'review.decide' &&
    (!['approve', 'deny'].includes(String(value.decision)) ||
      !text(value.reason) ||
      !text(value.escalation_id))
  )
    throw Error('Select a review decision and give a reason.');
  if (request.operation === 'context.configure' && typeof value.enabled !== 'boolean')
    throw Error('Set explicit project consent.');
  if (
    request.operation === 'context.search' &&
    (!text(value.query) ||
      !Number.isInteger(value.limit) ||
      Number(value.limit) < 1 ||
      Number(value.limit) > 10 ||
      !Number.isInteger(value.max_characters) ||
      Number(value.max_characters) < 1 ||
      Number(value.max_characters) > 8000)
  )
    throw Error('Set a bounded context query.');
}
function scoped(data: Record<string, unknown>, scope: Scope): ProjectServiceResult {
  const reference = data.project_scope as ProjectServiceResult['project_scope'] | undefined;
  if (
    reference?.organization_id !== scope.organizationId ||
    reference.project_id !== scope.projectId ||
    data.actor_id !== scope.actorId ||
    !text(data.revision) ||
    !text(data.observed_at) ||
    !Number.isFinite(Date.parse(data.observed_at))
  )
    throw Error('Project service response has an invalid account or project scope.');
  if (JSON.stringify(data).length > 200000)
    throw Error('Project service response exceeds its limit.');
  return data as ProjectServiceResult;
}
/** Normalize the published broker envelope without treating transport loss as success. */
export function normalizeProjectResult(
  result: ProjectServiceResult,
  request: ProjectServiceRequest,
): ProjectServiceResult {
  const next = { ...result };
  if ('next_cursor' in next) next.cursor = next.next_cursor;
  if (request.operation === 'context.search' && Array.isArray(next.passages))
    next.items = next.passages;
  if (request.operation === 'operation.inspect') {
    if (next.operation_id !== request.fields.operation_id)
      throw Error('Operation receipt does not match the request.');
    next.state = next.status ?? next.state;
    const receipt = next.receipt as Record<string, unknown> | null | undefined;
    if (receipt) {
      if (
        receipt.operation_id !== next.operation_id ||
        receipt.actor_id !== next.actor_id ||
        (receipt.project_scope as any)?.organization_id !== next.project_scope.organization_id ||
        (receipt.project_scope as any)?.project_id !== next.project_scope.project_id
      )
        throw Error('Invalid nested operation receipt.');
      next.receipt_id = receipt.audit_reference || receipt.operation_id;
    }
  } else if (
    mutations.has(request.operation) &&
    next.audit_reference &&
    next.operation_id === request.fields.operation_id
  ) {
    next.receipt_id = next.audit_reference;
    if (
      request.operation === 'review.decide' &&
      (next.reviewer_id !== next.actor_id || next.request_replayed !== false || !next.decision_id)
    )
      throw Error('Invalid reviewer receipt.');
    next.state = 'completed';
  }
  return next;
}
/** Missing broker capabilities stay unavailable. Mutations never replay an uncertain receipt. */
export class ProjectServices {
  constructor(
    private root: string,
    private resolve: (groupId: string) => Promise<Scope>,
  ) {}
  private async inspect(groupId: string) {
    const scope = await this.resolve(groupId);
    const capabilities = parseCapabilities(
      (await scope.client.request('capabilities')).data,
    ).capabilities;
    if (!capabilities.includes('project.permissions'))
      return { scope, capabilities, permissions: [] as string[], available: false };
    const value = scoped(
      (
        await scope.client.request('project.permissions', {
          project_scope: { organization_id: scope.organizationId, project_id: scope.projectId },
        })
      ).data,
      scope,
    );
    if (
      !Array.isArray(value.permissions) ||
      value.permissions.length > 100 ||
      !value.permissions.every(text)
    )
      throw Error('Invalid project permissions.');
    return { scope, capabilities, permissions: value.permissions as string[], available: true };
  }
  async status(groupId: string): Promise<ProjectServicesStatus> {
    const { scope, capabilities, permissions, available } = await this.inspect(groupId);
    const pendingOperations: NonNullable<ProjectServicesStatus['pendingOperations']> = [];
    let entries: string[] = [];
    try {
      entries = await readdir(this.root);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (entries.length > 10000) throw Error('Project service history exceeds its limit.');
    for (const name of entries.filter((name) => /^[a-f0-9]{64}\.json$/.test(name))) {
      const raw = await readFile(join(this.root, name), 'utf8');
      if (raw.length > 240000) throw Error('Project service receipt exceeds its limit.');
      const row = JSON.parse(raw);
      if (
        row.scope?.accountKey === scope.accountKey &&
        row.scope?.organizationId === scope.organizationId &&
        row.scope?.actorId === scope.actorId &&
        row.scope?.projectId === scope.projectId &&
        ['pending', 'partial'].includes(row.state) &&
        Object.hasOwn(projectServicePermissions, row.operation) &&
        permissions.includes(
          projectServicePermissions[row.operation as ProjectServiceRequest['operation']],
        )
      )
        pendingOperations.push({ id: row.operationId, operation: row.operation, state: row.state });
    }
    return {
      available,
      historyList: capabilities.includes('history.list'),
      pendingOperations: pendingOperations.slice(-100),
      permissions,
      operations: Object.keys(projectServicePermissions).filter((operation) =>
        capabilities.includes(operation),
      ) as ProjectServicesStatus['operations'],
      ...(!available
        ? {
            message:
              'This runtime does not support project permissions. Install a compatible runtime to use project services.',
          }
        : {}),
    };
  }
  async request(groupId: string, request: ProjectServiceRequest): Promise<ProjectServiceResult> {
    validate(request);
    const { scope, capabilities, permissions, available } = await this.inspect(groupId);
    if (!available || !capabilities.includes(request.operation))
      throw Error('The runtime does not support this project service operation.');
    if (!permissions.includes(projectServicePermissions[request.operation]))
      throw Error('Your current account does not have permission for this operation.');
    const project_scope = { organization_id: scope.organizationId, project_id: scope.projectId };
    if (['context.search', 'context.publish'].includes(request.operation)) {
      if (!capabilities.includes('context.settings'))
        throw Error('Context consent cannot be verified.');
      const consent = scoped(
        (await scope.client.request('context.settings', { project_scope })).data,
        scope,
      );
      if (consent.enabled !== true)
        throw Error('Enable Context Fabric for this project before use.');
    }
    const send = async () => {
      const result = normalizeProjectResult(
        scoped(
          (await scope.client.request(request.operation, { project_scope, fields: request.fields }))
            .data,
          scope,
        ),
        request,
      );
      if (
        mutations.has(request.operation) &&
        (result.operation_id !== request.fields.operation_id ||
          !text(result.receipt_id) ||
          !['completed', 'pending', 'failed', 'partial'].includes(String(result.state)))
      )
        throw Error(
          'The broker did not return a valid mutation receipt. Inspect the operation before retrying.',
        );
      if (
        Array.isArray(result.items) &&
        result.items.length >
          (request.operation === 'context.search' ? Number(request.fields.limit) : 100)
      )
        throw Error('The broker response exceeds the requested item limit.');
      if (request.operation === 'context.search') {
        if (
          !Array.isArray(result.items) ||
          result.items.some(
            (item: any) =>
              !item ||
              !text(item.knowledge_id) ||
              !text(item.source_id) ||
              !text(item.source_revision) ||
              !text(item.author_id) ||
              typeof item.content !== 'string' ||
              item.deletion_state !== 'active',
          ) ||
          result.items.reduce((total: number, item: any) => total + item.content.length, 0) >
            Number(request.fields.max_characters)
        )
          throw Error('Retrieved context has invalid provenance or exceeds its text limit.');
      }
      const current = await this.resolve(groupId);
      if (
        current.accountKey !== scope.accountKey ||
        current.organizationId !== scope.organizationId ||
        current.actorId !== scope.actorId ||
        current.projectId !== scope.projectId
      )
        throw Error('Account changed during the operation. Refresh project services.');
      return result;
    };
    if (!mutations.has(request.operation)) {
      const result = await send();
      if (request.operation === 'operation.inspect') {
        if (
          result.operation_id !== request.fields.operation_id ||
          !['unknown', 'pending', 'completed', 'failed', 'partial'].includes(String(result.state))
        )
          throw Error('Invalid operation inspection receipt.');
        if (['completed', 'failed'].includes(String(result.state))) {
          if (!text(result.receipt_id))
            throw Error('Operation inspection did not return a final receipt.');
          const key = createHash('sha256')
            .update(
              JSON.stringify([
                scope.accountKey,
                scope.organizationId,
                scope.actorId,
                scope.projectId,
                request.fields.operation_id,
              ]),
            )
            .digest('hex');
          await mkdir(this.root, { recursive: true, mode: 0o700 });
          await withDirectoryLock(
            this.root,
            async (owned) => {
              const file = join(this.root, key + '.json');
              let raw: string;
              try {
                raw = await readFile(file, 'utf8');
              } catch (error: any) {
                if (error.code === 'ENOENT') return;
                throw error;
              }
              if (raw.length > 240000) throw Error('Project service receipt exceeds its limit.');
              const previous = JSON.parse(raw);
              owned();
              const finalResult = result.receipt
                ? normalizeProjectResult(scoped(result.receipt as Record<string, unknown>, scope), {
                    operation: previous.operation,
                    fields: { operation_id: request.fields.operation_id },
                  })
                : result;
              await writeJSON(file, {
                ...previous,
                state: result.state,
                result: {
                  ...finalResult,
                  state: result.state,
                  ...(result.delivery ? { delivery: result.delivery } : {}),
                },
              });
            },
            key,
          );
        }
      }
      return result;
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          scope.accountKey,
          scope.organizationId,
          scope.actorId,
          scope.projectId,
          request.fields.operation_id,
        ]),
      )
      .digest('hex');
    const canonical = JSON.stringify([
      request.operation,
      Object.entries(request.fields).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    const signature = createHash('sha256').update(canonical).digest('hex');
    return withDirectoryLock(
      this.root,
      async (owned) => {
        const file = join(this.root, key + '.json');
        try {
          const raw = await readFile(file, 'utf8');
          if (raw.length > 240000) throw Error('Project service receipt exceeds its limit.');
          const previous = JSON.parse(raw);
          if (previous.signature !== signature)
            throw Error('Operation ID belongs to a different request.');
          if (previous.result) return scoped(previous.result, scope);
          throw Error(
            'The previous operation outcome is unknown. Inspect its operation ID before taking further action.',
          );
        } catch (error: any) {
          if (error.code !== 'ENOENT') throw error;
        }
        owned();
        const metadata = {
          signature,
          scope: {
            accountKey: scope.accountKey,
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actorId: scope.actorId,
          },
          operation: request.operation,
          operationId: request.fields.operation_id,
        };
        await writeJSON(file, { ...metadata, state: 'pending' });
        const result = await send();
        owned();
        await writeJSON(file, { ...metadata, state: result.state, result });
        return result;
      },
      key,
    );
  }
}
