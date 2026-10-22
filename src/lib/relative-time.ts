/**
 * The one relative time of the app: "now" below 60 seconds, then "2m", "3h", the weekday ("Mon")
 * within a week, then a date ("Mar 4", with the year when it is not this year). A time in the
 * future shows as "now".
 */
export function relativeTime(value?: string | number | Date | null, now = Date.now()) {
  if (value === undefined || value === null || value === '') return '';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const date = new Date(time);
  if (hours < 24 * 6) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  });
}

/** The full local date and time, for a tooltip next to a relative time. */
export function fullTime(value?: string | number | Date | null) {
  if (value === undefined || value === null || value === '') return '';
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? '' : new Date(time).toLocaleString();
}
