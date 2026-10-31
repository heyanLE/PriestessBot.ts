## 1. P0 Reference and engine feasibility

- [x] 1.1 Create a behavior matrix from the local Kotlin and AstrBotX implementations, explicitly separating present code, tests and unverified integration.
- [x] 1.2 Compare fork revisions 413f16a and 7c41085, select and pin a revision with the required public Engine, code mode and scope APIs.
- [x] 1.3 Build a minimal Rust Engine turn against a mock Responses server without Python or JNI.
- [x] 1.4 Build the matching code-mode-host and verify deferred discovery, a batched tool call and structured text/image results.
- [x] 1.5 Verify dynamic additional_context updates and compatible rollout resume without thread recreation.
- [x] 1.6 Record the initial three-state capability matrix and compatibility treatment for NORMAL/DEEPSEEK_HARNESS Agents.

## 2. P1 Rust domain and management foundation

- [x] 2.1 Create the Cargo workspace and the four initial crate boundaries with formatting, lint and test checks.
- [ ] 2.2 Define independent AgentDefinition, model connection, content parts, resource bindings and RunContext types.
- [x] 2.3 Implement schema-v4 validation, immutable configuration snapshots and atomic publication.
- [x] 2.4 Implement operator/senior_operator/elite_operator capability profiles with ordinary default state.
- [x] 2.5 Implement effective permission/resource intersection and trusted state provenance; test unassigned resources and forged state data.
- [ ] 2.6 Add SQLite migrations for configuration, graph revisions, runs, turns, artifacts and thread mappings. Configuration, graph snapshots, session generations, completed turns and rollout mappings are implemented; standalone run/artifact persistence remains for the observability/artifact milestone.
- [ ] 2.7 Provide management authentication and generated frontend contracts for enums, node schemas and errors.
- [ ] 2.8 Add execution correlation, bounded event payloads, credential redaction and health endpoints.

## 3. P1 Code-defined commands

- [x] 3.1 Implement command name/alias registration, typed argument schemas and conflict detection.
- [x] 3.2 Implement argument parsing with required fields, types, quoting, escaping, trailing text and usage errors.
- [x] 3.3 Implement command capability/state checks and handled/unhandled/error outcomes.
- [x] 3.4 Implement structured replies through the shared delivery layer and verify delivery failure cannot rerun handlers.
- [x] 3.5 Port help and new/reset commands with conversation identity preservation.
- [x] 3.6 Add a cancellation control path and verify stop can interrupt an active turn without queue deadlock.

## 4. P2 Route graph without UI

- [x] 4.1 Define graph serialization, stable node/port IDs, typed schemas and server-owned node registration.
- [x] 4.2 Implement condition/switch and transform nodes; test immutable sender/platform/session metadata.
- [x] 4.3 Implement SetRuntimeState with explicit elevation and reduction, tracing the granting node and revision.
- [x] 4.4 Implement input, command, Agent, reply, end and error nodes with typed outcomes.
- [x] 4.5 Implement rate-limit and duplicate-input nodes with bounded state.
- [x] 4.6 Validate DAG shape, ports, reachability, branch defaults, resource references and exactly one Agent on normal paths.
- [x] 4.7 Compile immutable plans; implement revision-conflict rejection, atomic publish and rollback.
- [x] 4.8 Enforce per-node deadlines, total deadline, steps and payload limits; test cancellation and non-idempotent retry prevention.
- [x] 4.9 Build side-effect-free simulation with selected state, Agent and traversed path output.
- [x] 4.10 Import legacy routes and role lists into explicit condition/state graphs and compare representative routing outcomes.

## 5. P3 Codex and session runtime

- [ ] 5.1 Implement the production Rust Engine adapter with runtime capability reporting and pinned dependency checks.
- [x] 5.2 Implement durable IM-instance/session/Agent to thread mapping and explicit resume failure notices.
- [ ] 5.3 Implement bounded per-session queues and global concurrent-session budgets.
- [ ] 5.4 Implement same-caller steering gated by Agent, state, effective authorization and graph-context compatibility.
- [ ] 5.5 Test other-caller queues, queue overflow, state-changing follow-ups and new/reset races.
- [ ] 5.6 Inject stable instructions separately from dynamic persona/memory/knowledge context; test recall changes preserve continuity.
- [ ] 5.7 Implement deferred tool manifests and run/turn/call-scoped callbacks; reject stale, duplicate and unauthorized calls.
- [ ] 5.8 Implement typed text/image/file tool results, overflow references and artifact ownership checks.
- [ ] 5.9 Expose ordered text/tool/usage/terminal events and cancel/drain lifecycle through one engine interface. Displayable text streaming and terminal reply reconciliation are connected; a unified public tool/usage event contract remains pending.
- [ ] 5.10 Validate live-I/O cancellation, shutdown during polling, failed-engine recovery and the chosen native-fault isolation strategy.

## 6. P4 Execution services and Skills/MCP

- [ ] 6.1 Define execution backend interfaces and honest capability metadata for local and isolated environments.
- [ ] 6.2 Implement file read/write/patch and artifact output with path and run ownership checks.
- [ ] 6.3 Implement PTY execution, output cursors, stdin, cancellation and per-session ownership enforcement.
- [ ] 6.4 Route deduplicated background completion through the session scheduler and test cancelled-owner behavior.
- [ ] 6.5 Add the selected isolated execution backend and verify filesystem/process isolation on its deployment target.
- [ ] 6.6 Port authorized Skills catalog/body/reference access and explicit skill mentions with resource path validation.
- [ ] 6.7 Implement MCP transport integration and per-run filtered tool catalogs with call-time policy checks.
- [ ] 6.8 Enforce the same state policy for engine-native effects or disable unsupported native effects explicitly.

## 7. P4 Long-term memory and knowledge

- [ ] 7.1 Implement authoritative scoped memory records, source provenance, retrieval, writes, expiration and deletion.
- [ ] 7.2 Verify native memory scope/consolidation interfaces and integrate them through MemoryService, or expose a documented host-managed fallback.
- [ ] 7.3 Implement bounded extraction and consolidation jobs with privacy/state checks and no automatic global promotion of mixed group content.
- [ ] 7.4 Test cross-session/library isolation and deletion consistency across records and retrieval caches.
- [ ] 7.5 Implement knowledge import jobs and versioned text/Markdown/PDF extraction and chunking.
- [ ] 7.6 Implement embedding adapters, selected vector storage and version-aware index rebuilds.
- [ ] 7.7 Implement sparse retrieval, permission-filtered hybrid fusion, optional reranking and provenance-rich citations.
- [ ] 7.8 Test failed ingestion, retry, document deletion and unauthorized library exclusion.
- [ ] 7.9 Add MemoryRecall and KnowledgeRetrieve graph nodes with explicit resource bindings.

## 8. P4 Active multi-Agent execution

- [ ] 8.1 Implement explicit delegation target selection and isolated child run contexts.
- [ ] 8.2 Intersect inherited capabilities with target Agent restrictions; test that delegation cannot elevate runtime state.
- [ ] 8.3 Enforce delegation depth/count/concurrency and shared time/token budgets.
- [ ] 8.4 Implement parent cancellation and result collection without shared-session-lock deadlocks.
- [ ] 8.5 Trace parent/child/tool relationships and return child results to the parent without unintended IM replies.

## 9. P5 IM and multimodal delivery

- [x] 9.1 Implement platform trait, registry and content/reply/edit capability reporting.
- [x] 9.2 Port Telegram ingress/egress with identity, reply and attachment fixtures. Transport is complete; rich-text parity is tracked separately in 9.9.
- [ ] 9.3 Port NapCat ingress/egress and platform tools with group/mention/quote fixtures. Ingress/egress, identity/quote fixtures and live command/Agent delivery are complete; platform tool catalog remains pending.
- [ ] 9.4 Port WeChat iLink login, state persistence and supported message delivery.
- [ ] 9.5 Connect image/file content to model input, authorized media storage and output artifacts; leave audio/voice explicitly unsupported. Telegram/NapCat image, UTF-8 and text-PDF inputs, scoped prepared-media storage and cancellation are implemented; general output artifact ownership/materialization remains pending.
- [x] 9.6 Implement throttled stream edits, chunk/final fallback and delivery deduplication with partial-failure tests. Telegram edits and NapCat chunks share the durable send ledger, with final reconciliation, confirmed-edit fallback, cancellation and uncertain-send no-replay tests.
- [ ] 9.7 Run live text/image/tool/multi-turn smoke tests for the three initial platforms. Telegram and NapCat live text commands and real code-mode echo calls passed on 2026-10-24; Telegram/NapCat private image, file and streamed long-answer tests were verified on 2026-10-25; Markdown presentation remains in 9.9, and broader multi-turn tests and WeChat remain pending.
- [ ] 9.8 Inventory remaining AstrBotX IM adapters and create per-platform port/fixture/live-validation tasks before declaring additional support.
- [x] 9.9 Implement AstrBotX-inspired platform Markdown presentation: Telegram MarkdownV2 with private drafts, group edits and definitive-rejection fallback; NapCat readable segmented/final text and configurable whole-document image output (readable text is the user-selected default). Preserve incomplete syntax, code/quote pagination, list numbering, links, tables, Unicode, final reconciliation and uncertain-send no-replay. Replaces the earlier Kotlin-specific presentation plan per user direction on 2026-10-25.

## 10. P5 Visual routing and resource management

- [ ] 10.1 Select and prototype a canvas component with typed ports, keyboard interaction and undo/redo.
- [ ] 10.2 Build server-schema-driven node palette and configuration panels, including the three-state selector.
- [ ] 10.3 Implement drafts, validation messages, revision conflicts, publish and rollback.
- [ ] 10.4 Implement sample-event simulation and visible branch/state/Agent results.
- [ ] 10.5 Display node execution paths, streamed Agent events and child-run traces.
- [ ] 10.6 Adapt existing Agent/resource editors to generated Rust contracts and show actual engine/platform capabilities.
- [ ] 10.7 Add knowledge import status, scoped memory administration and execution-environment inspection.
- [ ] 10.8 Validate a complete canvas-created route through state selection, command fallback, Agent execution and IM reply.

## 11. P6 Migration and release qualification

- [x] 11.1 Build a repeatable migration command with backup, separate target directory, per-entity diagnostics and idempotent rerun behavior.
- [ ] 11.2 Import configurations, personas, skills, memory, knowledge and conversation history; report unsupported engines/plugins and rollout incompatibility explicitly.
- [ ] 11.3 Package the server, matching code-mode-host, frontend and required execution assets for macOS and the actual Linux target architecture.
- [ ] 11.4 Add CI for Rust tests/lints, frontend build, API compatibility and artifact smoke tests.
- [ ] 11.5 Verify graceful single-consumer IM cutover and restore from the legacy snapshot with documented new-data handling.
- [ ] 11.6 Run the acceptance matrix across state escalation by routes, forbidden child escalation, concurrent messages, images, streaming, recovery, RAG and command replies.
- [ ] 11.7 Reconcile old Kotlin-oriented OpenSpec changes with delivered Rust behavior, update operator documentation and declare the supported feature/platform matrix.
