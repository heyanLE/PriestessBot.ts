# Dashboard design direction

Applied reference: [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md), read on 2026-09-16. This is an implementation in the existing Vue application, not a new prototype or backend redesign.

## Product and task

PriestessBot is an operator console for composing Agents, routing IM messages, and diagnosing model/tool executions. Keep the existing logo image and PriestessBot name. Preserve configuration preview/revision checks and all current resource permissions.

## Tokens

Latest user direction (2026-10-25): use AstrBotX’s Dashboard and IM management structure, with a green palette drawn from the existing Logo. This supersedes the earlier gold-palette direction. The Logo is unchanged.

- Mist `#F2F6F4`: application canvas.
- White `#FFFFFF`: working surface.
- Forest ink `#213B33`: primary content.
- Pale green `#EDF4EF`: navigation.
- Logo green `#327D68`: primary actions; `#E2F1E9`: selected surfaces.
- Soft green-gray `#DCE7E1`: structural separators.

Typography: Avenir Next for Latin names and interface controls, PingFang SC/Hiragino Sans GB for Chinese. Use a 12/13/14/16/22/28 scale. Reserve monospace for actual code, IDs and payloads. Body fields and operational labels remain sans-serif. Use 6–10 px corner radii, limited shadows and visible keyboard focus.

## Layout alternatives and review

A single long form keeps all fields in document order but makes model choice, resource mounting and execution budgets difficult to locate. The selected object workbench gives each task a stable place without discarding drafts when switching sections.

```
Long-form alternative         Selected workbench
navigation | object list      navigation | page / connection status
           | all fields                  | preview / apply controls
           | all resources               | object list | object identity
           | all budgets                 |             | task tabs
                                         |             | active editor
```

All form content is left aligned. Agent uses four sections; IM uses connection, route and identity sections. The route number is meaningful priority, so numbering is retained there. Execution details use an ordered timeline with payload disclosure, not expanded JSON everywhere.

The existing Logo anchors the pale green navigation frame. Green indicates the current location and primary actions; white working surfaces keep dense forms readable. Avoid decorative gradients, generic large hero headlines, repeated title cards and invented monitoring data. Configuration filenames belong in optional source details, not the primary editing hierarchy.

## Verification

Inspect desktop and narrow/mobile breakpoints. Verify tab keyboard controls, draft preservation, form validation, previews, route ordering, resource navigation, execution filters and payload expansion. Inspect the packaged app, not only source or a static mock. Keep runtime labels truthful: a healthy HTTP service does not imply that every IM connection is online.

## TypeScript runtime workbench

The TypeScript overview is the default `/` route. `/platforms`, `/providers`, `/agents`, `/extensions`, `/permissions`, `/knowledge-base`, `/memories`, `/chat`, `/sessions`, `/flow`, `/execution` and `/settings` are independently addressable pages with browser history. They share a mounted workbench so management credentials and configuration drafts survive navigation. `/legacy` retains the old overview and `/rust` the earlier experiment. The current shell follows AstrBotX’s object-oriented navigation and list/detail workspaces, using the original Logo with green theme tokens. It does not load legacy Kotlin endpoints.

Robot configuration, adapter connection status and WeChat QR login are colocated. Model services and MCP/Skills use a searchable source list and one selected editor. Agent settings are divided into basics/persona, resources/tools, permissions/approval and execution/delegation. Resource selection displays configured names and preserves unknown bindings for explicit removal. Chat shows message turns; detailed execution events live under session records. Saving automatically validates and uses optimistic revision checks. Import/export/rollback live in Settings. Configuration remains a shared draft; the save bar explicitly describes cross-page unsaved changes.

The IM runtime now uses an adapter registry and PlatformManager, following AstrBotX’s instance-lifecycle separation. Only changed or removed platform configurations rebuild adapters. Adapter-reported connection, error, recovery and shutdown states are independent of receiving a user message; stale instance callbacks cannot change a replacement’s state.

The route display represents one fixed flow. Input and end are non-editable endpoints; the eight processing nodes expose typed parameter editors. There is no node insertion, removal or edge editing. Simulation traces use the core node IDs, and display pass/reject state separately from the selected node. The configuration draft survives tab changes. Validation and publication use the server revision; a conflict preserves the draft for export. An explicit discard-and-load action recovers the current server configuration, and rollback creates a new revision.

All new Vue/API code imports runtime schemas and domain types from `typescript/packages/contracts/src/index.ts`. JSON responses are treated as unknown until parsed. DOM inputs are narrowed with `instanceof`, with no `any`, unchecked type assertions or `@ts-ignore` in the new workbench. Management credentials stay in memory. Artifact uploads use authenticated server storage; the UI sends `artifact:` references to the Agent rather than arbitrary remote media URLs.

### Local verification

1. Install the TypeScript runtime dependencies and start its API service (see the TypeScript runtime documentation). The default API port is 8081.
2. In `dashboard`, run `npm ci` and `npm run dev`. Set `VITE_TS_PORT` to override the `/api/ts` proxy port. Legacy APIs continue using `VITE_DASHBOARD_PORT`.
3. Run `npm run build` for strict Vue/TypeScript checking and the production bundle.
4. Run the isolated browser test with `node --import ../typescript/node_modules/tsx/dist/loader.mjs scripts/ts-browser-smoke-test.mjs`. Supply `PLAYWRIGHT_MODULE` and `TEST_BROWSER_EXECUTABLE` when using a preinstalled browser/runtime. This test uses schema-validated fixtures and does not connect to real IM accounts or model services.

The browser test exercises publication, conflict draft preservation, rollback, sender grants, library configuration, memory writes, document import/search, chat events, Weixin QR states and narrow layouts. Before/after desktop and 390 px screenshots are written to `dashboard/.build/ts-ui/`. Fixture tests verify the UI contract; a live server integration run is required separately for backend behavior.

The isolated smoke test also covers stale-revision (409) recovery, history rollback, authenticated image upload and SSE event consumption. The default page intentionally requires a management connection before showing configuration or runtime records; an empty state is not synthesized as a successful connection.

A real local-service test is available as `npm run test:typescript-live`. Set `TS_TEST_TOKEN` and optionally `TS_TEST_BASE` (default `http://127.0.0.1:8081`) and run it only against a dedicated temporary-data server. It validates real configuration publication, flow traces, memory writes, document import/search, image artifact upload and `/help` execution without an external model or IM account. It restores the original configuration as a new revision if no concurrent publication occurred; test memory, documents and execution records remain in the isolated service. Live screenshots are also written under `.build/ts-ui/`.

The execution environment page shows backend availability and the server-reported isolation mode, and queries process output by run ownership. A process termination remains a request until refreshed server state confirms the result. A paused execution exposes separate explicit approve/reject buttons tied to its approval ID; no approval is automatic. Memory records support editing and scope-limited consolidation. Knowledge settings distinguish local hash/keyword retrieval from a configured embedding model instead of describing hash vectors as semantic search.

Session selectors distinguish private and group conversations, including sender grants and memory scopes. New grants default to private chat; unrestricted grants require selecting that option. Agent memory extraction is disabled by default and exposes an explicit destination library when enabled. Resource job status uses shared typed responses. Generated run artifacts are downloaded by an authenticated fetch followed by a temporary Blob URL; management credentials are never put in download URLs. The build runs an AST gate for the new typed workbench to reject explicit `any`, type assertions, non-null escapes and typecheck bypass comments before strict Vue checking.

The build gate itself is TypeScript (`scripts/ts-strict-check.ts`), checked by `tsconfig.tools.json` with strict mode, exact optional properties, checked indexed access and no type-erasure-incompatible syntax. It reuses the workspace Node types, and runs with Node 22.18 or newer. Actual execution node events display their Chinese node names, status and server-measured duration; the ten-node run path uses each node's latest recorded event and marks absent events as unrecorded. The acceptance editor exposes the group-command mention/reply requirement independently of the general group trigger policy.

## Management workflows (2026-10-25)

Conversation management now lives at `/sessions`, separate from `/runs` execution diagnostics. `/chat` restores durable transcripts and selected conversation after reload. `/personas` manages reusable personalities and hierarchical folders; `/files` manages configured work roots. The sidebar retains the Logo-green theme and each page uses focused object editors. `/extensions` adds native extension management and Agent tool choices; `/memories` adds bounded semantic preview/apply and opt-in periodic maintenance. `/settings` adds persistent login sessions, write-only secret references and operational audit logs. Shared configuration drafts and independent persisted management resources use clearly separate save actions.

Browser login uses an expiring HttpOnly session cookie. The initial management token is cleared after successful login; refresh restores valid sessions without browser localStorage. Operator authentication is distinct from IM sender capabilities. The isolated UI preview uses temporary data and no IM accounts; user test data stays on the existing local service.

## Full workflow organization (2026-10-28)

All 18 public routes remain stable. Navigation now follows five groups: workspace, assistant setup, knowledge/tools, runtime diagnostics, and system. Keyword page search, contextual links and saved-configuration setup steps reuse the existing Logo-green surfaces, typography and icons.

Each page states whether it edits the shared runtime draft, independently versioned data, or an immediate operation. The runtime save bar names changed pages, protects discarded edits, supports three-way merging of disjoint changes, and warns about active-run interruption and stale approvals. Independent forms register unsaved edits for object/tab/navigation and unload protection. Runtime configuration operations require those independent edits to be saved or cancelled first. Authentication expiry preserves drafts while prompting for re-login.

Queries preserve navigable state: `section` selects resource/settings tabs, `run` selects execution records, and `conversation` selects chat/history. Execution records link to their source conversation and process view. Data operations use published libraries and Agents; unsaved resource definitions are not presented as immediately usable.

`npm run test:workflows` typechecks and runs the isolated navigation/draft/API logic tests. Its extra-strict application checks skip third-party declaration checking because the installed vue-router experimental declaration conflicts with exact optional properties; the normal Vue production typecheck remains unchanged. Browser smoke source has been updated, but browser/visual verification was not run for this change because the browser tool explicitly blocked page access. Prior screenshots are not evidence for this release. See `docs/dashboard-flow-inventory.md` for all operations, dependencies and implementation limits.


## Selected prototype implementation — 2026-10-28

The production Dashboard now follows the chosen HTML prototype with five primary workspaces: Workbench, Agent, Robots, Resources and Settings. Existing page URLs remain available, with `/resources` and `/tools` added as hubs. Agent and platform workspaces load on demand. The desktop Agent test panel stays visible while the configuration editor scrolls; narrow views stack the panels.

Agent edits and persona bindings publish together with revision checks. The review names changed sections and actual runtime interruption effects. Other objects' unfinished drafts remain intact. Shared personas can be edited in place, with an explicit shared-impact notice and their own save boundary. Draft tests use the real engine in an isolated model-only session; the UI never presents them as tool or IM tests. Capability categories come from actual runtime registration and injection conditions.

Copy uses short sentences, consistent terms and concrete next actions inspired by STE. This is a Chinese UX writing practice, not an English STE conformance claim. Validation identifies fields without echoing submitted values. See `docs/dashboard-interaction-design.md` and `docs/dashboard-redesign-qa.md` for scope, evidence and verification limits.


## Persona and fixed runtime states — 2026-10-29

Persona management is one complete list with editing only. Assignment belongs to Agent. The profile starts with the model, then persona selection and editing; supplemental instructions, compiled prompt preview and basic identity are secondary. Historical persona folder references remain stored but no longer segment the UI.

Sender grants now use a platform, senderIds[] and one fixed state. The role-to-capability table is shared from contracts and read-only. Agent capability ceilings and sender-specific capability/resource arrays are retired; mounted tools, personality filters, directories and execution boundaries remain. Model-tool approval is distinct from direct slash-command authorization. See docs/agents-sdk-tool-permissions.md and docs/persona-fixed-states-qa.md.
