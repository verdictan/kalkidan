export interface ProjectDoc {
  id: string;
  title: string;
  parentId: string | null;
  markdown: string;
  revision: string;
  /** The position among sibling pages. Pages without an order come last, sorted by title. */
  order?: number;
  /** When the page file last changed, in milliseconds since 1970. Missing: not known. */
  updatedAt?: number;
}
export type ProjectDocMetadata = Pick<ProjectDoc, 'id' | 'title' | 'parentId' | 'order'>;
/** A deleted page in the project's .trash folder. */
export interface DeletedProjectDoc {
  trashId: string;
  id: string;
  title: string;
  deletedAt: number;
}
export interface DocsAPI {
  docsMetadata(groupId: string): Promise<ProjectDocMetadata[]>;
  docsRead(groupId: string, id: string): Promise<ProjectDoc>;
  docsList(groupId: string): Promise<ProjectDoc[]>;
  docsCreate(groupId: string, title: string, parentId: string | null): Promise<ProjectDoc>;
  docsSave(groupId: string, doc: ProjectDoc): Promise<ProjectDoc>;
  docsDelete(groupId: string, id: string, revision: string): Promise<void>;
  docsTrash(groupId: string): Promise<DeletedProjectDoc[]>;
  docsRestore(groupId: string, trashId: string): Promise<ProjectDoc>;
  /** Full-text search over the project docs. The same index as @docs. */
  docsSearch(groupId: string, query: string, limit?: number): Promise<DocPassage[]>;
  /** Task-to-doc links, saved in the project folder. Keys are board item IDs. */
  taskDocLinks(groupId: string): Promise<Record<string, string[]>>;
  setTaskDocLinks(groupId: string, itemId: string, docIds: string[]): Promise<void>;
}

/** A bounded search result. Source line numbers refer to the Markdown file on disk. */
export interface DocPassage {
  id: string;
  title: string;
  heading: string;
  revision: string;
  source: string;
  excerpt: string;
}
