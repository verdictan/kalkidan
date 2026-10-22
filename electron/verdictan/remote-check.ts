import { keychainRefusedCode } from '../../src/domain/verdictan';

/** The method of the SSH helper that checks the managed agents account on its host again. */
export const hostCheckMethod = 'managed-check';

/**
 * Checks the managed agents account on each connected SSH host again. Only a user action, such
 * as Check status, calls this. A host that refused the keychain starts its runtime again, so the
 * system asks again. Returns the names of the hosts that still have no keychain access. An
 * older helper without the method, or a host that does not answer, is not in the list.
 */
export async function checkHostRuntimes(
  hosts: { id: string; name: string }[],
  call: (hostId: string, method: string, args: unknown[]) => Promise<unknown>,
) {
  const results = await Promise.allSettled(hosts.map((host) => call(host.id, hostCheckMethod, [])));
  return hosts
    .filter((_, index) => {
      const result = results[index];
      const value = result.status === 'fulfilled' ? result.value : undefined;
      return (value as { error?: unknown } | null | undefined)?.error === keychainRefusedCode;
    })
    .map((host) => host.name);
}
