export interface ProjectDoc {
  id: string;
  title: string;
  parentId: string | null;
  markdown: string;
  revision: string;
  /** The position among sibling pages. Pages without an order come last, sorted by title. */
  order?: number;
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
}
