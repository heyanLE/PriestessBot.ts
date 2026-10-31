# Agent management workspace

## Purpose

Provide durable Agent management workflows, scoped message processing and a complete operator workspace for the TypeScript runtime.

## Requirements

### Requirement: Durable conversation workspace
The system SHALL persist conversations, sender-attributed transcripts and run links, support search, rename, archive, export, delete and folder moves, and restore Web Chat after reload without changing authority boundaries.

#### Scenario: Restore and organize a conversation
- **WHEN** an operator sends messages, renames a conversation, moves it into a folder and reloads
- **THEN** the transcript, title, folder and run links remain available and subsequent messages continue the intended conversation.

#### Scenario: Delete during active work
- **WHEN** an operator deletes a conversation with active work
- **THEN** active and queued work is cancelled, historical model context cannot be resurrected, and late output cannot recreate deleted data.

### Requirement: Personas and folder hierarchy
The system SHALL provide reusable personas, Agent assignment, typed hierarchical persona/conversation folders, ordered user/assistant example dialogs, nullable tool and Skill restrictions, and custom failure replies. Persona restrictions SHALL only narrow existing Agent grants; examples SHALL enter model requests with their original roles without becoming real transcript entries. Voice metadata SHALL remain preserved while audio is out of scope.

#### Scenario: Invalid folder move
- **WHEN** a folder is moved into itself, a descendant, or a different resource kind
- **THEN** the server rejects the change and preserves the existing hierarchy.

### Requirement: Structured messages and cooperative concurrent input
The system SHALL preserve message identities, references, attachments and trustworthy provenance, support bounded same-sender active-run follow-ups at safe execution boundaries, and queue different senders separately.

#### Scenario: Another sender cannot steer a run
- **WHEN** another sender posts during an active run
- **THEN** their message queues as a separate turn and cannot acquire the active sender's context or permissions.

### Requirement: Context compaction
The system SHALL compact oversized SDK history without deleting the durable transcript, retaining valid tool call/result boundaries and isolating summaries by the existing authorization domain. Operators SHALL configure estimated context-window and compression thresholds, retained target, turn bounds, summary model/connection, instructions and budget. Semantic compression SHALL use a bounded tool-free model call and strict output validation, charge usage to the run, and fall back to bounded extracts on summary failure without persisting revoked or stale results.

#### Scenario: Long conversation continues
- **WHEN** model history exceeds the configured threshold
- **THEN** older complete turns are compacted with recorded provenance while recent turns remain intact and the conversation can continue.

### Requirement: Native extensions
The system SHALL provide a documented native extension contract, explicit local registration, enable/disable and diagnostics for tools and commands, retaining capability/resource validation and rejecting collisions.

#### Scenario: Disabled extension is unavailable
- **WHEN** an operator disables an extension
- **THEN** new runs cannot discover or invoke its tools or commands and already-running calls recheck authorization before additional side effects.

### Requirement: Semantic memory maintenance
The system SHALL support bounded scope-preserving memory consolidation proposals, explicit apply with stale-source checks, source provenance, and opt-in periodic jobs with visible status.

#### Scenario: Stale proposal is rejected
- **WHEN** a source memory changes after a consolidation preview
- **THEN** applying the old proposal fails without deleting or overwriting newer memories.

### Requirement: Authorized workspace files
The system SHALL support file listing, reading, uploading, downloading, folder creation, rename/move and safe deletion within configured authorized workspace roots.

#### Scenario: Escape attempt
- **WHEN** a path or symlink escapes the selected workspace
- **THEN** every read and mutation is rejected without exposing or modifying external files.

### Requirement: Operator Dashboard management
The Dashboard SHALL expose the above workflows with shared typed responses, green theme, persistent expiring login sessions, write-only secret management, configuration export and credential-free operational logs.

#### Scenario: Authenticated reload and export
- **WHEN** an authenticated operator reloads and exports configuration
- **THEN** a valid session restores access, expired sessions require login, and no secret values appear in exported configuration or logs.

### Requirement: Replaceable context and precise continuation boundaries
The system SHALL prefer provider-reported input usage for a verified history prefix and estimate only uncovered content with AstrBotX-compatible fallback weights. It SHALL support recent-history ratios, independent finished-turn limits, trim batches and hard-limit-only processing during active runs. Dynamic reference snapshots SHALL replace previous values outside durable history and be checked against the final request window before provider dispatch.

#### Scenario: Follow-up during tool execution
- **WHEN** the current sender adds input while tools are executing
- **THEN** the next model request includes it once, before the logical run completes, without replaying tools or merging another sender's authority.

#### Scenario: Reference changes during compression
- **WHEN** memory or knowledge changes while compression is pending
- **THEN** the actual refreshed snapshot is validated before dispatch and stale dynamic values are not retained as new durable history.

### Requirement: Explicit historical continuation
The management workspace SHALL support creating a new scoped conversation from recoverable archived messages without altering the original record or replaying opaque engine execution state.

#### Scenario: Retry or restart after history import
- **WHEN** an operator retries a continuation request or the runtime restarts
- **THEN** history seeds commit once, retain source provenance, and cannot be consumed by a different principal, Agent, state, generation or authorization version.
