import { providerAccessModes } from './verdictan';

/**
 * Resume compatibility for saved native conversations.
 *
 * Kalkidan owns this decision. Verdictan supplies the binding constraints
 * (`desktop-conversation-binding.v1`) and validates current authorization on every request.
 * A compatible result is necessary, never sufficient, for dispatch.
 */

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scopePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Identifiers compare without case, as in the shared contract. */
const identityFields = [
  'organization_id',
  'user_id',
  'region_id',
  'provider_connection_id',
  'installation_id',
  'host_id',
  'conversation_id',
] as const;

/** Frozen fields of `desktop-conversation-binding.v1`, in contract order. */
export const sharedResumeFields = [
  ...identityFields,
  'provider',
  'model',
  'agent_kind',
  'agent_version',
  'context_format_version',
] as const;

/** Kalkidan session fields. A change to one of these also blocks resume. */
export const sessionResumeFields = [
  'provider_access_mode',
  'configuration_id',
  'configuration_version_id',
  'project_id',
  'task_id',
  'cwd',
] as const;

export type ResumeField =
  (typeof sharedResumeFields)[number] | (typeof sessionResumeFields)[number];

/**
 * A change to one of these fields changes who is authorized, which account pays, or where work
 * runs. Only a new authorized session can change them.
 */
export const accessResumeFields: readonly ResumeField[] = [
  'organization_id',
  'user_id',
  'region_id',
  'provider_connection_id',
  'provider_access_mode',
  'provider',
  'installation_id',
  'host_id',
];

/**
 * - `none`: the saved context continues. Kalkidan must still check the gateway and current policy.
 * - `explicit_context_transfer`: the native context changed. Start a new conversation. The user
 *   must transfer context explicitly; Kalkidan never transfers it automatically.
 * - `new_authorized_session`: the access binding changed or a binding is not valid. Start a new
 *   authorized session. No saved context carries over.
 */
export type ResumeGuidance = 'none' | 'explicit_context_transfer' | 'new_authorized_session';

export interface ResumeDecision {
  schema_version: 1;
  status: 'compatible' | 'incompatible' | 'invalid';
  code: null | 'desktop.resume_binding_invalid' | 'desktop.resume_incompatible';
  /** Field names only. Values are never echoed. */
  mismatched_fields: ResumeField[];
  recovery_action:
    'check_gateway_and_current_policy' | 'explicit_reauthorization_and_context_transfer';
  dispatch_allowed: false;
  requires_gateway_readiness: true;
  requires_current_policy_evaluation: true;
  transfer_authorized: false;
  /** Kalkidan extension of `desktop-resume-result.v1`. */
  guidance: ResumeGuidance;
}

export interface ResumeOptions {
  /** A fork starts a new conversation from the saved one, so `conversation_id` can change. */
  fork?: boolean;
}

type BindingRecord = Record<string, unknown>;

const string = (value: unknown): value is string => typeof value === 'string';
const optional = (value: unknown, valid: (value: unknown) => boolean) =>
  value === undefined || valid(value);
const subscription = (mode: unknown) =>
  mode === 'codex_subscription' || mode === 'claude_subscription';

/** Applies the shared contract and the Kalkidan session-field shapes. Fails closed. */
function parse(input: unknown): BindingRecord | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as BindingRecord;
  const mode = record.provider_access_mode;
  if (record.schema_version !== 1) return null;
  if (mode !== undefined && !providerAccessModes.includes(mode as never)) return null;
  for (const key of identityFields) {
    const value = record[key];
    // Subscription modes have no provider connection. The value is then an empty string.
    if (key === 'provider_connection_id' && subscription(mode) && value === '') continue;
    if (!string(value) || !uuidPattern.test(value)) return null;
  }
  if (!string(record.provider) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(record.provider)) return null;
  if (!string(record.model) || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/.test(record.model))
    return null;
  if (record.agent_kind !== 'codex' && record.agent_kind !== 'claude_code') return null;
  if (
    !string(record.agent_version) ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]{1,64})?$/.test(record.agent_version)
  )
    return null;
  if (
    !Number.isSafeInteger(record.context_format_version) ||
    (record.context_format_version as number) < 1
  )
    return null;
  if (
    !optional(record.project_id, (v) => string(v) && scopePattern.test(v)) ||
    !optional(record.task_id, (v) => string(v) && scopePattern.test(v)) ||
    !optional(record.configuration_id, (v) => string(v) && v !== '') ||
    !optional(record.configuration_version_id, (v) => string(v) && v !== '') ||
    !optional(record.cwd, (v) => string(v) && v !== '')
  )
    return null;
  return record;
}

function same(field: ResumeField, previous: BindingRecord, current: BindingRecord) {
  if (field === 'provider_access_mode')
    return (previous[field] ?? 'byok') === (current[field] ?? 'byok');
  if ((identityFields as readonly string[]).includes(field))
    return String(previous[field]).toLowerCase() === String(current[field]).toLowerCase();
  // A saved governance scope cannot change or disappear. A conversation without a saved scope can
  // get one when its project becomes managed; Verdictan evaluates the current project policy.
  if ((field === 'project_id' || field === 'task_id') && previous[field] === undefined) return true;
  return previous[field] === current[field];
}

/**
 * Compares a saved conversation binding with the binding that the new authorized runtime
 * requests. Load `saved` from the trusted conversation record, never from the caller.
 * No input is changed, and no context is transferred.
 */
export function decideConversationResume(
  saved: unknown,
  requested: unknown,
  options: ResumeOptions = {},
): ResumeDecision {
  const previous = parse(saved);
  const current = parse(requested);
  const mismatched =
    previous && current
      ? [...sharedResumeFields, ...sessionResumeFields].filter(
          (field) =>
            !(options.fork && field === 'conversation_id') && !same(field, previous, current),
        )
      : [];
  const status =
    !previous || !current ? 'invalid' : mismatched.length ? 'incompatible' : 'compatible';
  return {
    schema_version: 1,
    status,
    code:
      status === 'invalid'
        ? 'desktop.resume_binding_invalid'
        : status === 'incompatible'
          ? 'desktop.resume_incompatible'
          : null,
    mismatched_fields: mismatched,
    recovery_action:
      status === 'compatible'
        ? 'check_gateway_and_current_policy'
        : 'explicit_reauthorization_and_context_transfer',
    dispatch_allowed: false,
    requires_gateway_readiness: true,
    requires_current_policy_evaluation: true,
    transfer_authorized: false,
    guidance:
      status === 'compatible'
        ? 'none'
        : status === 'invalid' || mismatched.some((field) => accessResumeFields.includes(field))
          ? 'new_authorized_session'
          : 'explicit_context_transfer',
  };
}
