import { Hint } from './hint';
import { cn } from '../lib/utils';

/**
 * Splits a path for a middle cut. The end keeps the program name and, when it is short, its
 * folder. The start gets the ellipsis.
 */
export function splitPathForMiddleCut(path: string): [string, string] {
  const parts = path.split('/');
  let tail = parts.pop() || '';
  const folder = parts.at(-1);
  if (folder && folder.length + tail.length < 32) tail = `${folder}/${tail}`;
  const head = path.slice(0, path.length - tail.length);
  return [head, tail];
}

/** A program path, cut in the middle, with the full path in a tooltip. */
export function ProgramPath({ path, className }: { path?: string; className?: string }) {
  if (!path) return null;
  const [head, tail] = splitPathForMiddleCut(path);
  return (
    <Hint label={path}>
      <p
        tabIndex={0}
        aria-label={path}
        className={cn('mt-0.5 flex min-w-0 font-mono text-2xs text-muted-foreground', className)}
      >
        <span className="min-w-0 truncate" aria-hidden="true">
          {head}
        </span>
        <span className="shrink-0 whitespace-pre" aria-hidden="true">
          {tail}
        </span>
      </p>
    </Hint>
  );
}
