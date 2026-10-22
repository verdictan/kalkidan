/**
 * Memory shows as one page: each topic is a heading and each fact is a bullet. These functions
 * map the text that the user types in that page to the facts of the memory API.
 */

/** The topic of a new fact when memory has no topic yet and the user typed no heading. */
export const defaultMemoryTopic = 'General';

/** A list marker at the start of a line: "- ", "* ", "+ ", "• " or "1. ". */
const bulletMarker = /^\s{0,3}(?:[-*+•]|\d+[.)])(?:\s+|$)/;

/**
 * The heading that the user types at the start of a bullet: "# ", "## " and so on, then the
 * topic name. Returns the topic name (empty while the user types it), or null for a fact.
 */
export function bulletHeading(text: string) {
  if (text.includes('\n')) return null;
  const match = /^\s{0,3}#{1,6}\s(.*)$/.exec(text);
  return match ? match[1].trim() : null;
}

/**
 * The facts of the text of one bullet. A paste of a list gives one fact for each list item.
 * Other text is one fact. An empty bullet gives no fact.
 */
export function bulletFacts(text: string) {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  if (lines.length > 1 && lines.every((line) => bulletMarker.test(line)))
    return lines.map((line) => line.replace(bulletMarker, '').trim()).filter(Boolean);
  const single = text.trimEnd().replace(bulletMarker, '').trim();
  return single ? [single] : [];
}

/** What a change to the text of a saved fact does: nothing, a save, or a removal. */
export function factEdit(
  original: string,
  text: string,
): { kind: 'none' } | { kind: 'remove' } | { kind: 'save'; content: string } {
  const content = text.trimEnd().replace(bulletMarker, '').trim();
  if (!content) return { kind: 'remove' };
  if (content === original.trim()) return { kind: 'none' };
  return { kind: 'save', content };
}

/**
 * The topic of a new fact: the heading above the bullet, else the last topic, else the default
 * topic.
 */
export function newFactTopic(heading: string | undefined, topics: string[]) {
  return heading?.trim() || topics[topics.length - 1] || defaultMemoryTopic;
}

/** The saves that rename a topic: each fact of the topic gets the new topic name. */
export function topicRenameSaves(
  entries: { id: string; revision: string; topic: string; content: string }[],
  from: string,
  to: string,
) {
  const name = to.trim();
  const same = (value: string) => value.trim().toLowerCase() === from.trim().toLowerCase();
  if (!name || name === from.trim()) return [];
  return entries
    .filter((entry) => same(entry.topic))
    .map((entry) => ({
      id: entry.id,
      expectedRevision: entry.revision,
      topic: name,
      content: entry.content,
    }));
}

/**
 * Memory as Markdown, as it shows: a "## " heading for each topic and a "- " bullet for each
 * fact. Lines after the first line of a fact are indented under its bullet.
 */
export function memoryMarkdown(topics: { topic: string; facts: { content: string }[] }[]) {
  return topics
    .map(
      (item) =>
        `## ${item.topic}\n\n` +
        item.facts.map((fact) => '- ' + fact.content.trim().split('\n').join('\n  ')).join('\n'),
    )
    .join('\n\n');
}

/**
 * The topics and facts of Markdown that has "## " headings and "- " bullets. A bullet before the
 * first heading goes to the default topic. The inverse of memoryMarkdown.
 */
export function memoryOutline(markdown: string) {
  const topics: { topic: string; facts: string[] }[] = [];
  let current: { topic: string; facts: string[] } | undefined;
  let fact = -1;
  for (const line of markdown.split('\n')) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      current = topics.find((item) => item.topic === heading[1]);
      if (!current) topics.push((current = { topic: heading[1], facts: [] }));
      fact = -1;
    } else if (bulletMarker.test(line)) {
      if (!current) topics.push((current = { topic: defaultMemoryTopic, facts: [] }));
      current.facts.push(line.replace(bulletMarker, '').trim());
      fact = current.facts.length - 1;
    } else if (current && fact >= 0 && /^\s+\S/.test(line))
      current.facts[fact] += '\n' + line.trim();
    else if (!line.trim()) continue;
    else fact = -1;
  }
  return topics.map((item) => ({ ...item, facts: item.facts.filter(Boolean) }));
}
