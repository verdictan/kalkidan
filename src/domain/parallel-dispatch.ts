import type { Agent } from './conversation';
export interface DispatchRequest {
  id: string;
  groupId: string;
  agent: Agent;
  concurrency: number;
  tasks: { taskId: string; repositoryId: string }[];
}
export interface DispatchPlan extends DispatchRequest {
  state: 'review' | 'running' | 'paused' | 'completed' | 'canceled';
  rows: {
    taskId: string;
    repositoryId: string;
    title: string;
    prompt: string;
    revision: string;
    operationId: string;
    branch: string;
    state:
      | 'queued'
      | 'preparing'
      | 'dispatching'
      | 'running'
      | 'completed'
      | 'failed'
      | 'canceled'
      | 'uncertain';
    checkoutId?: string;
    runId?: string;
    message?: string;
  }[];
}
export interface ParallelDispatchAPI {
  dispatchReconcile(id: string, taskId: string, release: boolean): Promise<DispatchPlan>;
  dispatchPrepare(request: DispatchRequest): Promise<DispatchPlan>;
  dispatchStart(id: string): Promise<DispatchPlan>;
  dispatchStatus(id: string): Promise<DispatchPlan>;
  dispatchCancel(id: string): Promise<DispatchPlan>;
}
