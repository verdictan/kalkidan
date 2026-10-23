// The short title of a chat for the tree, the crumb and the pull request title.

/** Words that start a part of the sentence that the title does not need. */
const prepositions = new Set(
  [
    'about above across after against along at before behind below between by during for',
    'from in inside into near of on onto over per since through to toward towards under',
    'until upon via with within without',
  ]
    .join(' ')
    .split(' '),
);
/** The most words in a short title. */
export const shortTitleWords = 6;
/** The fewest words before a cut. A cut that leaves fewer words goes to the next cut. */
const minimumWords = 2;

/**
 * A short title from the first message of a chat: the imperative phrase before the first
 * preposition, comma, colon or semicolon, at most 6 words. For example "Add rate limits to the
 * public API endpoints" gives "Add rate limits". A text without a cut gives its first 6 words,
 * and a long phrase stops before its last "and" or "or" in those words. An empty text gives an
 * empty title.
 */
export function shortChatTitle(text: string) {
  const line =
    text
      .split('\n')
      .map((part) => part.trim())
      .find(Boolean) || '';
  // The first sentence only. A dot inside a word ("sign-in.spec.ts") does not end it.
  const sentence = (line.match(/^(.+?)[.!?](\s|$)/)?.[1] || line)
    .replace(/^(please|can you|could you|would you)\s+/i, '')
    .trim();
  const words = sentence.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    const bare = word.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, '');
    if (kept.length >= minimumWords && prepositions.has(bare)) break;
    kept.push(word);
    if (kept.length >= minimumWords && /[,;:(—–]$/.test(word)) break;
    if (kept.length > shortTitleWords) break;
  }
  if (kept.length > shortTitleWords) {
    kept.length = shortTitleWords;
    // "Review the authentication flow and add" stops before "and".
    for (let index = kept.length - 1; index >= minimumWords; index--)
      if (/^(and|or)$/i.test(kept[index])) {
        kept.length = index;
        break;
      }
  }
  const title = kept
    .join(' ')
    .replace(/[\s,;:(—–.!?]+$/, '')
    .trim();
  return title ? title[0].toUpperCase() + title.slice(1) : '';
}

/**
 * The title of a chat from its history: the summary that the agent wrote when it has one, else
 * the short title of the first message. Agent summaries keep their words, up to 80 characters.
 */
export function chatTitleFrom({ summary, text }: { summary?: string; text?: string }) {
  const named = summary?.replace(/\s+/g, ' ').trim();
  if (named) return named.length <= 80 ? named : named.slice(0, 80).replace(/\s+\S*$/, '');
  return shortChatTitle(text || '');
}
