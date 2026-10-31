## Why

The current Agent editor exposes competing prompt fields without explaining the effective persona, and the runtime lacks the platform/search/plugin capabilities used in the user's AstrBotX setup. Add native TypeScript equivalents with real runtime hooks and usable configuration rather than Python plugin compatibility.

## What Changes

- Align Agent prompt configuration with AstrBotX: explicit persona selection, effective source preview, advanced supplemental system instructions, and no misleading editable overridden persona fields.
- Expose scoped NapCat group-file, album, member and announcement tools with pagination, upload/download, clear permissions and optional upload processing.
- Add independently configurable web search/fetch, using the local AstrBotX DeepSeek Search protocol plus supported provider choices.
- Add a first-party plugin workspace with typed settings, enable/disable/reload/status, tools/commands, ingress/egress hooks and bounded scheduled jobs.
- Implement native QQ file, Markdown formatting, Bilibili, Bangumi and local reminiscence features against pinned upstream sources. Record exact supported behavior, dependencies and remaining external account requirements.
- Preserve current NAS configuration/drafts and safely deploy after validation; do not send unsolicited IM test messages or enable autonomous subscriptions without explicit configuration.

## Capabilities

### New Capabilities
- `native-platform-plugins`: Typed platform tools, search and managed native plugins with prompt-source clarity.

### Modified Capabilities
None. Existing Agent identity, three-state permissions, scoped context and SDK boundaries remain requirements.

## Impact

TypeScript contracts/adapters/runtime/management APIs, Vue Dashboard, migration/deployment tooling and dependency packaging. Upstream sources are pinned in `/private/tmp/priestess-plugin-references`; no downloaded Python plugin code is executed. Secrets remain write-only references; mutable plugin state is scoped and durable.
