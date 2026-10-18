import { StatusIcon, trackerColumns } from './tracker-list';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import type { GitHubBoard, GitHubItem, Session } from '../types';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Choice } from './choice';

export function TrackerBoard({ board, items, busy, sessions, onOpen, onStatus }: { board: GitHubBoard; items: GitHubItem[]; busy: boolean; sessions: Session[]; onOpen: (item: GitHubItem) => void; onStatus: (item: GitHubItem, status: string) => void }) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const options = board.statusField?.options || [];
  const columns = trackerColumns(board);
  return <div className="tracker-board" role="region" aria-label="Tracker board" aria-busy={busy} tabIndex={0}>
    <span className="sr-only" role="status">{announcement}</span>
    {columns.map(column => {
      const tasks = items.filter(item => (options.some(option => option.id === item.statusId) ? item.statusId : '') === column.id);
      return <section key={column.id} onDragOver={event => { if (!busy && dragged && column.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(column.id); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null); }} onDrop={event => { event.preventDefault(); const item = items.find(i => i.id === dragged); setDragged(null); setOver(null); if (!busy && item && column.id && item.statusId !== column.id) { setAnnouncement(`Moving ${item.title} to ${column.name}`); onStatus(item, column.id); } }} data-drop-target={over === column.id || undefined} role="region" aria-label={`${column.name} column`} className="tracker-column">
        <div className="tracker-column-heading"><StatusIcon name={column.name}/><h4>{column.name}</h4><span aria-label={`${tasks.length} tasks`}>{tasks.length}</span></div>
        <div className="tracker-column-items">
          {tasks.map(item => {
            const count = sessions.filter(session => !session.organization?.archived && session.organization?.taskId === item.id).length;
            return <Card key={item.id} aria-label={`Task: ${item.title}`} draggable={!busy && !!board.statusField} onDragStart={event => { if ((event.target as HTMLElement).closest('button, [role="combobox"]')) { event.preventDefault(); return; } setDragged(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); }} onDragEnd={() => { setDragged(null); setOver(null); }} data-dragging={dragged === item.id || undefined} className="tracker-task gap-2 rounded-lg py-3 shadow-none">
              <CardContent className="space-y-2 px-3">
                <Button variant="ghost" className="h-auto max-w-full justify-start p-0 text-left text-[13px] font-medium whitespace-normal break-words leading-snug" onClick={() => onOpen(item)}>{item.title}</Button>
                <p className="break-words text-xs text-muted-foreground">{item.repository || 'Draft item'}{item.number ? ` #${item.number}` : ''}</p>
                {count > 0 && <Badge variant="outline"><MessageSquare size={11}/>{count} linked {count === 1 ? 'session' : 'sessions'}</Badge>}
                {board.statusField && <Choice className="h-7 w-full border-transparent bg-transparent px-1 text-xs shadow-none" label={`Status for ${item.title}`} value={item.statusId || ''} disabled={busy} options={item.statusId ? options.map(o => ({ value: o.id, label: o.name })) : [{ value: '', label: 'No status' }, ...options.map(o => ({ value: o.id, label: o.name }))]} onChange={value => { if (value && value !== item.statusId) onStatus(item, value); }}/>}
                <Button variant="ghost" size="sm" className="h-7 w-full justify-start px-1 text-xs text-muted-foreground" onClick={() => onOpen(item)}>Work on this</Button>
              </CardContent>
            </Card>;
          })}
          {!tasks.length && <p className="py-6 text-center text-xs text-muted-foreground">No matching tasks</p>}
        </div>
      </section>;
    })}
  </div>;
}
