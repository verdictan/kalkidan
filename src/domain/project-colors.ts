// The project colors. Each value has a contrast ratio of at least 3:1 on the white background.
export const projectColors = {
  red: '#dc2626',
  yellow: '#a16207',
  blue: '#2563eb',
  green: '#15803d',
  indigo: '#4f46e5',
  violet: '#9333ea',
} as const satisfies Record<string, string>;
export type ProjectColor = keyof typeof projectColors;

export function isProjectColor(value: unknown): value is ProjectColor {
  return typeof value === 'string' && Object.hasOwn(projectColors, value);
}
