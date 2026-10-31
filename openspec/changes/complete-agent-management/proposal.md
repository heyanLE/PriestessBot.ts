## Why

The TypeScript runtime has a working Agent loop but lacks the daily management and message-processing depth users expect from AstrBotX. Add complete workflows behind the existing green Dashboard while retaining Agents SDK, strict types, independent Agents and three runtime states.

## What Changes

- Add durable conversations with transcript restoration, search, rename, archive, export, deletion and folder organization; separate conversations from execution events.
- Add reusable personas with folders, assignment to Agents and safe hierarchy management.
- Enhance structured message context and same-sender in-flight follow-up handling without merging other senders or authority domains; compact lengthy SDK history safely.
- Add a native TypeScript extension API for explicitly installed local tools/commands and lifecycle management; no AstrBot plugin compatibility.
- Add model-assisted, scope-preserving memory consolidation with preview/apply, provenance and periodic jobs.
- Add authorized workspace file/folder browser, upload/download/create/rename/delete operations.
- Add Dashboard management for these features and management login sessions, secret references, operational logs and backup/export workflows.

## Capabilities

### New Capabilities

- `agent-management-workspace`: Complete durable conversation, persona/folder, extension, memory-maintenance and operator-management workflows.

### Modified Capabilities

None. This capability extends the existing runtime without changing its fixed-route, permission or SDK boundary requirements.

## Impact

Touches TypeScript contracts/core/adapters/server and Vue Dashboard. Existing SQLite documents remain readable; new namespaces and backward-compatible schema defaults store added data. Existing live Telegram configuration and history must survive restart. Unconfigured optional jobs and extensions remain disabled. Audio/voice, Codex SDK, AstrBot plugin compatibility and new IM protocols remain out of scope.
