export const projectColors = {
  red: '#f87171',
  yellow: '#facc15',
  blue: '#60a5fa',
  green: '#4ade80',
  indigo: '#818cf8',
  violet: '#c084fc',
} as const;
export type ProjectColor = keyof typeof projectColors;
export function isProjectColor(value: unknown): value is ProjectColor {
  return typeof value === 'string' && Object.hasOwn(projectColors, value);
}
