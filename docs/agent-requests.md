# Agent questions

Kalkidan shows agent questions separately from permission approvals. Answers go
only to the process and request that asked the question. A question response
does not grant permission to other tools.

## Protocol sources

The Codex schema was generated from `codex-cli 0.163.0-alpha.10.2`:

```sh
codex app-server generate-json-schema --out /tmp/codex-schema
```

`item/tool/requestUserInput` supplies question IDs and options. Its response maps
each question ID to `{ answers: string[] }`. `serverRequest/resolved` expires an
unanswered request. This is an experimental protocol. Generated schemas and
offline fixtures do not establish compatibility with every Codex version.

For Claude Code, `can_use_tool` requests for `AskUserQuestion` supply the question
list. Kalkidan returns the original questions and an answer map in `updatedInput`.
Multiple selected labels use the documented comma-separated format. See
[Claude user input documentation](https://code.claude.com/docs/en/agent-sdk/user-input).
The installed CLI inspected during implementation was `2.1.304`. Live provider
acceptance remains required before publishing an exact compatibility claim.

## Limits and recovery

- A request can contain up to ten questions and twenty options per question.
- An answer can contain 4,000 characters. A response can contain 32,000 characters.
- The backend checks required answers, option membership, and duplicate choices.
- IPC responses require the window that owns the run and the same execution host.
- The backend accepts a pending answer once. A broken transport expires it.
- Stop, provider cancellation, and SSH loss invalidate outstanding requests.
- The UI keeps ordinary draft answers in bounded process memory across panel
  remounts. Secret answers are not retained there. Answers are not written to logs
  or browser storage.
- Unknown provider methods remain unsupported. The UI fallback and version
  acceptance work in `implementation-gaps.md` remain open.

SSH helpers use protocol 2. Update an older helper from Settings before starting
remote work. The desktop does not send new request types to protocol 1 helpers.
