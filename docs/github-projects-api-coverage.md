# GitHub Projects API coverage

Reviewed on 2026-10-21. GitHub owns project and issue data. Kalkidan stores cached
reads, display preferences, workflow mappings, and operation receipts.

## Contract baseline

The supported host is GitHub.com. GitHub Enterprise Server is not accepted by URL
validation. Do not claim support for an untested Enterprise schema.

The checked-in contracts contain:

- `src/config/github-projects-schema.json`: 50 relevant mutations and 77 input or
  enum types. Writes validate their input shape before dispatch.
- `src/config/github-projects-outputs.json`: 79 Projects output, interface, union,
  and enum types, including arguments and deprecation information.
- `src/config/github-projects-rest.json`: 18 Projects REST paths and referenced
  schemas from GitHub's OpenAPI description. Requests use API version `2026-03-10`.

Run `node scripts/sync-github-project-{schema,outputs,rest}.mjs` separately for each
snapshot. Add `--check` to report drift without replacing the checked-in file.
Tests use local snapshots. Refresh commands require network access; GraphQL
introspection also requires GitHub CLI authentication.

Sources: [GraphQL Projects](https://docs.github.com/en/graphql/reference/projects),
[REST Projects](https://docs.github.com/en/rest/projects), and the
[GitHub OpenAPI description](https://github.com/github/rest-api-description).
A schema snapshot inventories the contract; it does not prove every permission
combination or validate every generated query against a live account.

## Implemented operation families

| Family                     | Entry point and behavior                                                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery and creation     | Project picker: viewer/organization discovery, project listing, URL resolution, and creation. Paginated reads verify owner identity.                                                                                                    |
| Project administration     | Board actions → GitHub project settings: title, summary, README, visibility, close/reopen, templates, copy, and confirmed deletion.                                                                                                     |
| Access and links           | Project settings: repository/team links, paginated linked lists, and user/team collaborator role mutations. IDs are resolved within their owner scope.                                                                                  |
| Item lifecycle             | New task, Add existing task, and inspector: add issue/PR, draft edit/conversion, archive/restore, remove from project, and position changes. Underlying content remains separate.                                                       |
| Fields                     | Inspector and resource dialog: six writable value types, clear values, field creation/edit/deletion, select options, iteration configuration, and organization issue-field attachment. Unchanged configuration retains its IDs.         |
| Built-in values            | Read labels, assignees, milestone, repository, requested reviewers, and linked PRs. Nested connections drain all pages. Unknown variants retain their returned metadata.                                                                |
| Saved views                | Saved-view picker and resource dialog: read/create/update/delete, exact server-evaluated filters, visible fields, groups, sort, and table/board/roadmap layout. REST creation accepts grouping and sorting.                             |
| Batch edits                | Batch fields and iteration planning: review up to 50 field changes. Durable per-item receipts distinguish confirmation, conflict, and uncertain outcomes. Resume inspects uncertain writes without repeating them.                      |
| Reports                    | Resource dialog: status-update read/create/edit/delete. Project health prepares a source-linked current snapshot and publishes only after explicit review.                                                                              |
| Workflows                  | Resource dialog: paginated workflow reads and deletion. Unavailable write controls direct the user to GitHub.                                                                                                                           |
| Issue and PR content       | Inspector: title/body, comments, state, assignees, labels, milestone, issue type, requested user reviewers, reviews, mergeability, review decision, and latest check rollup. Content permissions are separate from project permissions. |
| Hierarchy and dependencies | Inspector: parent/sub-issue and blocking relationships, add/remove links, and reorder sub-issues. Scope and revision checks prevent silent reparenting.                                                                                 |
| Task execution             | Starting an agent records the item and workflow IDs. A configured In progress change has a durable outcome. Native completion means Ready for review, never automatic Done.                                                             |

## API limits and explicit boundaries

- GitHub exposes collaborator role mutations but does not expose a complete
  ProjectV2 collaborator listing through the reviewed Projects APIs. Kalkidan
  does not invent a member list or claim to verify existing roles locally.
- The reviewed public API does not expose workflow creation/editing or Insights
  chart editing. Use GitHub for those settings.
- Existing saved-view grouping and sorting cannot be updated through the reviewed
  public view-update APIs. Create a configured view or edit those settings on
  GitHub. Layout switches in Kalkidan are local unless saved through the dialog.
- Roadmap date-field choices are local display preferences. Missing dates remain
  visible. Current workload counts are snapshots, not historical throughput.
- The desktop uses notifications, focus refresh, and bounded polling. It does not
  expose a public webhook receiver. No webhook deployment is required.
- Tasks includes reviewed Docs-to-issues publication, capacity-based iteration
  proposals, bounded independent-work proposals, and portfolio/personal reads.
  Release evidence uses paginated PR checks and statuses, including Jenkins links
  when Jenkins reports them to GitHub. Missing evidence is never treated as success.
  Work proposals require explicit task starts; they do not automatically dispatch agents.

## Ownership, recovery, and permission rules

Reads use a frozen credential for the whole operation. Cache keys include the
credential fingerprint and project identity. Account changes discard pending
results. Requests share three slots, a bounded queue, and rate-limit backoff.
Tokens and private request bodies do not enter command arguments or error text.

Project writes use a renewable cross-process lease. They recheck permission,
membership, and relevant revisions. These checks do not provide an atomic GitHub
compare-and-swap against edits from other applications. Every paginated read has
cursor-cycle and size guards; oversized or incomplete results fail explicitly.

Mutations are never automatically retried. Batch field edits, task synchronization,
and commit/push/PR operations have durable recovery records. Other interactive
project writes also have private durable receipts. GitHub write history exposes
unresolved outcomes and blocks an identical write until explicit user review.
Review records observation, not success; no request body or token is retained.

## Verification

Backend fixtures cover resources, fields, settings, content, relations, saved views,
batch recovery, account scope, cache ownership, and request limits. Browser tests
cover settings, inspectors, saved layouts, report review, and batch previews.
These tests use offline fixtures. No production GitHub project was changed for
verification. Live tenant and Enterprise acceptance are not claimed.
