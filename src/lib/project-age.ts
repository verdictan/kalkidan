/**
 * The age of the last chat of a project, for the Projects table (SP-C2): "now", "5 min",
 * "3 h" or "2 d". An unknown time gives an empty text.
 */
export function projectAge(iso: string, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (24 * 60))} d`;
}
