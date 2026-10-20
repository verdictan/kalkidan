import type { Agent, AgentAnswers, AgentQuestion } from '../../src/domain/conversation';

function text(value: unknown, limit: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit)
    throw new Error('Invalid agent question.');
  return value;
}
/** Keep provider payloads at the boundary. Question answers never grant tool permissions. */
export function parseQuestions(provider: Agent, input: unknown): AgentQuestion[] {
  if (!Array.isArray(input) || !input.length || input.length > 10)
    throw new Error('Invalid agent questions.');
  const result = input.map((q, index): AgentQuestion => {
    if (!q || typeof q !== 'object') throw new Error('Invalid agent question.');
    const options = q.options == null ? [] : q.options;
    if (!Array.isArray(options) || options.length > 20)
      throw new Error('Invalid question options.');
    const parsed = options.map((o) => ({
      label: text(o?.label, 200),
      description: typeof o?.description === 'string' ? o.description.slice(0, 2000) : '',
    }));
    if (new Set(parsed.map((o) => o.label)).size !== parsed.length)
      throw new Error('Duplicate question options.');
    return {
      id: provider === 'codex' ? text(q.id, 200) : String(index),
      label: text(q.header, 200),
      question: text(q.question, 8000),
      kind: !parsed.length
        ? 'text'
        : q.multiSelect === true && provider === 'claude'
          ? 'multiple-choice'
          : 'single-choice',
      options: parsed,
      allowOther: provider === 'claude' || q.isOther === true || !parsed.length,
      secret: q.isSecret === true,
    };
  });
  if (
    new Set(result.map((q) => q.id)).size !== result.length ||
    (provider === 'claude' && new Set(result.map((q) => q.question)).size !== result.length)
  )
    throw new Error('Duplicate agent question.');
  return result;
}

export function validateAnswers(questions: AgentQuestion[], input: unknown): AgentAnswers {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Enter an answer for each question.');
  const values = input as Record<string, unknown>;
  if (Object.keys(values).length !== questions.length)
    throw new Error('Answer only the requested questions.');
  const answers: AgentAnswers = Object.create(null);
  let total = 0;
  for (const q of questions) {
    const value = Object.hasOwn(values, q.id) ? values[q.id] : undefined;
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > 20 ||
      (q.kind !== 'multiple-choice' && value.length !== 1)
    )
      throw new Error('Enter a valid answer for each question.');
    answers[q.id] = value.map((answer) => text(answer, 4000));
    if (new Set(answers[q.id]).size !== answers[q.id].length)
      throw new Error('Select each option only once.');
    if (!q.allowOther && answers[q.id].some((v) => !q.options.some((o) => o.label === v)))
      throw new Error('Choose an available option.');
    total += answers[q.id].join('').length;
  }
  if (total > 32000) throw new Error('Answers are too long.');
  return answers;
}
