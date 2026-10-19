export interface ProjectDoc {
  id: string;
  title: string;
  parentId: string | null;
  markdown: string;
  revision: string;
}
export type ProjectDocMetadata = Pick<ProjectDoc, 'id' | 'title' | 'parentId'>;
export interface DocsAPI {
  docsMetadata(groupId: string): Promise<ProjectDocMetadata[]>;
  docsRead(groupId: string, id: string): Promise<ProjectDoc>;
  docsList(groupId: string): Promise<ProjectDoc[]>;
  docsCreate(groupId: string, title: string, parentId: string | null): Promise<ProjectDoc>;
  docsSave(groupId: string, doc: ProjectDoc): Promise<ProjectDoc>;
  docsDelete(groupId: string, id: string, revision: string): Promise<void>;
}
