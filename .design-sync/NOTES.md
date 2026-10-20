# Design sync notes

The synced design system is the UI kit in `src/components/ui/` (shadcn, new-york style, Tailwind v4).
The app components in `src/components/` are not synced. They need Electron IPC.

## Build

- [GENERAL] The kit has no package build of its own. `node scripts/build-ui-kit.mjs` writes `dist-ui/`
  (ESM `index.js`, `.d.ts` files from `tsconfig.ui.json`, and a `package.json` named `@kalkidan/ui`).
  The converter needs that package: the export scan reads the `types` entry of a named package.
  Run it before the converter (`cfg.buildCmd`).
- [GENERAL] npm imports stay external in `dist-ui/index.js` (`packages: 'external'`), so the
  converter bundles one copy of React and Radix.
- [GENERAL] `src/styles.css` is Tailwind source (`@import 'tailwindcss'`), not compiled CSS. Do not
  set `cfg.cssEntry` to it. The converter takes the compiled CSS from the reference Storybook
  (`[CSS_FROM_STORYBOOK]`). Only utilities used somewhere in `src/` are in that CSS.
- [GENERAL] `.storybook/preview.tsx` imports the Tailwind source, so the decorator bundle fails
  (`Could not resolve "tailwindcss"`). `cfg.provider` sets `TooltipProvider` instead. The theme is
  light by default: the dark theme needs the `dark` class on the root element.

## Previews

- [GENERAL] Symptom: Tooltip cells threw "`Tooltip` must be used within `TooltipProvider`".
  Cause: stories import `./tooltip` from `src/`, and rule 2 of the story import policy only
  redirects imports that resolve into the package (`dist-ui/`). The preview bundled a second
  Radix copy. Fix: `cfg.storyImports.shim: ["src/components/ui/"]`.
- [GENERAL] The compare captures the Storybook root element only. A story whose content is only
  a portal (Dialog) gets `sb-error` ("no storybook root content"). Overlay stories need a trigger
  in the root and a frame large enough for the overlay (Dialog stories: `min-h-[640px]` decorator).
- Tooltip "Sides": the top tooltip flipped below its trigger near the frame edge. The story has
  vertical padding now.
- Dialog, DropdownMenu, Select and Tooltip use `cardMode: "single"` (overlays escape grid cells).

## Findings

- `--card-foreground` (`src/styles/conversation.css`) and `--popover-foreground`
  (`src/styles/projects.css`) are used but never defined. Validate reports them as
  `[TOKENS_MISSING]`. They are app CSS, not kit CSS. `--chat-width` and the Radix variable are
  set at run time.

## Re-sync risks

- The compiled CSS comes from the reference Storybook. It has only the Tailwind classes that some
  file in `src/` uses. If the app stops using a class that `conventions.md` names, the class
  disappears from the sync. Re-check the conventions names against `_ds_bundle.css` on each sync.
- Rebuild `dist-ui/` and the reference Storybook (`cfg.buildCmd`) whenever a kit component or a
  story changes. A stale `dist-ui/` ships old components.
- Dialog stories depend on the `min-h-[640px]` frame. A smaller frame crops the reference.
- Toolchain at first sync: Storybook 10.6.3, Vite 8, Tailwind 4.3, React 19.3, Node 22.23.
- Only the light theme is verified. The dark theme ships in the CSS but no story renders it.
