import { DatabaseSync } from 'node:sqlite';
import type { ProjectDoc, DocPassage } from '../../src/domain/docs';

export const DOC_CONTEXT_LIMIT = 4800;
const CHUNK_SIZE = 1200;
const stopWords = new Set(
  'a an and are as at be by can could do does for from how i in is it me of on or our please should that the their them there these this to us use was we what when where which who why will with would you your'.split(
    ' ',
  ),
);
export function docSearchTerms(query: string) {
  return [
    ...new Set(
      (
        query
          .slice(0, 2000)
          .toLowerCase()
          .match(/[\p{L}\p{N}_-]{2,}/gu) || []
      ).filter((term) => !stopWords.has(term)),
    ),
  ].slice(0, 24);
}

const SNIPPET_SIZE = 240;
/** Returns a short excerpt that starts near the first matching term. */
function snippet(text: string, terms: string[]) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= SNIPPET_SIZE) return flat;
  const lower = flat.toLowerCase();
  const hit = Math.min(...terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0));
  const start = Number.isFinite(hit)
    ? Math.max(0, Math.min(hit - 60, flat.length - SNIPPET_SIZE))
    : 0;
  return (
    (start ? '…' : '') +
    flat.slice(start, start + SNIPPET_SIZE).trim() +
    (start + SNIPPET_SIZE < flat.length ? '…' : '')
  );
}

/** A disposable, project-local index. Markdown files remain the source of truth. */
export class DocsRetrievalIndex {
  private db = new DatabaseSync(':memory:');
  readonly stamps = new Map<string, string>();
  constructor() {
    this.db.exec(`CREATE VIRTUAL TABLE passages USING fts5(
      title, heading, text, page UNINDEXED, revision UNINDEXED,
      startLine UNINDEXED, endLine UNINDEXED, tokenize='unicode61'
    )`);
  }
  close() {
    this.db.close();
  }
  remove(id: string) {
    this.db.prepare('DELETE FROM passages WHERE page = ?').run(id);
    this.stamps.delete(id);
  }
  update(doc: ProjectDoc, stamp: string) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM passages WHERE page = ?').run(doc.id);
      const insert = this.db.prepare('INSERT INTO passages VALUES (?, ?, ?, ?, ?, ?, ?)');
      let heading = '';
      let text = '';
      let start = 1;
      let end = 1;
      const flush = () => {
        if (text.trim())
          insert.run(doc.title, heading, text.trim(), doc.id, doc.revision, start, end);
        text = '';
      };
      for (const [offset, line] of doc.markdown.split('\n').entries()) {
        const nextHeading = line.match(/^#{1,6}\s+(.+)/)?.[1];
        if (nextHeading) {
          flush();
          heading = nextHeading.slice(0, 160);
        }
        for (let position = 0; position < Math.max(1, line.length); position += CHUNK_SIZE) {
          const part = line.slice(position, position + CHUNK_SIZE);
          if (text.length + part.length + 1 > CHUNK_SIZE) flush();
          // Markdown files have a metadata header before the body.
          if (!text) start = offset + 2;
          end = offset + 2;
          text += part + '\n';
        }
      }
      flush();
      this.db.exec('COMMIT');
      this.stamps.set(doc.id, stamp);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  /**
   * Without `limit`, returns up to 3 passages that fit the agent context budget. With `limit`
   * (1 to 50), returns up to that many passages with short excerpts for a search list.
   */
  search(query: string, limit?: number): DocPassage[] {
    const terms = docSearchTerms(query);
    if (!terms.length) return [];
    const listing = limit !== undefined;
    if (listing && (!Number.isSafeInteger(limit) || limit < 1 || limit > 50))
      throw new Error('Choose a search limit from 1 to 50.');
    // Quote every term; user input must not become an FTS expression.
    const match = terms.map((term) => '"' + term.replaceAll('"', '""') + '"').join(' OR ');
    const rows = this.db
      .prepare(
        `SELECT title, heading, text, page, revision, startLine, endLine
      FROM passages WHERE passages MATCH ? ORDER BY bm25(passages, 4, 2, 1), page, startLine LIMIT ?`,
      )
      .all(match, listing ? limit! : 12);
    const results: DocPassage[] = [];
    for (const row of rows) {
      const result: DocPassage = {
        id: String(row.page),
        title: String(row.title).slice(0, 200),
        heading: String(row.heading),
        revision: String(row.revision),
        source: `docs/${row.page}.md:L${row.startLine}-L${row.endLine}`,
        excerpt: listing ? snippet(String(row.text), terms) : String(row.text),
      };
      if (listing) {
        results.push(result);
        continue;
      }
      if (JSON.stringify([...results, result]).length > DOC_CONTEXT_LIMIT) continue;
      results.push(result);
      if (results.length === 3) break;
    }
    return results;
  }
}
