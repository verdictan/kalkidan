import type { PrepareManagedLaunch } from './managed-launch';
import { pathContains } from '../platform';
import type { ManagedProjectContext } from './memory-tools';
import type { Agent, ChatRun, Session } from '../../src/domain/conversation';
import { agentCatalog } from '../../src/config/agents';
import { InteractiveChatRunner } from '../interactive-chat';

/** Native protocol implementations own processes, approvals, and session locks. */
export interface AgentRuntime {
  start(
    session: Session,
    prompt: string,
    allowEdits: boolean,
    create?: boolean,
    model?: string,
    forkFrom?: string,
    memory?: ManagedProjectContext,
  ): Promise<ChatRun>;
  status(id: string): ChatRun;
  stop(id: string): void;
  approve(id: string, approvalId: string, allow: boolean): void;
  respond?(id: string, requestId: string, answers: unknown): void;
  stopAll(): void;
  dispose(): void;
  /** Number of runs that are still working. Optional for test adapters. */
  runningCount?(): number;
  checkoutBusy?(path: string): boolean;
}

/** Routes by explicit registration; an unknown provider never falls through to Claude. */
export class AgentRuntimes implements AgentRuntime {
  private adapters = new Map<Agent, AgentRuntime>();
  private owners = new Map<string, AgentRuntime>();
  private checkoutOperations = new Set<string>();
  constructor(registrations: ReadonlyArray<{ id: Agent; runtime: AgentRuntime }>) {
    for (const { id, runtime } of registrations) {
      if (this.adapters.has(id)) throw new Error(`Duplicate agent runtime: ${id}`);
      this.adapters.set(id, runtime);
    }
  }
  async start(
    session: Session,
    ...args: Parameters<AgentRuntime['start']> extends [Session, ...infer Rest] ? Rest : never
  ) {
    if ([...this.checkoutOperations].some((path) => pathContains(path, session.cwd)))
      throw new Error(
        'This checkout has a repository operation in progress. Retry after it finishes.',
      );
    const runtime = this.adapters.get(session.agent);
    if (!runtime) throw new Error(`Agent runtime “${session.agent}” is unavailable.`);
    const run = await runtime.start(session, ...args);
    this.owners.set(run.id, runtime);
    // Drop routing entries once the adapter evicts old completed runs.
    for (const [id, owner] of this.owners) {
      try {
        owner.status(id);
      } catch {
        this.owners.delete(id);
      }
    }
    return run;
  }
  async withCheckoutIdle<T>(path: string, action: () => Promise<T>): Promise<T> {
    if (
      [...this.checkoutOperations].some(
        (other) => pathContains(other, path) || pathContains(path, other),
      )
    )
      throw new Error('A repository operation is already in progress for this checkout.');
    if (
      [...this.adapters.values()].some(
        (runtime) => !runtime.checkoutBusy || runtime.checkoutBusy(path),
      )
    )
      throw new Error('Stop the agents using this worktree before removing it.');
    this.checkoutOperations.add(path);
    try {
      return await action();
    } finally {
      this.checkoutOperations.delete(path);
    }
  }
  private owner(id: string) {
    const runtime = this.owners.get(id);
    if (!runtime) throw new Error('Response no longer available. Reopen the session.');
    return runtime;
  }
  status(id: string) {
    return this.owner(id).status(id);
  }
  stop(id: string) {
    this.owners.get(id)?.stop(id);
  }
  approve(id: string, approvalId: string, allow: boolean) {
    const runtime = this.owners.get(id);
    if (!runtime) throw new Error('This approval is no longer pending.');
    runtime.approve(id, approvalId, allow);
  }
  respond(id: string, requestId: string, answers: unknown) {
    const runtime = this.owner(id);
    if (!runtime.respond) throw new Error('This agent does not support questions.');
    runtime.respond(id, requestId, answers);
  }
  stopAll() {
    for (const runtime of new Set(this.adapters.values())) runtime.stopAll();
  }
  runningCount() {
    let count = 0;
    for (const runtime of new Set(this.adapters.values())) count += runtime.runningCount?.() ?? 0;
    return count;
  }
  dispose() {
    for (const runtime of new Set(this.adapters.values())) runtime.dispose();
    this.owners.clear();
  }
}

/** One composition point used by both the desktop process and the SSH agent. */
export function createAgentRuntimes(prepareManaged: PrepareManagedLaunch) {
  return new AgentRuntimes(
    agentCatalog.map(({ id }) => ({
      id,
      runtime: new InteractiveChatRunner(undefined, undefined, false, prepareManaged),
    })),
  );
}
