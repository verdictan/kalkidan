/**
 * Mentions in the chat composer. A mention is plain text in the message, for example
 * `@[auth.ts](file:src/auth.ts)`. The text stays correct when the user copies, pastes or edits
 * it. The desktop app finds the mentions in the message and gives their content to the agent.
 */
export const mentionKinds = ['file', 'doc', 'task', 'memory', 'chat'] as const;
export type MentionKind = (typeof mentionKinds)[number];
export interface Mention {
  kind: MentionKind;
  /** File: the path relative to the chat folder. Chat: `agent:sessionId`. Other: the item ID. */
  id: string;
  label: string;
}

/** The files of a chat folder for the "@" picker. */
export interface MentionFileList {
  files: string[];
  /** True when the folder has more files than the list. */
  truncated: boolean;
}

/** The content of a mentioned file. `content` is empty for large or binary files. */
export interface MentionFileContent {
  path: string;
  size: number;
  content?: string;
  truncated?: boolean;
  note?: string;
}

/** The limits of the mention context. All values are characters unless the name says other. */
export const mentionLimits = {
  /** The maximum number of mentions in one message. Kalkidan ignores the other mentions. */
  mentions: 10,
  /** The maximum length of all mention context in one message. */
  total: 24000,
  /** The maximum number of files in the picker list. */
  files: 20000,
  /** A file larger than this number of bytes is given as a path only. */
  fileBytes: 64 * 1024,
  fileCharacters: 8000,
  /** The same limit as the "@docs" passages. */
  doc: 4800,
  task: 4000,
  memory: 2000,
  chatMessages: 6,
  chatMessage: 800,
  chat: 4000,
  label: 80,
  id: 1000,
} as const;

const tokenPattern = new RegExp(
  String.raw`@\[([^\[\]\n]{1,${mentionLimits.label}})\]\((${mentionKinds.join('|')}):([^\s()]{1,${mentionLimits.id}})\)`,
  'g',
);

/** Encodes the characters that would end the token. Paths stay readable. */
function encodeId(id: string) {
  return id.replace(/[%()\s]/gu, (char) =>
    char === '(' ? '%28' : char === ')' ? '%29' : encodeURIComponent(char),
  );
}
function decodeId(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    return null;
  }
}

/** The label without the characters that would end the token. */
export function mentionLabel(label: string) {
  const clean = label
    .replace(/[[\]\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (clean || 'Untitled').slice(0, mentionLimits.label).trim();
}

/** The text of a mention, for example `@[auth.ts](file:src/auth.ts)`. */
export function mentionToken(mention: Mention) {
  return `@[${mentionLabel(mention.label)}](${mention.kind}:${encodeId(mention.id)})`;
}

/** The parts of a text: plain strings and mentions, in order. */
export function mentionSegments(text: string): (string | (Mention & { token: string }))[] {
  const parts: (string | (Mention & { token: string }))[] = [];
  let last = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const id = decodeId(match[3]);
    if (id === null || !id) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ kind: match[2] as MentionKind, id, label: match[1], token: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** The different mentions of a text, at most `mentionLimits.mentions`. */
export function parseMentions(text: string): Mention[] {
  const found: Mention[] = [];
  const seen = new Set<string>();
  for (const part of mentionSegments(text)) {
    if (typeof part === 'string') continue;
    const key = part.kind + ':' + part.id;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ kind: part.kind, id: part.id, label: part.label });
    if (found.length >= mentionLimits.mentions) break;
  }
  return found;
}

/** The text with each mention as its label, for titles and previews. */
export function mentionPlainText(text: string) {
  return mentionSegments(text)
    .map((part) => (typeof part === 'string' ? part : '@' + part.label))
    .join('');
}

/**
 * The "@" word before the caret, or null. The "@" must be at the start of the text or after a
 * space. The query has no spaces.
 */
export function activeMention(text: string, caret: number) {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const match = before.match(/(^|[\s(])@([^\s@[\]()]{0,100})$/u);
  if (!match) return null;
  const start = caret - match[2].length - 1;
  return { start, query: match[2] };
}

/** Puts a mention in place of the "@" word. Returns the new text and the caret position. */
export function insertMention(text: string, start: number, end: number, insert: string) {
  const after = text.slice(end);
  const spacer = /^\s/.test(after) ? '' : ' ';
  const next = text.slice(0, start) + insert + spacer + after;
  return { text: next, caret: start + insert.length + spacer.length };
}

/**
 * Removes a whole mention when the caret is at its end, for Backspace. Returns null when no
 * mention ends at the caret.
 */
export function removeMentionBefore(text: string, caret: number) {
  const before = text.slice(0, caret);
  let found: { index: number; length: number } | null = null;
  for (const match of before.matchAll(tokenPattern))
    if (match.index + match[0].length === caret)
      found = { index: match.index, length: match[0].length };
  if (!found) return null;
  return { text: text.slice(0, found.index) + text.slice(caret), caret: found.index };
}

/** Removes each copy of a mention from the text. */
export function removeMention(text: string, mention: Mention) {
  return mentionSegments(text)
    .filter(
      (part) => typeof part === 'string' || part.kind !== mention.kind || part.id !== mention.id,
    )
    .map((part) => (typeof part === 'string' ? part : part.token))
    .join('')
    .replace(/ {2,}/g, ' ');
}

/**
 * A fuzzy match score, or null when the query letters are not in the text in order. A higher
 * score is a better match. Letters at the start of a word and letters in a row score more.
 */
export function fuzzyScore(query: string, text: string) {
  const q = query.toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of q) {
    const index = t.indexOf(char, from);
    if (index < 0) return null;
    score += 1;
    if (index === previous + 1) score += 3;
    if (index === 0 || /[\s/._-]/.test(t[index - 1])) score += 2;
    previous = index;
    from = index + 1;
  }
  if (t.includes(q)) score += 5;
  return score - t.length / 1000;
}

/** A file path scores higher when the query matches its name. */
export function fileScore(query: string, path: string) {
  const full = fuzzyScore(query, path);
  if (full === null) return null;
  const name = path.slice(path.lastIndexOf('/') + 1);
  const short = fuzzyScore(query, name);
  return short === null ? full : Math.max(full, short + 10);
}

/** The chat mention ID: the agent and the session ID. */
export function chatMentionId(agent: string, id: string) {
  return `${agent}:${id}`;
}
export function parseChatMentionId(value: string) {
  const at = value.indexOf(':');
  if (at <= 0 || at === value.length - 1) return null;
  return { agent: value.slice(0, at), id: value.slice(at + 1) };
}
