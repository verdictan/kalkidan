/** Operations available to a session on either the Mac or an SSH execution host. */
export const remoteProtocolVersion = 5;
export const sessionHostMethods = [
  'ptyOpen',
  'ptyRead',
  'ptyWrite',
  'ptyResize',
  'ptyClose',
  'ptyAttach',
  'models',
  'transcript',
  'chatCreate',
  'chatStart',
  'chatStatus',
  'chatStop',
  'chatApprove',
  'chatRespond',
  'terminalStart',
  'terminalStatus',
  'terminalStop',
  'terminalInput',
  'repositoryDiff',
] as const;
export type SessionHostMethod = (typeof sessionHostMethods)[number];
export function providerSessionId(hostId: string, id: string) {
  return id.startsWith(hostId + '::') ? id.slice(hostId.length + 2) : id;
}
export function qualifiedSessionId(hostId: string, id: string) {
  return id ? hostId + '::' + providerSessionId(hostId, id) : '';
}
