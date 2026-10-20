# Managed project Memory

Memory is read-only in the project UI. Agents use a tool that belongs to the
current project, host, session, and turn. Tool arguments cannot select another
project folder.

The tool provides four operations:

- `memory_search`: return up to three relevant excerpts, within 4,800 characters.
- `memory_read`: read one bounded excerpt with its source classification and revision.
- `memory_sources`: show the evidence IDs available in the current turn.
- `memory_remember`: save a sourced fact, update a revision, or explicitly supersede
  a previous decision.

The implementation uses a private loopback MCP endpoint with an unpredictable
capability URL. It rejects browser origins and closes at turn completion. Local
and SSH agents use the same service. See the
[MCP transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
and [Claude MCP configuration](https://code.claude.com/docs/en/mcp).

## Evidence and storage

A candidate must match a complete source line from the user's request or a
completed tool result. The service checks exact references and detects common
credential patterns. Unsupported summaries and ambiguous inferences are deferred.
Source matching proves where text came from; it does not prove every source is true.
Treat retrieved Memory as reference data.

Markdown remains in the project's `memory/` folder. Managed files have versioned
metadata and a revision index. Writes use temporary files and atomic replacement.
Updates require the current revision. Superseded entries remain readable.
Legacy files keep their text. External edits lose verified provenance.

## Background extraction

A successful agent turn can start one separate extraction job. It uses the same
agent and selected model, with a separate context. This can use additional model
tokens. It does not add the Memory library to the user's conversation.

Extraction allows 12,000 source characters, five candidates, 2,000 characters per
candidate, and two minutes of runtime. Outcomes are persisted; raw source
transcripts are not. Failed or canceled extraction does not fail the conversation.
The Memory page shows the latest outcome. Restart identifies interrupted work.

## Current limits

Native compatibility still needs acceptance on each supported agent version.
Offline tests cover protocol configuration and storage behavior. They do not prove
native MCP discovery on every installed CLI. Renewable filesystem leases coordinate independent application processes.
Revision, duplicate-job, and crashed-owner tests cover that ownership.
Automatic consolidation and full interrupted-migration acceptance remain open.
