# PriestessBot Dashboard design

## Product

PriestessBot is the operator console for Agents, IM robots, conversations and tool execution. Preserve the existing Logo and green visual theme. The live app uses only the current Node.js runtime; archived Kotlin and Rust modules are not imported or bundled.

Historical design references and earlier implementations remain in `archive/kotlin/dashboard`. External project names, URLs and license notices in that archive remain attributable to their actual authors.

## Visual tokens

- Canvas: `#F2F6F4`.
- Working surface: `#FFFFFF`.
- Primary content: `#213B33`.
- Navigation: `#EDF4EF`.
- Main action: `#327D68`; selected surface: `#E2F1E9`.
- Structural separator: `#DCE7E1`.

Use Avenir Next for Latin text and PingFang SC/Hiragino Sans GB for Chinese. Keep field labels readable, reserve monospace for actual IDs and code, and use small corner radii with limited shadows. Green identifies the current location and primary action. Avoid decorative gradients, nested panels and invented status data.

## Navigation

| Primary workspace | Contents |
| --- | --- |
| Workbench | Overview, conversations, console chat, runs and approvals, background processes, files |
| Agent | Model/persona, tools/resources, context/memory, execution/approvals |
| Robots | Platform instances, connection wizard, message routing, sender roles |
| Resources | Personas, knowledge, memory, capability directory, plugin/search settings, MCP and Skills |
| Settings | Management credentials and audit, model connections, execution environments |

Keep stable URLs and browser history. Object and section query parameters retain the selected Agent, platform, conversation or run. A new page starts at the top; Back/Forward restores the browser's saved position. Compatibility routes redirect to current pages instead of loading historical applications.

## Editing and publication

The Agent workspace keeps configuration and model testing side by side on desktop. The test panel remains visible while long configuration forms scroll. Narrow layouts stack them. Show the model and persona before advanced identity, prompt compilation and budget details.

Persona management is one list with editing only. Agent chooses its persona. Editing a shared persona must identify its impact on bound Agents and retain the independent save boundary. Sender authorization assigns one fixed state to one or more exact sender IDs. State permissions are read-only and come from the shared contract. Tool and resource selection remains separate from those permissions.

Agent and persona binding publication checks both revisions atomically. Show the actual change scope and runtime interruption impact before publication. Preserve other objects' unfinished drafts, including temporarily invalid field values. Authentication expiry retains current edits while requesting login again. Never silently select a different object when a requested ID no longer exists.

Runtime configuration, independent resource saves and immediate actions have explicit boundaries. Use confirmed outcomes for completion messages. A connected management service does not imply a connected IM adapter, and a format check does not establish network connectivity.

## Tools and execution

Group general tools separately from platform-specific capabilities. Build the directory from actual registration and injection rules. Show the source, applicability and minimum runtime state; unsupported capabilities must not appear as usable switches. MCP tools are discovered at runtime rather than guessed from names.

The minimum state for a command tool does not imply complete Shell access. Restricted command names, syntax and download bounds are read from `packages/contracts/src/command-policy.ts`. Ordinary and senior states use the restricted container runner; full Shell and terminal input require the high senior state. Approval cannot widen the assigned state or command policy.

Model draft testing uses the real engine with an isolated session. It does not execute tools, read production memory or deliver IM messages. Explain these limits and possible model charges beside the test controls.

## Clear copy

Use short sentences, one topic per sentence and concrete verbs. Keep terminology consistent: configuration draft, publish, format check, connection status. Field help explains purpose, input and effective time only when needed. Errors identify the field and next action without echoing submitted values. Show permissions, charges and interruption effects directly; place protocol detail and limits in expandable help.

This Chinese interface borrows clear-writing principles from STE; it does not claim English STE conformance.

## Source and type boundaries

Shared DTOs and schemas live at root `packages/contracts/src`. External JSON is `unknown` until validated. Use explicit DOM narrowing and strong application types. The active workbench rejects `any`, unchecked type assertions, non-null escapes and typecheck bypass comments. Management tokens stay in memory; login state uses the server's HttpOnly session cookie.

`src/components/typescript` and `/api/ts` retain their compatibility names; they are code/API identifiers, not the former runtime directory. All source imports and test tooling resolve against the root `packages` and `node_modules` directories.

## Verification

Run `npm run build:dashboard` and `npm run test:dashboard` from the repository root. The frontend build performs the strict workbench gate and Vue typechecking. Logic tests cover navigation, unsaved drafts, typed API errors, sender groups, command-policy display and object publication.

Browser checks use isolated data and must name their evidence limits. Check the selected object, tab switching, editing, publication scope, re-login recovery, platform workflow, desktop/mobile layout and console errors. HTTP success or build success alone is not visual verification. Keep historical smoke scripts in the archive; current browser scripts are `ts-browser-smoke-test.mjs` and `ts-live-smoke-test.mjs`.
