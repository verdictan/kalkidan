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
  ): Promise<ChatRun>;
  status(id: string): ChatRun;
  stop(id: string): void;
  approve(id: string, approvalId: string, allow: boolean): void;
  stopAll(): void;
  dispose(): void;
  /** Number of runs that are still working. Optional for test adapters. */
  runningCount?(): number;
}

/** Routes by explicit registration; an unknown provider never falls through to Claude. */
export class AgentRuntimes implements AgentRuntime {
  private adapters = new Map<Agent, AgentRuntime>();
  private owners = new Map<string, AgentRuntime>();
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
export function createAgentRuntimes() {
  return new AgentRuntimes(
    agentCatalog.map(({ id }) => ({ id, runtime: new InteractiveChatRunner() })),
  );
}
