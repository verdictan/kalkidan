// Synthetic native protocol fixtures adapted from Verdictan cli/ci/native-agent-probe/probe.mjs.
export function hasToolResult(body, family) {
  const output = (value) =>
    typeof value === 'string'
      ? value.includes('verdictan-fixture')
      : Array.isArray(value) &&
        value.some(
          (item) => typeof item?.text === 'string' && item.text.includes('verdictan-fixture'),
        );
  if (family === 'responses')
    return (
      Array.isArray(body.input) &&
      body.input.some(
        (item) =>
          item.type === 'function_call_output' &&
          item.call_id === 'call_fixture' &&
          output(item.output),
      )
    );
  return (
    Array.isArray(body.messages) &&
    body.messages.some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some(
          (item) =>
            item.type === 'tool_result' &&
            item.tool_use_id === 'call_fixture' &&
            item.is_error !== true &&
            output(item.content),
        ),
    )
  );
}
export function selectTool(body) {
  for (const tool of body.tools ?? []) {
    if (tool.name === 'Bash' || tool.name === 'shell_command')
      return { name: tool.name, args: { command: 'printf verdictan-fixture' } };
    if (tool.name === 'exec_command')
      return { name: tool.name, args: { cmd: 'printf verdictan-fixture' } };
  }
  throw new Error('No supported harmless shell tool advertised; adapter remains unsupported');
}
export function nativeProbeSucceeded({
  mode,
  result,
  requests,
  toolResult,
  attached,
  compacted,
  compactionResumed,
  subagentObserved,
  subagentCompleted,
  canceled,
}) {
  if (result.timeout) return false;
  const count = requests.filter((request) => !request.unsupported).length;
  const output = result.stdout + result.stderr;
  switch (mode) {
    case 'tool-cycle':
      return result.code === 0 && toolResult;
    case 'attachment':
      return result.code === 0 && toolResult && attached;
    case 'compaction':
      return result.code === 0 && toolResult && compacted && compactionResumed;
    case 'subagent':
      return result.code === 0 && subagentObserved && subagentCompleted;
    case 'cancel':
    case 'cancel-before-headers':
      return canceled && count === 1;
    case 'policy-denial':
      return (
        result.code !== 0 &&
        count === 0 &&
        /usage_authorization_denied|fixture-policy-denied/.test(output)
      );
    case 'provider-error':
      return (
        result.code !== 0 &&
        count === 1 &&
        /fixture-invalid-request|fixture_invalid_request/.test(output)
      );
    case 'partial-stream':
      return result.code !== 0 && count === 1;
    case 'control-plane-outage':
    case 'revocation-between-turns':
      return (
        result.code !== 0 &&
        count === 1 &&
        /auth|credential|revok|unavailable|validate|invalid.api.key/i.test(output)
      );
    default:
      return false;
  }
}
export function toolAdvertised(body, selected) {
  const tools = selected.namespace
    ? ((body.tools ?? []).find(
        (tool) => tool.name === selected.namespace && tool.type === 'namespace',
      )?.tools ?? [])
    : (body.tools ?? []);
  return tools.some((tool) => tool.name === selected.name && tool.type !== 'namespace');
}
export function isCompactionRequest(body, family) {
  if (family === 'responses') return Array.isArray(body.tools) && body.tools.length === 0;
  return (
    family === 'messages' &&
    JSON.stringify(body.messages?.at(-1)?.content ?? '').includes(
      'Please provide your summary based on the conversation so far',
    )
  );
}
export function responseEvents(body, family, completed, selectedTool) {
  const tool = completed ? null : (selectedTool ?? selectTool(body));
  if (family === 'messages') {
    const block = tool
      ? { type: 'tool_use', id: 'call_fixture', name: tool.name, input: {} }
      : { type: 'text', text: '' };
    return [
      {
        type: 'message_start',
        message: {
          id: 'msg_fixture',
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: block },
      {
        type: 'content_block_delta',
        index: 0,
        delta: tool
          ? { type: 'input_json_delta', partial_json: JSON.stringify(tool.args) }
          : { type: 'text_delta', text: 'Fixture complete.' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      },
      { type: 'message_stop' },
    ];
  }
  const item = tool
    ? {
        type: 'function_call',
        id: 'fc_fixture',
        call_id: 'call_fixture',
        name: tool.name,
        ...(tool.namespace ? { namespace: tool.namespace } : {}),
        arguments: JSON.stringify(tool.args),
        status: 'completed',
      }
    : {
        type: 'message',
        id: 'msg_fixture',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Fixture complete.', annotations: [] }],
      };
  const response = {
    id: 'resp_fixture',
    object: 'response',
    created_at: 1,
    model: body.model,
    status: 'in_progress',
    output: [],
  };
  return [
    { type: 'response.created', response },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, status: 'in_progress', ...(tool ? { arguments: '' } : { content: [] }) },
    },
    ...(tool
      ? [
          {
            type: 'response.function_call_arguments.delta',
            item_id: item.id,
            output_index: 0,
            delta: item.arguments,
          },
          {
            type: 'response.function_call_arguments.done',
            item_id: item.id,
            output_index: 0,
            arguments: item.arguments,
          },
        ]
      : [
          {
            type: 'response.content_part.added',
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] },
          },
          {
            type: 'response.output_text.delta',
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            delta: 'Fixture complete.',
          },
          {
            type: 'response.output_text.done',
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            text: 'Fixture complete.',
          },
          {
            type: 'response.content_part.done',
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            part: item.content[0],
          },
        ]),
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: {
        ...response,
        status: 'completed',
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ].map((event, sequence_number) => ({ ...event, sequence_number }));
}
