import { useState } from 'react';
import type { TrackerBoard, TrackerItem } from '../types';
import { Button } from './ui/button';
/** Dates come only from saved project fields. Undated work stays visible below the timeline. */
export function TrackerRoadmap({
  board,
  items,
  onOpen,
}: {
  board: TrackerBoard;
  items: TrackerItem[];
  onOpen: (item: TrackerItem) => void;
}) {
  const dates = (board.fields || []).filter((field) => field.dataType === 'DATE');
  const [start, setStart] = useState(dates[0]?.id || '');
  const [end, setEnd] = useState(dates[1]?.id || dates[0]?.id || '');
  const day = 86400000;
  const read = (item: TrackerItem, id: string) => {
    const value = item.fieldValues?.find(
      (value) => (value.field as { id: string })?.id === id,
    )?.date;
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value) : NaN;
  };
  const rows = items.map((item) => ({ item, start: read(item, start), end: read(item, end) }));
  const dated = rows.filter(
    (row) => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end >= row.start,
  );
  const min = dated.length ? Math.min(...dated.map((row) => row.start)) : 0;
  const max = dated.length ? Math.max(...dated.map((row) => row.end)) + day : day;
  return (
    <section aria-label="Project roadmap" className="grid gap-4">
      <div className="flex flex-wrap gap-4">
        {[
          { label: 'Start date field', value: start, change: setStart },
          { label: 'End date field', value: end, change: setEnd },
        ].map((control) => (
          <label key={control.label} className="form-label">
            {control.label}
            <select value={control.value} onChange={(event) => control.change(event.target.value)}>
              <option value="">Choose date field</option>
              {dates.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {!dates.length && <p>Add date fields in Board actions → Fields, views, and reports.</p>}
      {dated.length > 0 && (
        <div className="flex justify-between text-xs">
          <span>{new Date(min).toISOString().slice(0, 10)}</span>
          <span>{new Date(max - day).toISOString().slice(0, 10)}</span>
        </div>
      )}
      {dated.map((row) => (
        <div
          key={row.item.id}
          className="grid grid-cols-[minmax(140px,1fr)_3fr] items-center gap-3"
        >
          <Button
            variant="ghost"
            className="justify-start truncate"
            onClick={() => onOpen(row.item)}
          >
            {row.item.title}
          </Button>
          <div className="relative h-7 rounded bg-muted">
            <button
              aria-label={`${row.item.title}: ${new Date(row.start).toISOString().slice(0, 10)} to ${new Date(row.end).toISOString().slice(0, 10)}`}
              onClick={() => onOpen(row.item)}
              className="absolute inset-y-1 rounded bg-primary"
              style={{
                left: `${(100 * (row.start - min)) / (max - min)}%`,
                width: `${(100 * (row.end - row.start + day)) / (max - min)}%`,
              }}
            />
          </div>
        </div>
      ))}
      {rows.filter((row) => !dated.includes(row)).length > 0 && (
        <div className="grid gap-1">
          <h4>Missing or invalid dates</h4>
          {rows
            .filter((row) => !dated.includes(row))
            .map((row) => (
              <Button
                key={row.item.id}
                variant="ghost"
                className="justify-start"
                onClick={() => onOpen(row.item)}
              >
                {row.item.title}
              </Button>
            ))}
        </div>
      )}
    </section>
  );
}
