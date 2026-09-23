## Context

`MessageEvent.platform` and `AgentToolContext.platform/session` already preserve the concrete adapter instance for a message, while effective Workspace compilation validates a static union of registered tool IDs. MCP tools are injected through `EffectiveWorkspaceSnapshot.runtimeTools`, but Platform adapters have no equivalent contribution boundary. NapCat owns the authenticated OneBot HTTP/WebSocket connection and receives message/file identifiers, yet it currently exposes only plain-text `sendMessage` and drops most CQ segments.

The solution must keep tool advertisement and execution identical, prevent NapCat actions from appearing on Telegram/Weixin runs, preserve snapshot policy validation, and avoid making platform credentials visible to tools or config APIs.

## Goals / Non-Goals

**Goals:**

- Give every Platform adapter an opt-in scoped tool contract.
- Let strict Workspace validation recognize all registered Platform tool IDs.
- Inject only the current Platform instance's executable tools for a message.
- Implement a useful, permissioned NapCat OneBot message/group-file tool set.
- Preserve inbound message IDs and file/image components needed by tools.
- Require explicit allow for dangerous default-disabled tools.

**Non-Goals:**

- A universal cross-platform reply/file API in the first iteration.
- Arbitrary OneBot action passthrough.
- Uploading arbitrary NAS paths; file sending accepts HTTP(S) URLs only.
- Background file synchronization or permanent download storage.
- Platform hot-addition after configuration activation without reload.

## Decisions

### 1. Separate compile-time declarations from message-time executables

`PlatformRegistry` registrations receive a `toolFactory`. The compiler reads the union of their schemas as known tool descriptors, while each concrete `Platform` exposes only its own `platformTools()` during PreProcess. This preserves strict config validation without globally advertising NapCat tools to other platforms.

Alternative: globally register all Platform tools in `ToolController`. Rejected because a Telegram run could advertise NapCat tools when the Workspace allowlist is broad.

### 2. Platform tools are stateless and resolve the active adapter from context

NapCat tool objects do not capture credentials or a long-lived client. At execution they require `AgentToolContext.platform is NapCatPlatform` and use the current session. The adapter remains the sole owner of authentication and transport.

Alternative: create tools per Platform instance with captured clients. Rejected because it complicates snapshot/resource lifetime and increases credential retention.

### 3. Default-disabled tools require an explicit named allow

`ConfigurableToolDescriptor` carries `defaultEnabled`. With an empty Workspace allowlist, only default-enabled tools enter the effective set. A non-empty allowlist can explicitly add known default-disabled tools. NapCat file upload/delete/folder mutations are default-disabled; reply, mention, current-file inspection, and file listing are default-enabled subject to risk and permission filters. Group-file reads require ordinary `OPERATOR` permission, while upload, delete, and folder mutations require senior-operator `ADMIN` permission.

### 4. No arbitrary target override for reply and group actions

Reply uses the current inbound `messageId`; mention and group-file actions use the current group session ID. Tools cannot inject another group ID. This prevents cross-session actions from model-provided arguments.

### 5. One audited OneBot action boundary

`NapCatPlatform.callAction` posts typed JSON params, applies the adapter token internally, rejects non-zero OneBot responses, and returns the response data. There is no generic public tool for arbitrary actions.

### 6. Structured inbound attachment metadata

The NapCat parser extracts `message_id`, `group_id`, CQ `at`, `file`, and `image` segments. PreProcess adds the message ID and a JSON list of received file descriptors to tool-only Agent metadata; raw signed URLs are not logged.

## Risks / Trade-offs

- [NapCat endpoint variance across versions] → Keep actions isolated behind `callAction` and cover request payloads with a mock client.
- [Remote URL upload can trigger NapCat network access] → Require HTTP(S), senior-operator (`ADMIN`) permission, high-risk classification, audit logging, and explicit Workspace allow.
- [Group deletion is irreversible] → Require senior-operator (`ADMIN`) permission, high-risk classification, audit logging, and explicit allow.
- [Compile-time union includes tools for disabled Platform types] → Runtime injection still scopes executables to the current Platform; policy can deny unused IDs.
- [Incoming CQ parsing may see escaped attributes] → Decode OneBot CQ escapes and retain plain text around segments.

## Migration Plan

1. Add contribution contracts and default-enabled policy semantics with tests.
2. Add NapCat structured parsing and typed action boundary.
3. Add NapCat tool implementations and message-time injection tests.
4. Add selected NapCat tool IDs to the NAS Workspace policy only after the new binary is deployed.
5. Roll back by removing the new tool IDs and restoring the previous binary; persisted config has no new required fields.

## Open Questions

- Telegram and Weixin tool sets will be defined in later changes after the contribution framework proves stable.
