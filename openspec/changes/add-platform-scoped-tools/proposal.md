## Why

Platforms currently translate inbound and outbound messages but cannot contribute platform-native actions to the Agent tool loop. As a result, an Agent on NapCat cannot safely reply to the triggering message, mention a group member, or inspect and manage OneBot group files even though the adapter already owns the authenticated connection and session context.

## What Changes

- Add a platform-scoped tool contribution contract that lets each Platform expose stateless tool definitions for its own message runs.
- Include every registered platform tool ID in configuration validation while injecting only the current message Platform's executable tools into the pinned Agent context.
- Make default-disabled tools require an explicit Workspace/Agent allow entry before compilation can expose them.
- Preserve NapCat inbound message IDs and CQ file/image components as structured message context.
- Add NapCat tools for replying to the current message, mentioning a member in the current group, inspecting received files, listing group files, resolving group file URLs, uploading a URL as a session file, deleting a group file, and creating/deleting group folders.
- Require current-session targeting for messaging actions, allow ordinary operators to read group-file metadata, and require senior-operator (`ADMIN`) plus explicit high-risk policy for every file write.
- Add compiler, permission, platform isolation, parser, API adapter, and Agent-loop tests.

## Capabilities

### New Capabilities
- `platform-tool-contributions`: Defines how platform adapters declare, validate, scope, advertise, and execute platform-native tools.

### Modified Capabilities
- `platform-abstraction`: Platforms expose scoped tool contributions and structured inbound file/reply metadata.
- `agent-loop`: Prompt and executor tool sets include only tools contributed by the current message Platform after effective policy and permission narrowing.
- `workspace-runtime`: Configuration validation recognizes registered platform tool IDs and honors explicit opt-in for default-disabled tools.

## Impact

- Affects Platform registry/instances, effective configuration compilation, PreProcess metadata, ReAct tool scoping, Tool policy resolution, NapCat OneBot parsing and API actions, and Workspace tool policy.
- Introduces no persisted secret fields and no new external dependency.
- Existing platforms contribute no tools until they opt in, so Telegram and Weixin behavior remains unchanged.
