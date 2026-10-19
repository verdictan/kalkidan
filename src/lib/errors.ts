// Electron adds a prefix to errors from IPC handlers, for example
// "Error invoking remote method 'x': Error: real message". Show only the real
// message to the user.
const ipcPrefix = /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

/** Returns a message for the user from an unknown error value. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(ipcPrefix, '');
}
