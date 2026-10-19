export type ColorScheme = 'light' | 'dark';

// Each color has one value for each scheme. Each value has a contrast ratio of
// at least 3:1 on the background of its scheme.
export const projectColorPalette = {
  red: { light: '#dc2626', dark: '#f87171' },
  yellow: { light: '#a16207', dark: '#facc15' },
  blue: { light: '#2563eb', dark: '#60a5fa' },
  green: { light: '#15803d', dark: '#4ade80' },
  indigo: { light: '#4f46e5', dark: '#818cf8' },
  violet: { light: '#9333ea', dark: '#c084fc' },
} as const satisfies Record<string, Record<ColorScheme, string>>;
export type ProjectColor = keyof typeof projectColorPalette;

/** Returns the hex value of a project color for one scheme. */
export function projectColorValue(color: ProjectColor, scheme: ColorScheme) {
  return projectColorPalette[color][scheme];
}

/**
 * CSS color values that follow the current scheme. Each value is a CSS
 * `light-dark()` function, so use it only in CSS, not as a hex value.
 */
export const projectColors = Object.fromEntries(
  Object.entries(projectColorPalette).map(([name, { light, dark }]) => [
    name,
    `light-dark(${light}, ${dark})`,
  ]),
) as Record<ProjectColor, string>;

export function isProjectColor(value: unknown): value is ProjectColor {
  return typeof value === 'string' && Object.hasOwn(projectColorPalette, value);
}
