import { CreateProject } from './create-project';
import { useState } from 'react';
import { ArrowUpRight, Folder, Plus, GitBranch, MessageSquare } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import type { API, ProjectGroup, Project, Session } from '../types';
import { sessionRepo } from './project-tree';

export function ProjectOverview({ api, groups, repos, sessions, query, onSelect, onRefresh }: { api: API; groups: ProjectGroup[]; repos: Project[]; sessions: Session[]; query: string; onSelect: (group: ProjectGroup) => void; onRefresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const visible = groups.filter(g => `${g.name} ${g.github?.title || ''} ${repos.filter(r => g.repoIds.includes(r.id)).map(r => r.name).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="project-home" aria-label="Project overview">
    <div className="project-home-heading"><div><h2>Your projects</h2><p>GitHub projects, repositories, and the work in progress.</p></div><Button size="sm" onClick={() => setOpen(true)}><Plus size={14}/>New project</Button></div>
    <div className="project-directory"><Table><TableHeader><TableRow><TableHead>Project</TableHead><TableHead>GitHub Project</TableHead><TableHead>Repositories</TableHead><TableHead className="text-right">Sessions</TableHead></TableRow></TableHeader><TableBody>{visible.map(group => {
      const repositories = repos.filter(r => group.repoIds.includes(r.id));
      const count = sessions.filter(s => !s.organization?.archived && repositories.some(r => r.id === sessionRepo(s, repos)?.id)).length;
      return <TableRow key={group.id}><TableCell><Button variant="ghost" className="h-auto max-w-full justify-start gap-3 px-0 py-2 text-left whitespace-normal" onClick={() => onSelect(group)}><span className="project-symbol"><Folder size={16}/></span><span className="min-w-0 break-words font-medium">{group.name}{group.hostId && <span className="ml-2 text-[10px] text-muted-foreground">SSH</span>}</span><ArrowUpRight size={12} className="shrink-0 text-muted-foreground"/></Button></TableCell><TableCell>{group.github ? <span className="text-xs text-muted-foreground">{group.github.title}</span> : <Badge variant="outline">Connect GitHub</Badge>}</TableCell><TableCell><span className="inline-flex items-center gap-2 text-xs text-muted-foreground" title={repositories.map(r => r.name).join(', ')}><GitBranch size={13}/>{repositories.length} repositories</span></TableCell><TableCell className="text-right"><span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><MessageSquare size={13}/>{count} sessions</span></TableCell></TableRow>;
    })}</TableBody></Table></div>
    {!visible.length && <div className="project-empty"><Folder size={24}/><h3>{groups.length ? 'No matching projects' : 'Your work starts with a project'}</h3><p>{groups.length ? 'Try another project or repository name.' : 'Connect a GitHub Project, then add the repositories where its work happens.'}</p></div>}
    <CreateProject api={api} open={open} onOpenChange={setOpen} onCreated={async group => { await onRefresh(); onSelect(group); }}/>
  </section>;
}
