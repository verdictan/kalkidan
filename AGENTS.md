# Repository Guidelines

## Project Structure & Module Organization

- `src/`: UI components, hooks, domain logic, and IPC contracts (`components/`, `hooks/`, `domain/`, `api/`).
- `electron/`: desktop services, preload bridge, storage, GitHub, and SSH agent.
- `tests/`: unit, Playwright, and Electron tests.
- `scripts/` and `ci/`: architecture checks, packaging, and containerized validation.
- `public/`, `build/icons/`, and `docs/images/`: assets, icons, and screenshots.

Keep renderer code free of Electron and Node.js imports. Domain modules may depend only on domain/config modules; components must not import `src/app.tsx`.

## Build, Test, and Development Commands

Use Node from `.node-version` and npm from `package.json`.

- `npm ci`: install lockfile-pinned dependencies.
- `npm run dev`: start Electron with Vite.
- `npm run preview`: start the browser demo; native actions require Electron.
- `npm run build`: type-check and build renderer and Electron bundles.
- `npm test`: run unit tests with `tsx` and Node’s test runner.
- `npm run test:ui`: run Playwright browser tests.
- `npm run test:desktop`: build and run the Electron smoke test.
- `npm run check:architecture`: enforce module boundaries.
- `npm run lint`: check TypeScript, JavaScript, and React rules with Oxlint.
- `npm run typecheck`: check TypeScript without a build.
- `npm run dist:mac`: package macOS installers.

## Coding Style & Naming Conventions

Use strict TypeScript, two spaces, single quotes, trailing commas, and 100-column lines. Run `npm run format:check` or `npm run format` for Prettier. Use kebab-case filenames, PascalCase components/types, and camelCase functions/variables. Keep IPC contracts, preload methods, and handlers aligned.

`npm ci` installs Husky. Pre-commit checks and formats staged files with lint-staged, then checks module boundaries. CI checks all files. `.editorconfig` sets UTF-8, LF, and final newlines. Oxlint checks hook order; React Compiler migration rules are disabled.

## ASD-STE100 Simplified Technical English

Use [ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/) for documentation, comments, UI text, and PR descriptions. Use short sentences, active voice, approved terms, and one instruction per step. Preserve identifiers, commands, paths, and permitted technical names. Check the standard before claiming compliance.

## Testing Guidelines

Name tests `*.test.ts`, browser tests `*.spec.ts`, and integration scripts `*.mjs`. Test filesystem operations, IPC, and persistence in temporary directories. No coverage threshold is set. Run relevant tests, the build, and architecture checks before submission.

## Commit & Pull Request Guidelines

Use short, imperative subjects, as in history: “Fix handler error.” Keep commits focused. Describe the problem, behavior, tests, and limitations in PRs. Link issues; include screenshots for UI changes.

## CI & Release Safety

Jenkins handles CI and automatic main/master releases. Keep publishing credentials outside application and PR builds. Never commit secrets, generated bundles, or installers. Dependency updates are managed through Renovate PRs.
