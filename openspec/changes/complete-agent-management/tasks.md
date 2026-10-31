## 1. Durable management resources
- [x] 1.1 Add typed persona, folder, conversation and transcript persistence with conflict/cycle validation.
- [x] 1.2 Integrate transcript capture, persona assignment and conversation cancellation/deletion into runtime.
- [x] 1.3 Add authenticated CRUD/search/export APIs and green Dashboard persona/folder/conversation workflows.
- [x] 1.4 Restore persistent Web Chat transcripts and continuation across reload.

## 2. Message processing and concurrency
- [x] 2.1 Enhance bounded structured context and references/attachments while preserving trusted identities.
- [x] 2.2 Add safe bounded same-sender in-flight follow-ups; retain separate turns for different senders and immediate controls.
- [x] 2.3 Add SDK history compaction with complete-turn validation and provenance, preserving transcript.
- [x] 2.4 Test cancellation, authority changes, follow-ups, restart and history limits.

## 3. Extensions and memory
- [x] 3.1 Implement native local extension API, registry/lifecycle and tool/command authorization with documented example.
- [x] 3.2 Add extension management API/UI and tests for collision, disable, failure and revoked permissions.
- [x] 3.3 Add model-assisted scoped memory consolidation preview/apply with provenance and stale-source checks.
- [x] 3.4 Add opt-in periodic memory jobs and Dashboard controls with cancellation and overlap tests.

## 4. Operator management and workspace files
- [x] 4.1 Add expiring management sessions, login/logout restoration and write-only server secrets with audit records.
- [x] 4.2 Add rooted workspace files/folders APIs with traversal/symlink protections and safe mutations.
- [x] 4.3 Add file browser, upload/download and folder operations to Dashboard.
- [x] 4.4 Add management settings, operational logs and secret-free export controls.

## 5. Integration and release
- [x] 5.1 Pass strict type/lint, relevant full tests and production Dashboard/server builds.
- [x] 5.2 Verify persisted login, conversation history, personas/folders, memory, extensions and files against local real APIs/UI.
- [x] 5.3 Update documentation/specs and safely refresh idle local Telegram service without losing existing configuration.

## Verification evidence (2026-10-25)

- Strict TypeScript, ESLint and all151 backend tests passed without skips; production server and Dashboard builds passed.
- Live DeepSeek consolidation returned success with2 synthetic source memories merged into1 in an isolated in-memory database.
- CUA exercised the actual isolated Dashboard: cookie login/reload, persona+folder persistence, chat reload restoration, conversation editing, workspace mkdir/read and memory preview. Native extension API lifecycle and real SDK dispatch were verified by localhost integration tests.
- Current8082 service was confirmed idle, stopped gracefully, backed up to a0600 SQLite snapshot, and restarted with existing credentials/configuration. Telegram reports connected; new persona/conversation APIs and cookie authentication return200.
- The original browser tab contained an unsaved user draft and was preserved. A separate authenticated Dashboard tab was opened for the updated management UI.
