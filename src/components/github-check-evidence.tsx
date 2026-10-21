import { CircleCheck, CircleDashed, CircleMinus, CircleX, ExternalLink } from 'lucide-react';
import type { GitHubContentSnapshot, GitHubCheckEvidence } from '../domain/github-content';
import { Badge } from './ui/badge';
import { SectionHeader } from './ui/page-header';
import {
  checkKindLabel,
  checkStateLabel,
  checkStateTone,
  itemStateTone,
  pullRequestStateLabel,
  reviewDecisionLabel,
  shortSha,
} from '../lib/github-labels';

/** A 16px icon for a check state. The state also shows as text for screen readers. */
export function CheckStateIcon({ state }: { state?: string | null }) {
  const tone = checkStateTone(state);
  const Icon =
    tone === 'success'
      ? CircleCheck
      : tone === 'destructive'
        ? CircleX
        : tone === 'warning'
          ? CircleDashed
          : CircleMinus;
  return (
    <Icon
      aria-hidden="true"
      className={
        tone === 'success'
          ? 'size-4 shrink-0 text-success'
          : tone === 'destructive'
            ? 'size-4 shrink-0 text-destructive'
            : tone === 'warning'
              ? 'size-4 shrink-0 text-warning'
              : 'size-4 shrink-0 text-muted-foreground'
      }
    />
  );
}

/** A commit SHA as 7 mono characters, with the full SHA in the tooltip. */
export function Sha({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted-foreground">Unknown</span>;
  return (
    <code className="font-mono text-xs" title={value}>
      {shortSha(value)}
    </code>
  );
}

function CheckRows({ rows }: { rows: GitHubCheckEvidence[] | undefined }) {
  if (!rows?.length)
    return <p className="form-help m-0">GitHub has no check results for this commit.</p>;
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {rows.map((row, index) => (
        <li
          key={`${row.name}:${index}`}
          className="flex min-h-7 items-center gap-2 text-sm"
          aria-label={`${row.name}: ${checkStateLabel(row.state)}`}
        >
          <CheckStateIcon state={row.state} />
          <span className="min-w-0 flex-1 truncate">
            {row.url ? (
              <a className="text-link" href={row.url} target="_blank" rel="noreferrer">
                {row.name}
              </a>
            ) : (
              row.name
            )}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {checkStateLabel(row.state)} · {checkKindLabel(row.kind)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function GitHubCheckEvidenceView({ value }: { value: GitHubContentSnapshot }) {
  return (
    <section className="grid gap-2" aria-label="Change and build evidence">
      {value.kind === 'PullRequest' && (
        <>
          <SectionHeader
            size="sm"
            as="h4"
            className="mb-0"
            title="Checks"
            count={value.checkEvidence?.length}
            actions={
              <span className="text-xs text-muted-foreground">
                Commit <Sha value={value.headOid} />
              </span>
            }
          />
          <CheckRows rows={value.checkEvidence} />
        </>
      )}
      {value.kind === 'Issue' && (
        <SectionHeader
          size="sm"
          as="h4"
          className="mb-0"
          title="Linked pull requests"
          count={value.linkedPullRequests?.length || 0}
        />
      )}
      {value.linkedPullRequests?.map((pr) => (
        <article key={pr.id} className="grid gap-2 rounded-lg border p-3">
          <div className="flex min-w-0 items-center gap-2">
            <a
              className="text-link inline-flex min-w-0 flex-1 items-center gap-1 text-sm font-medium"
              href={pr.url}
              target="_blank"
              rel="noreferrer"
            >
              <span className="truncate">{pr.title}</span>
              <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
            </a>
            <Badge size="sm" variant={pr.merged ? 'default' : itemStateTone(pr.state)}>
              {pullRequestStateLabel(pr.state, pr.merged)}
            </Badge>
          </div>
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs leading-4 text-muted-foreground">
            <span>{reviewDecisionLabel(pr.reviewDecision)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <CheckStateIcon state={pr.checks} />
              {checkStateLabel(pr.checks)}
            </span>
            <span aria-hidden="true">·</span>
            <Sha value={pr.headRefOid} />
          </p>
          <CheckRows rows={pr.checkEvidence} />
        </article>
      ))}
      {value.kind === 'Issue' && !value.linkedPullRequests?.length && (
        <p className="form-help m-0">No pull request closes this issue yet.</p>
      )}
    </section>
  );
}
