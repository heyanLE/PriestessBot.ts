## Context

The running Node/SQLite runtime and Vue shell already implement typed events, scopes, SDK sessions, immutable configuration revisions and three IM adapters. Management currently exposes runs, not durable user-facing conversations. Persona is inline text; resources have basic CRUD; SDK histories have a hard size limit. Existing Telegram consumer and credentials must remain intact.

## Goals / Non-Goals

**Goals:** implement the user-requested message/concurrency/extension/memory/persona/folder/conversation/Dashboard workflows, including real persistence and operational controls. Folder management covers persona folders, conversation folders, and authorized workspace directories as explicitly confirmed by the user.

**Non-Goals:** Python plugin compatibility, new IM protocols, audio/voice, replacing Agents SDK, arbitrary graph topology, and granting IM senders management access.

## Decisions

- Use additive schema-validated SQLite namespaces and focused services/HTTP handlers. Conversation identity retains platform, chat type, chat ID, Agent and history generation; transcript entries retain sender and run provenance. Archive/delete/move never silently merge sender-private SDK histories.
- Persist personas and hierarchical folders with cycle/kind checks. Agent persona assignment resolves server-side; deletion of referenced personas is rejected until unbound. Conversation transcript is separate from bounded model context and survives compaction.
- Same-sender additional messages are accepted only for an active compatible run, with a bounded queue and revalidated authority. Consume them at supported safe model/turn boundaries; no cancellation/replay of earlier side effects. Other senders queue normally. Control commands remain immediate. Context compaction preserves valid tool-call/result boundaries and records what was summarized.
- Extensions are explicitly installed local JavaScript modules implementing a documented strict TypeScript API; they run as trusted host code, are not Python-compatible or claimed to be sandboxed. Their tool/command invocations still require runtime capability/resource checks. Installation/enabling is management-only; discovery and configuration do not execute module code implicitly.
- Memory consolidation uses a bounded model-generated proposal within one existing authority scope, with source IDs and optimistic change checks. Preview precedes manual apply; opt-in periodic execution uses the same checks, persists jobs and avoids overlaps.
- Workspace management is authenticated and rooted in configured execution environments. Canonical path and symlink checks apply to list/read/upload/download/mkdir/move/delete. Nonempty directory deletion is refused; local and Docker isolation are represented honestly.
- Dashboard gains real conversation/persona/folder/file pages and extension/memory management panels. Keep Logo-green styling. Use expiring server login sessions and safe cookie handling while retaining management-token compatibility. Secret writes are write-only server-side references; exports exclude secret values. Operator audit logs record actions without credentials.

## Risks / Trade-offs

- Native extensions execute host code → explicit trusted local installation, enable/disable, validation and no remote package execution.
- Concurrent edits or memory summaries overwrite newer data → optimistic revisions and source hashes reject stale apply.
- Message/compaction changes break SDK history → typed protocol parsing, complete turn boundaries, cancellation and authority regression tests.
- Live restart interrupts test chat → only restart after idle; preserve SQLite and token, verify one consumer.

## Migration Plan

Add fields with defaults and new namespaces; backfill historical conversation metadata from existing runs where trustworthy inputs exist. Preserve historical runs and avoid inventing missing messages. Keep backup before live launch. Rollback uses source/database snapshot and retains new data separately.
