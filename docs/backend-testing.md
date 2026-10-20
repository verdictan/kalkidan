# Backend tests

Use the Node version in `.node-version`. Run `npm ci` before the tests.

## Commands

- `npm run test:backend:deterministic`: run the isolated suite once in UTC.
- `npm run test:backend:repeat`: run it in UTC, America/Los_Angeles, and Asia/Tokyo. The second run reverses the file order.
- `npm run test:backend:coverage`: run the isolated suite and write HTML, LCOV, and JSON reports to `coverage/backend/`.
- `npm run test:backend:coverage:strict`: require 100% statements, branches, functions, and lines in each backend file. This command fails while coverage gaps remain.
- `npm test`: run all unit tests and native transport tests.

## Scope and isolation

Coverage includes all TypeScript files under `electron/`, including files that no test imports. It includes the main process, preload bridge, remote agent, agent protocols, storage, and tracker adapters. Renderer coverage is outside this report.

The isolated suite replaces Electron, SSH, agent processes, and network boundaries with fixtures. The preload guard rejects live network connections and application subprocesses. It allows the pinned esbuild service that compiles TypeScript. Storage tests use temporary folders and SQLite databases. Tests control protocol events and request timers instead of waiting for a response from a real service.

The runner lists native test files separately. These tests use Git, shells, PTYs, or a local SSH transport fixture. They remain in `npm test`. Do not add a native test to the isolated suite or weaken its guard.

## Add tests

Use `node:test` and `node:assert/strict`. Name test files `*.test.ts`. Use `tests/helpers/backend-loader.ts` when a service needs an isolated dependency graph. Stub external dependencies and assert outputs, persisted data, command arguments, and cleanup behavior. Release temporary folders and resources after each test.

Keep failure cases for corrupt files, invalid IPC callers, stale requests, cancellation, and partial operations. Use controlled promises for concurrency. Do not use sleeps or elapsed-time assertions.

## Read coverage

Open `coverage/backend/index.html`. Jenkins exports the report through its container artifacts. CI runs the coverage suite and the full test suite.

The 100% target is not yet met. The strict command remains separate from release validation. Remaining counts include real branch gaps and generated CommonJS code that V8 maps to source lines. Do not exclude application files or add ignore comments to make the report pass. A passing test run or a high line percentage does not prove complete behavior coverage.
