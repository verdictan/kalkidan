import { projectColors } from '../domain/project-colors';
import { trackerConnection } from '../domain/tracker';
import { CreateProject } from './create-project';
import { useState } from 'react';
import { ArrowUpRight, Folder, Plus, GitBranch, MessageSquare } from 'lucide-react';
import { Button } from './ui/button';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import type { API, ProjectGroup, Project, Session } from '../types';
import { sessionRepo } from '../lib/session-repository';

export function ProjectOverview({
  api,
  groups,
  repos,
  sessions,
  query,
  onSelect,
  onRefresh,
}: {
  api: API;
  groups: ProjectGroup[];
  repos: Project[];
  sessions: Session[];
  query: string;
  onSelect: (group: ProjectGroup) => void;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const visible = groups.filter((g) =>
    `${g.name} ${trackerConnection(g)?.project.title || ''} ${repos
      .filter((r) => g.repoIds.includes(r.id))
      .map((r) => r.name)
      .join(' ')}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="project-home" aria-label="Project overview">
      <div className="project-home-heading">
        <div>
          <h2>Your projects</h2>
          <p>Projects, repositories, and the work in progress.</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus size={14} />
          New project
        </Button>
      </div>
      <div className="project-directory">
        <Table>
          <colgroup>
            <col className="project-name-column" />
            <col className="project-repositories-column" />
            <col className="project-sessions-column" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Repositories</TableHead>
              <TableHead>Sessions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((group) => {
              const repositories = repos.filter((r) => group.repoIds.includes(r.id));
              const count = sessions.filter(
                (s) =>
                  !s.organization?.archived &&
                  repositories.some((r) => r.id === sessionRepo(s, repos)?.id),
              ).length;
              return (
                <TableRow key={group.id}>
                  <TableCell>
                    <Button
                      variant="ghost"
                      className="project-open h-auto max-w-full justify-start gap-3 px-0 py-2 text-left whitespace-normal"
                      onClick={() => onSelect(group)}
                    >
                      <span
                        className="project-symbol"
                        style={{ color: group.color ? projectColors[group.color] : undefined }}
                      >
                        <Folder size={16} />
                      </span>
                      <span className="min-w-0 break-words font-medium">
                        {group.name}
                        {group.hostId && (
                          <span className="ml-2 text-[10px] text-muted-foreground">SSH</span>
                        )}
                      </span>
                      <ArrowUpRight size={12} className="shrink-0 text-muted-foreground" />
                    </Button>
                  </TableCell>
                  <TableCell>
                    <span
                      className="inline-flex items-center gap-2 text-xs text-muted-foreground"
                      title={repositories.map((r) => r.name).join(', ')}
                    >
                      <GitBranch size={13} />
                      {repositories.length} repositories
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <MessageSquare size={13} />
                      {count} sessions
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {!visible.length && (
        <div className="project-empty">
          <Folder size={24} />
          <h3>{groups.length ? 'No matching projects' : 'Your work starts with a project'}</h3>
          <p>
            {groups.length
              ? 'Try another project or repository name.'
              : 'Connect a project tracker, then add the repositories where its work happens.'}
          </p>
        </div>
      )}
      <CreateProject
        api={api}
        open={open}
        onOpenChange={setOpen}
        onCreated={async (group) => {
          await onRefresh();
          onSelect(group);
        }}
      />
    </section>
  );
}
