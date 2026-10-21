import { uuid } from './credentials';

/** The API uses typed policy IDs; older deployments return UUIDs. */
export function policyId(value: unknown, kind: 'configuration' | 'version') {
  return (
    uuid(value) ||
    (typeof value === 'string' &&
      (kind === 'configuration' ? /^cfg_[a-f0-9]{32}$/ : /^cfgv_[a-f0-9]{32}$/).test(value))
  );
}
