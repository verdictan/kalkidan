import type { GitHubContentSnapshot, GitHubCheckEvidence } from '../domain/github-content';
const checks = (rows: GitHubCheckEvidence[] | undefined) =>
  rows?.length ? (
    <ul className="grid gap-1">
      {rows.map((row, index) => (
        <li key={`${row.name}:${index}`} className="text-sm">
          {row.url ? (
            <a href={row.url} target="_blank" rel="noreferrer">
              {row.name}
            </a>
          ) : (
            row.name
          )}
          : {row.state} · {row.kind} reported to GitHub
        </li>
      ))}
    </ul>
  ) : (
    <p className="help-text">No individual check evidence is available.</p>
  );
export function GitHubCheckEvidenceView({ value }: { value: GitHubContentSnapshot }) {
  return (
    <section className="grid gap-2" aria-label="Change and build evidence">
      {value.kind === 'PullRequest' && (
        <>
          <p>Head: {value.headOid || 'Unknown'}</p>
          {checks(value.checkEvidence)}
        </>
      )}
      {value.linkedPullRequests?.map((pr) => (
        <article key={pr.id} className="grid gap-1 border-t pt-2">
          <a href={pr.url} target="_blank" rel="noreferrer">
            {pr.title}
          </a>
          <p className="help-text">
            {pr.merged ? 'Merged' : pr.state} · {pr.reviewDecision || 'No review decision'} ·{' '}
            {pr.checks || 'No check rollup'} · {pr.headRefOid}
          </p>
          {checks(pr.checkEvidence)}
        </article>
      ))}
      {value.kind === 'Issue' && !value.linkedPullRequests?.length && (
        <p className="help-text">No closing pull request is linked to this issue.</p>
      )}
    </section>
  );
}
