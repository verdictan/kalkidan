import { useState } from 'react';
import { CalendarRange, CalendarX } from 'lucide-react';
import type { TrackerBoard, TrackerItem } from '../types';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { SectionHeader } from './ui/page-header';
import { Choice } from './choice';
import { StatusIcon } from './tracker-list';
import { plural } from '../lib/platform';

const day = 86400000;
const week = 7 * day;
// Dates come as UTC days, so they show without a time zone shift.
const shortDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const longDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** The color of a status: green when done, amber in progress, gray for the others. */
export function statusColor(name: string) {
  if (/done|complete|closed/i.test(name)) return 'var(--success)';
  if (/progress|doing|review/i.test(name)) return 'var(--warning)';
  return 'var(--muted-foreground)';
}

/** The Mondays from the week of `min` to `max`. These are the ticks of the axis. */
function weekStarts(min: number, max: number) {
  const first = new Date(min);
  const monday = min - ((first.getUTCDay() + 6) % 7) * day;
  const ticks: number[] = [];
  for (let at = monday; at < max; at += week) if (at >= min) ticks.push(at);
  return ticks;
}

/** Dates come only from saved project fields. Undated work stays visible below the timeline. */
export function TrackerRoadmap({
  board,
  items,
  onOpen,
  onAddDateFields,
}: {
  board: TrackerBoard;
  items: TrackerItem[];
  onOpen: (item: TrackerItem) => void;
  /** Opens Board settings › Fields with a "Start date" and an "End date" field ready to add. */
  onAddDateFields?: () => void;
}) {
  const dates = (board.fields || []).filter((field) => field.dataType === 'DATE');
  const [start, setStart] = useState(dates[0]?.id || '');
  const [end, setEnd] = useState(dates[1]?.id || dates[0]?.id || '');
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
  const undated = rows.filter((row) => !dated.includes(row));
  const min = dated.length ? Math.min(...dated.map((row) => row.start)) : 0;
  const max = dated.length ? Math.max(...dated.map((row) => row.end)) + day : day;
  const span = max - min;
  const ticks = weekStarts(min, max);
  // Long ranges label every second or fourth week, so labels do not overlap.
  const labelEvery = ticks.length > 24 ? 4 : ticks.length > 12 ? 2 : 1;
  const at = (time: number) => `${(100 * (time - min)) / span}%`;
  const statusName = (item: TrackerItem) =>
    board.statusField?.options.find((option) => option.id === item.statusId)?.name || 'No status';
  const fieldOptions = dates.map((field) => ({ value: field.id, label: field.name }));
  if (!dates.length)
    return (
      <EmptyState
        icon={<CalendarRange />}
        title="Add dates to see a roadmap"
        action={onAddDateFields && <Button onClick={onAddDateFields}>Add date fields</Button>}
      />
    );
  return (
    <section aria-label="Project roadmap" className="tracker-roadmap">
      {/* With exactly two date fields there is nothing to choose. */}
      {dates.length > 2 && (
        <div className="tracker-roadmap-fields" role="group" aria-label="Roadmap dates">
          <span aria-hidden="true">Dates</span>
          <Choice
            size="sm"
            variant="filled"
            label="Start date field"
            value={start}
            onChange={setStart}
            options={fieldOptions}
          />
          <span aria-hidden="true">→</span>
          <Choice
            size="sm"
            variant="filled"
            label="End date field"
            value={end}
            onChange={setEnd}
            options={fieldOptions}
          />
        </div>
      )}
      {dated.length > 0 ? (
        <div className="tracker-roadmap-chart">
          <div className="tracker-roadmap-row tracker-roadmap-axis" aria-hidden="true">
            <span className="tracker-roadmap-label">{plural(dated.length, 'task')}</span>
            <div className="tracker-roadmap-track">
              {ticks.map((tick, index) => (
                <span key={tick} className="tracker-roadmap-tick" style={{ left: at(tick) }}>
                  {index % labelEvery === 0 ? shortDate.format(tick) : ''}
                </span>
              ))}
            </div>
          </div>
          <ul className="tracker-roadmap-rows">
            {dated.map((row) => {
              const status = statusName(row.item);
              const range = `${longDate.format(row.start)} to ${longDate.format(row.end)}`;
              return (
                <li key={row.item.id} className="tracker-roadmap-row">
                  <button
                    type="button"
                    className="tracker-roadmap-label tracker-roadmap-title"
                    data-task-focus={row.item.id}
                    title={row.item.title}
                    onClick={() => onOpen(row.item)}
                  >
                    <StatusIcon name={status} />
                    <span className="truncate">{row.item.title}</span>
                  </button>
                  <div className="tracker-roadmap-track">
                    {ticks.map((tick) => (
                      <span
                        key={tick}
                        className="tracker-roadmap-gridline"
                        style={{ left: at(tick) }}
                        aria-hidden="true"
                      />
                    ))}
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`${row.item.title}: ${range}. ${status}`}
                      title={`${shortDate.format(row.start)} – ${shortDate.format(row.end)} · ${status}`}
                      onClick={() => onOpen(row.item)}
                      className="tracker-roadmap-bar"
                      style={{
                        left: at(row.start),
                        width: `${(100 * (row.end - row.start + day)) / span}%`,
                        ['--bar-color' as string]: statusColor(status),
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <EmptyState icon={<CalendarX />} title="No dated tasks" />
      )}
      {undated.length > 0 && (
        <section className="tracker-roadmap-undated" aria-label="Tasks without dates">
          <SectionHeader size="sm" title="No dates" count={undated.length} />
          {/* The same unboxed 32px rows as the dated tasks. */}
          <ul className="tracker-roadmap-rows">
            {undated.map((row) => (
              <li key={row.item.id} className="tracker-roadmap-row">
                <button
                  type="button"
                  className="tracker-roadmap-label tracker-roadmap-title"
                  data-task-focus={row.item.id}
                  onClick={() => onOpen(row.item)}
                >
                  <StatusIcon name={statusName(row.item)} />
                  <span className="truncate">{row.item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
