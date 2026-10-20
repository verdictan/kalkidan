const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** A short relative time, such as "3 hours ago" or "yesterday". */
export function relativeTime(value?: string) {
  const time = value ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) return '';
  const seconds = (time - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
    ['year', Infinity],
  ];
  let amount = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(amount) < size) return relativeFormat.format(Math.round(amount), unit);
    amount /= size;
  }
  return '';
}

/** The full local date and time, for a tooltip next to a relative time. */
export function fullTime(value?: string) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? '' : new Date(time).toLocaleString();
}
