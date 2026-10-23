import type { Extension } from '@codemirror/state';

// Each language loads only when a file of that type opens, so the editor chunk stays small.
const loaders: Record<string, () => Promise<Extension>> = {
  ts: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  tsx: () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ typescript: true, jsx: true }),
    ),
  js: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  md: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  py: () => import('@codemirror/lang-python').then((m) => m.python()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  go: () => import('@codemirror/lang-go').then((m) => m.go()),
  rs: () => import('@codemirror/lang-rust').then((m) => m.rust()),
};

const aliases: Record<string, string> = {
  mts: 'ts',
  cts: 'ts',
  mjs: 'js',
  cjs: 'js',
  jsonc: 'json',
  json5: 'json',
  scss: 'css',
  htm: 'html',
  markdown: 'md',
  mdx: 'md',
  yml: 'yaml',
  pyi: 'py',
};

/** The language extension of a file, or null for plain text. */
export async function languageFor(path: string): Promise<Extension | null> {
  const extension = path.split('/').pop()?.split('.').pop()?.toLowerCase() || '';
  const loader = loaders[aliases[extension] || extension];
  if (!loader) return null;
  try {
    return await loader();
  } catch {
    return null;
  }
}
