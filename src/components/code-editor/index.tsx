import { lazy, Suspense } from 'react';
import type { CodeEditorProps } from './code-editor';

// This entry stays small. CodeMirror loads only when a Code tab first shows.
const LazyEditor = lazy(() => import('./code-editor').then((m) => ({ default: m.CodeEditor })));

/** The code editor of the Code tab. It fills its parent. */
export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<div className="code-editor-loading" role="status" aria-label="Loading" />}>
      <LazyEditor {...props} />
    </Suspense>
  );
}

export type { CodeEditorProps };
export { openFileAt, onOpenFileRequest, unsavedCodeFiles, type OpenFileRequest } from './store';
