import type { SessionHostAPI } from '../api/contracts';
import { providerSessionId, qualifiedSessionId, type SessionHostMethod } from '../domain/host';
import type { API, Session, ChatRun } from '../types';
// Bind session operations to one host; project/tracker metadata stays in the Mac UI.
export function sessionAPI(api: API, session: Session): API {
  if (!session.hostId) return api;
  const hostId = session.hostId;
  const call = <M extends SessionHostMethod>(method: M, ...args: Parameters<SessionHostAPI[M]>) =>
    api.remoteCall(hostId, method, args);
  const provider = (id: string) => providerSessionId(hostId, id);
  const qualify = (run: ChatRun) => ({
    ...run,
    sessionId: qualifiedSessionId(hostId, run.sessionId),
  });
  return {
    ...api,
    ptyOpen: (cwd, cols, rows) => call('ptyOpen', cwd, cols, rows),
    ptyRead: (id, cursor) => call('ptyRead', id, cursor),
    ptyWrite: (id, input) => call('ptyWrite', id, input),
    ptyResize: (id, cols, rows) => call('ptyResize', id, cols, rows),
    ptyClose: (id) => call('ptyClose', id),
    models: (agent) => call('models', agent),
    transcript: (agent, id) => call('transcript', agent, provider(id)),
    chatCreate: (_id, agent, prompt, edits, options) =>
      call('chatCreate', session.cwd, agent, prompt, edits, {
        ...options,
        forkFrom: options?.forkFrom ? provider(options.forkFrom) : undefined,
      }).then(qualify),
    chatStart: (agent, id, prompt, edits, options) =>
      call('chatStart', agent, provider(id), prompt, edits, options).then(qualify),
    chatStatus: (id) => call('chatStatus', id).then(qualify),
    chatStop: (id) => call('chatStop', id),
    chatApprove: (id, approval, allow) => call('chatApprove', id, approval, allow),
    chatRespond: (id, request, answers) => call('chatRespond', id, request, answers),
    terminalStart: (cwd, command) => call('terminalStart', cwd, command),
    terminalStatus: (id) => call('terminalStatus', id),
    terminalInput: (id, value) => call('terminalInput', id, value),
    terminalStop: (id) => call('terminalStop', id),
    repositoryDiff: (cwd) => call('repositoryDiff', cwd),
  };
}
