# Kalkidan UI conventions

Kalkidan is a dense desktop tool for developers (a project, repository and session manager).
The kit is shadcn (new-york) on Tailwind v4 with a small token set. The UI text size is 13px.
Controls are 32px high by default.

## Setup

- Link `styles.css`. It holds the tokens, the light and dark themes, and all component styles.
- Wrap the app in `TooltipProvider`. A `Tooltip` outside it throws
  "`Tooltip` must be used within `TooltipProvider`".
- Light theme is the default. For the dark theme, add the class `dark` to the `<html>` element.

```jsx
const { TooltipProvider } = window.KalkidanUI;
document.documentElement.classList.add('dark'); // optional
<TooltipProvider delayDuration={350}>
  <App />
</TooltipProvider>;
```

## Styling

The CSS is a compiled Tailwind build. Only classes that the source uses are in it. Use the
classes below, or inline styles with the `var(--*)` tokens. Other Tailwind classes have no effect.

| Purpose    | Classes                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces   | `bg-background`, `bg-card`, `bg-secondary`, `bg-primary`, `hover:bg-[var(--surface-hover)]`                                                             |
| Text color | `text-foreground`, `text-muted-foreground`, `text-primary-foreground`, `text-destructive`, `text-success`, `text-warning`, `text-link`                  |
| Text size  | `text-2xs` (11), `text-xs` (12), `text-sm` (13, default), `text-base` (15), `text-lg` (16), `text-xl` (20); `font-medium`, `font-semibold`, `font-mono` |
| Borders    | `border`, `border-b`, `border-t`, `border-border`, `rounded-md` (6), `rounded-lg` (8), `rounded-xl` (12), `rounded-full`                                |
| Layout     | `flex`, `grid`, `flex-col`, `items-center`, `justify-between`, `gap-1` to `gap-4`, `gap-6`, `min-w-0`, `truncate`, `w-full`, `max-w-sm`, `max-w-md`     |
| Spacing    | `p-2`, `p-3`, `p-6`, `px-2`, `px-3`, `px-4`, `px-6`, `py-1`, `py-2`, `py-3`, `space-y-4`                                                                |
| Elevation  | `shadow-xs`, `shadow-md`, `shadow-lg`                                                                                                                   |

Tokens for inline styles: colors `--background`, `--foreground`, `--card`, `--primary`,
`--secondary`, `--muted-foreground`, `--border`, `--destructive`, `--success`, `--warning`,
`--link`, `--surface-hover`, `--surface-selected`; spacing `--space-1` (4px) to `--space-12`
(48px) on a 4px grid; sizes `--control-xs|sm|md|lg` (24/28/32/36), `--row-height` (32),
`--dialog-sm|md|lg` (440/560/720), `--page-max-width` (1120), `--reading-width` (752).

## Components

- Read `components/<group>/<Name>/<Name>.prompt.md` and `<Name>.d.ts` before you use a component.
  Read `styles.css` and `_ds_bundle.css` for the full class and token list.
- Use the kit, not raw elements: `Button` (variants `default`, `secondary`, `outline`, `ghost`,
  `destructive`, `link`, `bare`; sizes `xs`, `sm`, `default`, `lg`, `icon*`), `Input`,
  `SearchInput`, `Textarea`, `Select`, `Switch`, `SegmentedControl`, `Badge`, `Alert`, `Card`,
  `Table`, `Dialog`, `DropdownMenu`, `Tooltip`, `Collapsible`.
- Page structure: `PageHeader` (icon, eyebrow, title, subtitle, actions) at the top of a page,
  `SectionHeader` (title, count, actions) above each section, `EmptyState` when a list is empty.
- Icons are `lucide-react` style, 16px in controls. `EntityIcon` gives a project or repository a
  tile; `MoreButton` is the only "more actions" trigger.

```jsx
const { PageHeader, SectionHeader, EntityIcon, Button, MoreButton, Badge } = window.KalkidanUI;
<div className="flex flex-col gap-6 p-6">
  <PageHeader
    icon={<EntityIcon size="lg">K</EntityIcon>}
    eyebrow="Repository"
    title="kalkidan"
    subtitle="~/Work/kalkidan"
    actions={
      <>
        <Button>New session</Button>
        <MoreButton size="md" label="Repository actions" />
      </>
    }
  />
  <SectionHeader title="Worktrees" count={2} />
  <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
    feature/onboarding{' '}
    <Badge size="sm" variant="secondary">
      Changed
    </Badge>
  </div>
</div>;
```
