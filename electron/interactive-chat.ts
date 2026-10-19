import { isAgent } from '../src/config/agents';
import { runtimeConfig } from './config/runtime';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { executable, normalizeChatFailure, applyChatEvent, chatArgs } from './chat';
import type { ChatRun, Session, ToolActivity } from '../src/types';

const bounded = (value: unknown, limit = 32000) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) || '';
  return text.length > limit ? '[Earlier output omitted]\n' + text.slice(-limit) : text;
};
interface Active {
  state: ChatRun;
  session: Session;
  process?: ChildProcessWithoutNullStreams;
  pending: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  approvals: Map<string, { wireId: string | number; method: string; params: any }>;
  stopped: boolean;
  finishing: boolean;
  stderr: string;
  messageId: string;
  killTimer?: ReturnType<typeof setTimeout>;
}

// Each turn owns its process. Closing it releases the provider's session writer.
// Approval responses are accepted only for pending requests in that exact run.
export class InteractiveChatRunner {
  private runs = new Map<string, Active>();
  constructor(
    private resolveExecutable = executable,
    private config = runtimeConfig(),
  ) {}
  async start(
    session: Session,
    prompt: string,
    allowEdits: boolean,
    create = false,
    model?: string,
    forkFrom?: string,
  ) {
    if (!isAgent(session.agent) || !/^[a-zA-Z0-9_-]{1,160}$/.test(session.id))
      throw new Error('Invalid session');
    if (forkFrom && (!create || !/^[a-zA-Z0-9_-]{1,160}$/.test(forkFrom)))
      throw new Error('Invalid fork source');
    if (
      typeof prompt !== 'string' ||
      !prompt.trim() ||
      prompt.length > 130000 ||
      typeof allowEdits !== 'boolean'
    )
      throw new Error('Enter a valid message.');
    if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(model))
      throw new Error('Invalid model ID');
    if (
      [...this.runs.values()].some(
        (r) =>
          r.state.status === 'running' &&
          (r.session.id === session.id || r.state.sessionId === session.id) &&
          r.session.agent === session.agent,
      )
    )
      throw new Error('This session already has a response in progress.');
    const state: ChatRun = {
      id: randomUUID(),
      agent: session.agent,
      sessionId: create && session.agent === 'codex' ? '' : session.id,
      sessionReady: false,
      status: 'running',
      messages: [],
      tools: [],
      approvals: [],
      activity: 'Starting agent…',
    };
    const active: Active = {
      state,
      session,
      pending: new Map(),
      approvals: new Map(),
      stopped: false,
      finishing: false,
      stderr: '',
      messageId: 'assistant',
    };
    this.runs.set(state.id, active);
    for (const [id, run] of this.runs)
      if (this.runs.size > 30 && run.state.status !== 'running' && !run.process)
        this.runs.delete(id);
    // Start asynchronously so the UI can show startup progress and Stop immediately.
    void this.launch(active, prompt, allowEdits, create, model, forkFrom).catch((error) => {
      if (!active.stopped && !active.finishing) {
        state.error = error.message;
        normalizeChatFailure(state, active.stderr);
        this.finish(active, 'failed');
      }
    });
    return state;
  }
  private write(run: Active, value: unknown) {
    if (!run.process || run.process.stdin.destroyed || run.stopped)
      throw new Error('Agent is no longer accepting requests.');
    run.process.stdin.write(JSON.stringify(value) + '\n');
  }
  private request(run: Active, method: string, params: unknown) {
    return new Promise<any>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        run.pending.delete(id);
        reject(
          new Error(
            `Agent timed out during ${method}. Check its installation and sign-in, then retry.`,
          ),
        );
      }, this.config.agentRequestTimeoutMs);
      run.pending.set(id, { resolve, reject, timer });
      try {
        this.write(
          run,
          run.session.agent === 'codex'
            ? { id, method, params }
            : {
                type: 'control_request',
                request_id: id,
                request: { subtype: method, ...(params as object) },
              },
        );
      } catch (e) {
        clearTimeout(timer);
        run.pending.delete(id);
        reject(e);
      }
    });
  }
  private async launch(
    run: Active,
    prompt: string,
    allowEdits: boolean,
    create: boolean,
    model?: string,
    forkFrom?: string,
  ) {
    for (const previous of this.runs.values()) {
      if (
        previous !== run &&
        previous.state.agent === run.session.agent &&
        previous.state.sessionId === run.session.id &&
        previous.finishing &&
        previous.process
      ) {
        await new Promise<void>((resolve) => previous.process!.once('close', () => resolve()));
      }
    }
    const resolved = await this.resolveExecutable(run.session.agent);
    if (run.stopped) return;
    const codex = run.session.agent === 'codex';
    const args = chatArgs(run.session.agent, run.session.id, allowEdits, create, model);
    if (forkFrom && !codex) {
      args.splice(-2, 2, '--resume', forkFrom, '--fork-session');
      run.state.sessionId = '';
    }
    const child = spawn(resolved.path, [...(resolved.args || []), ...args], {
      cwd: run.session.cwd,
      env: resolved.env,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    });
    run.process = child;
    let pending = '';
    const parse = (line: string) => {
      if (run.finishing || run.stopped) return;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        return;
      }
      try {
        this.event(run, row);
      } catch (e: any) {
        run.state.error = e.message;
        this.finish(run, 'failed');
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      if (pending.length > 8 * 1024 * 1024) {
        run.state.error = 'Agent output exceeded the supported size.';
        this.finish(run, 'failed');
        return;
      }
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      lines.forEach(parse);
    });
    child.stderr.on('data', (chunk: string) => {
      run.stderr = (run.stderr + chunk).slice(-12000);
    });
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      run.state.error = error.message;
      this.finish(run, 'failed');
    });
    child.on('close', () => {
      if (pending) parse(pending);
      if (run.killTimer) clearTimeout(run.killTimer);
      run.process = undefined;
      if (!run.finishing) {
        run.state.error ||=
          run.stderr ||
          'Agent exited before completing its response. Check its CLI version and sign-in.';
        normalizeChatFailure(run.state, run.stderr);
        this.finish(run, run.stopped ? 'stopped' : 'failed');
      }
      this.clearPending(run);
    });
    if (codex) {
      await this.request(run, 'initialize', {
        clientInfo: { name: 'kalkidan', title: 'Kalkidan', version: '0.1.0' },
      });
      this.write(run, { method: 'initialized', params: {} });
      const result = await this.request(
        run,
        forkFrom ? 'thread/fork' : create ? 'thread/start' : 'thread/resume',
        {
          ...(forkFrom
            ? { threadId: forkFrom, excludeTurns: true }
            : create
              ? {}
              : { threadId: run.session.id }),
          cwd: run.session.cwd,
          ...(model ? { model } : {}),
          sandbox: allowEdits ? 'workspace-write' : 'read-only',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      );
      const id = result?.thread?.id;
      if (typeof id !== 'string' || !id || id === forkFrom || (!create && id !== run.session.id))
        throw new Error(
          'The agent did not return the original session. Refresh history before continuing.',
        );
      run.state.sessionId = id;
      run.state.sessionReady = true;
      await this.request(run, 'turn/start', {
        threadId: id,
        input: [{ type: 'text', text: prompt }],
      });
    } else {
      await this.request(run, 'initialize', { hooks: {} });
      this.write(run, {
        type: 'user',
        session_id: forkFrom ? '' : run.session.id,
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
      });
    }
    if (!run.finishing)
      run.state.activity = run.approvals.size
        ? 'Waiting for your approval'
        : 'Waiting for response…';
  }
  private tool(run: Active, value: ToolActivity) {
    const tools = run.state.tools!;
    const existing = tools.find((t) => t.id === value.id);
    if (existing) Object.assign(existing, value);
    else if (tools.length < 200) tools.push(value);
  }
  private message(run: Active, id: string, text: string, append = false) {
    if (!text) return;
    const existing = run.state.messages.find((m) => m.id === id);
    if (existing) existing.text = bounded((append ? existing.text : '') + text, 2_000_000);
    else if (run.state.messages.length < 1000)
      run.state.messages.push({ id, role: 'assistant', text: bounded(text, 2_000_000) });
  }
  private approval(run: Active, wireId: string | number, method: string, params: any) {
    if (run.approvals.size >= 50)
      throw new Error('Too many pending permission requests. Stop and retry.');
    const id = String(wireId);
    if (run.approvals.has(id)) return;
    run.approvals.set(id, { wireId, method, params });
    const tool = run.state.tools?.find((t) => t.id === params.itemId);
    const details =
      method === 'can_use_tool'
        ? JSON.stringify(params.input, null, 2)
        : [
            params.command || tool?.title,
            params.cwd && `Folder: ${params.cwd}`,
            params.reason,
            params.grantRoot && `Write access: ${params.grantRoot}`,
            params.networkApprovalContext &&
              `Network access: ${JSON.stringify(params.networkApprovalContext)}`,
            (params.permissions || params.additionalPermissions) &&
              `Requested permissions:\n${JSON.stringify(params.permissions || params.additionalPermissions, null, 2)}`,
            tool?.diff,
          ]
            .filter(Boolean)
            .join('\n\n');
    if (details.length > 128000)
      throw new Error(
        'This permission request is too large to review in Kalkidan. Ask the agent to work in smaller steps.',
      );
    if (run.state.approvals!.length >= 200)
      run.state.approvals = run.state.approvals!.filter((a) => a.status === 'pending');
    run.state.approvals!.push({
      id,
      status: 'pending',
      title: params.tool_name
        ? `Allow ${params.tool_name}?`
        : method.includes('fileChange')
          ? 'Allow file changes?'
          : method.includes('permissions')
            ? 'Grant requested permissions?'
            : 'Allow command?',
      detail: details || 'Review the requested action before allowing it.',
      scope: method.includes('/permissions/') ? 'turn' : 'request',
    });
    run.state.activity = 'Waiting for your approval';
  }
  private event(run: Active, row: any) {
    const codex = run.session.agent === 'codex';
    const responseId =
      codex && !row.method
        ? row.id
        : row.type === 'control_response'
          ? row.response?.request_id
          : undefined;
    if (responseId !== undefined) {
      const callback = run.pending.get(String(responseId));
      if (callback) {
        clearTimeout(callback.timer);
        run.pending.delete(String(responseId));
        const error = codex
          ? row.error?.message
          : row.response?.subtype === 'error'
            ? row.response.error
            : null;
        if (error) callback.reject(new Error(error));
        else callback.resolve(codex ? row.result : row.response?.response);
      }
      return;
    }
    if (codex) {
      const p = row.params || {};
      if (p.threadId && run.state.sessionId && p.threadId !== run.state.sessionId) return;
      if (row.id !== undefined && row.method) {
        if (
          [
            'item/commandExecution/requestApproval',
            'item/fileChange/requestApproval',
            'item/permissions/requestApproval',
          ].includes(row.method)
        )
          this.approval(run, row.id, row.method, p);
        else {
          this.write(run, {
            id: row.id,
            error: {
              code: -32601,
              message: 'This interactive request is not supported by Kalkidan.',
            },
          });
          run.state.activity = 'An unsupported agent request was declined';
        }
        return;
      }
      if (row.method === 'serverRequest/resolved') this.expireApproval(run, String(p.requestId));
      if (row.method === 'item/agentMessage/delta') this.message(run, p.itemId, p.delta, true);
      if (row.method === 'turn/diff/updated') run.state.diff = bounded(p.diff, 128000);
      if (row.method === 'item/commandExecution/outputDelta') {
        const tool = run.state.tools!.find((t) => t.id === p.itemId);
        if (tool) tool.detail = bounded((tool.detail || '') + p.delta);
      }
      if (row.method === 'item/started' || row.method === 'item/completed') {
        const item = p.item;
        if (item?.type === 'agentMessage') {
          this.message(run, item.id, item.text);
          run.state.activity = 'Writing response…';
        }
        if (
          item &&
          ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'].includes(item.type)
        ) {
          this.tool(run, {
            id: item.id,
            title: bounded(
              item.command || item.tool || (item.type === 'fileChange' ? 'File changes' : 'Search'),
              200,
            ),
            status: item.status || (row.method === 'item/completed' ? 'completed' : 'inProgress'),
            detail: bounded(
              item.aggregatedOutput ?? item.result ?? item.changes ?? item.query ?? '',
            ),
            ...(item.type === 'fileChange'
              ? {
                  diff: bounded(
                    item.changes?.map((c: any) => `${c.path}\n${c.diff || ''}`).join('\n'),
                  ),
                }
              : {}),
          });
          run.state.activity =
            row.method === 'item/completed'
              ? 'Step completed'
              : item.type === 'fileChange'
                ? 'Updating files…'
                : 'Working…';
        }
      }
      if (row.method === 'error' && !p.willRetry)
        run.state.error = p.error?.message || 'Codex reported an error.';
      if (row.method === 'turn/completed') {
        if (p.turn?.error) run.state.error = p.turn.error.message;
        this.finish(
          run,
          run.state.error || p.turn?.status === 'failed'
            ? 'failed'
            : p.turn?.status === 'interrupted'
              ? 'stopped'
              : 'completed',
        );
      }
    } else {
      if (row.type === 'control_request') {
        if (row.request?.subtype === 'can_use_tool')
          this.approval(run, row.request_id, 'can_use_tool', row.request);
        else
          this.write(run, {
            type: 'control_response',
            response: {
              subtype: 'error',
              request_id: row.request_id,
              error: 'Unsupported control request',
            },
          });
        return;
      }
      if (row.type === 'control_cancel_request') {
        this.expireApproval(run, row.request_id);
        return;
      }
      if (row.parent_tool_use_id) return;
      if (row.type === 'stream_event') {
        if (row.event?.type === 'message_start')
          run.messageId = row.event.message?.id || 'assistant';
        if (row.event?.delta?.type === 'text_delta')
          this.message(run, run.messageId, row.event.delta.text, true);
      } else {
        applyChatEvent(run.state, row);
        if (row.type === 'assistant')
          for (const block of row.message?.content || [])
            if (block.type === 'tool_use') {
              const input = block.input || {};
              this.tool(run, {
                id: block.id,
                title: block.name,
                status: 'inProgress',
                detail: bounded(input),
                ...(['Edit', 'Write'].includes(block.name)
                  ? {
                      diff: bounded(
                        `${input.file_path || ''}\n${block.name === 'Edit' ? '-' + (input.old_string || '') + '\n+' + (input.new_string || '') : input.content || ''}`,
                      ),
                    }
                  : {}),
              });
            }
        if (row.type === 'user' && Array.isArray(row.message?.content))
          for (const block of row.message.content)
            if (block.type === 'tool_result') {
              const tool = run.state.tools!.find((t) => t.id === block.tool_use_id);
              if (tool) {
                tool.status = block.is_error ? 'failed' : 'completed';
                tool.detail = bounded((tool.detail || '') + '\n' + bounded(block.content));
              }
            }
        if (row.type === 'result')
          this.finish(run, run.state.error || row.is_error ? 'failed' : 'completed');
      }
    }
  }
  approve(id: string, approvalId: string, allow: boolean) {
    const run = this.runs.get(id);
    const pending = run?.approvals.get(approvalId);
    if (
      !run ||
      !pending ||
      run.state.status !== 'running' ||
      run.finishing ||
      typeof allow !== 'boolean'
    )
      throw new Error('This approval request is no longer pending.');
    const { wireId, method, params } = pending;
    if (run.session.agent === 'codex')
      this.write(run, {
        id: wireId,
        result: method.includes('/permissions/')
          ? { permissions: allow ? params.permissions : {}, scope: 'turn' }
          : { decision: allow ? 'accept' : 'decline' },
      });
    else
      this.write(run, {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: wireId,
          response: allow
            ? { behavior: 'allow', updatedInput: params.input }
            : { behavior: 'deny', message: 'The user declined this request in Kalkidan.' },
        },
      });
    run.approvals.delete(approvalId);
    const approval = run.state.approvals!.find((a) => a.id === approvalId)!;
    approval.status = allow ? 'approved' : 'denied';
    run.state.activity = run.approvals.size
      ? 'Waiting for your approval'
      : allow
        ? 'Approved. Continuing…'
        : 'Request declined. Continuing…';
  }
  private expireApproval(run: Active, id: string) {
    run.approvals.delete(id);
    const approval = run.state.approvals!.find((a) => a.id === id);
    if (approval?.status === 'pending') approval.status = 'expired';
  }
  private clearPending(run: Active) {
    for (const p of run.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Agent connection closed.'));
    }
    run.pending.clear();
    for (const id of run.approvals.keys()) this.expireApproval(run, id);
  }
  private finish(run: Active, status: ChatRun['status']) {
    if (run.finishing) return;
    run.finishing = true;
    run.state.status = status;
    if (status === 'failed') normalizeChatFailure(run.state, run.stderr);
    run.state.activity =
      status === 'completed'
        ? 'Response complete'
        : status === 'stopped'
          ? 'Stopped'
          : 'Response failed';
    this.clearPending(run);
    run.process?.stdin.end();
    // App Server is long-lived; terminate this owned process after the turn is persisted.
    if (run.process?.pid) {
      const pid = run.process.pid;
      try {
        if (process.platform === 'win32') run.process!.kill('SIGTERM');
        else process.kill(-pid, 'SIGTERM');
      } catch {}
      run.killTimer = setTimeout(() => {
        try {
          if (process.platform === 'win32') run.process!.kill('SIGKILL');
          else process.kill(-pid, 'SIGKILL');
        } catch {}
      }, 2000);
      run.killTimer.unref();
    }
  }
  status(id: string) {
    const run = this.runs.get(id);
    if (!run) throw new Error('Response no longer available. Reopen the session.');
    return run.state;
  }
  stop(id: string) {
    const run = this.runs.get(id);
    if (!run || run.state.status !== 'running') return;
    run.stopped = true;
    this.finish(run, 'stopped');
  }
  stopAll() {
    for (const id of this.runs.keys()) this.stop(id);
  }
  runningCount() {
    return [...this.runs.values()].filter((run) => run.state.status === 'running').length;
  }
  dispose() {
    this.stopAll();
    for (const run of this.runs.values()) {
      if (run.killTimer) clearTimeout(run.killTimer);
      if (run.process?.pid) {
        try {
          if (process.platform === 'win32') run.process.kill('SIGKILL');
          else process.kill(-run.process.pid, 'SIGKILL');
        } catch {}
      }
    }
  }
}
