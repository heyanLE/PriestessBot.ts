## 1. Platform Tool Contribution Framework

- [x] 1.1 Add Platform/PlatformRegistry contracts for compile-time tool declarations and current-instance executable contributions
- [x] 1.2 Include Platform tool schemas in strict configuration compilation without globally registering their executables
- [x] 1.3 Inject only the current message Platform's tools into the pinned Agent context and add platform-isolation tests
- [x] 1.4 Extend tool policy resolution so default-disabled tools require an explicit named allow and add regression tests

## 2. Structured NapCat Context

- [x] 2.1 Preserve OneBot message ID, group ID, sender/self IDs, and CQ at/file/image components in MessageEvent
- [x] 2.2 Add message ID, reply ID, and received-file descriptors to tool-only Agent metadata without logging attachment URLs
- [x] 2.3 Add parser tests for escaped CQ segments, files, images, mentions, and message identifiers

## 3. NapCat OneBot Action Boundary

- [x] 3.1 Add an authenticated typed NapCat HTTP action method with OneBot status/error validation
- [x] 3.2 Add helpers for current-session reply and segmented group/private messages
- [x] 3.3 Add mock-client tests covering auth, payloads, success data, and OneBot/HTTP failures

## 4. NapCat Scoped Tools

- [x] 4.1 Implement current-message reply, current-group mention, and received-file inspection tools
- [x] 4.2 Implement current-group file listing and file URL resolution tools
- [x] 4.3 Implement HTTP(S)-only current-session file upload with explicit permission/risk controls
- [x] 4.4 Implement default-disabled group file deletion and folder create/delete tools with administrator/high-risk controls
- [x] 4.5 Add tool schema, current-session targeting, incompatible-platform/session, permission, and response tests
- [x] 4.6 Define and verify ordinary-operator group-file reads and senior-operator group-file writes

## 5. Verification and Deployment Readiness

- [x] 5.1 Add end-to-end Agent-loop tests proving NapCat tools appear in prompt/executor while Telegram tools remain absent
- [x] 5.2 Run complete JVM tests, Dashboard build/smokes, launcher smoke, and strict OpenSpec validation
- [x] 5.3 Document the Workspace allowlist entries and safe NAS rollout/rollback sequence for the new tools
