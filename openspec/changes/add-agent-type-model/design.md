## Context

An Agent is described today by fields that each answer a different part of "what is this Agent?" without any of them declaring what it *can* do:

```kotlin
// config/model/ApplicationConfigurationDocument.kt:66 — the operator-facing shape
data class AgentProfileDocument(
    val preset: AgentPreset = AgentPreset.NORMAL,   // behaviour selector
    val llm: AgentLlmDocument,                       // providerRef + model
    ...
)

// agent/preset/AgentPresetDefinition.kt — behaviour as data
enum class AgentRunnerKind { REACT, HARNESS }
data class AgentPresetDefinition(runner, sections, parallelToolCalls, defaults, ...)
```

Three further facts constrain any redesign:

- **Protocol is welded to vendor.** `llms[].type` selects the adapter (`provider/BuiltinProviders.kt`), and `LLMKind` (`provider/Provider.kt`) enumerates vendors and protocols in one enum. `OpenAIProvider` builds `/chat/completions` only. No connection can declare that it speaks the Responses API, which Codex requires.
- **Platform tools are unconditional and globally advertised.** `PreProcessStage.kt:280` assembles `scopedTools = (snapshot.runtimeTools + ctx.event.platform.platformTools())`, and `PlatformRegistry.kt:40` folds every registered platform's `toolFactory()` into one descriptor union, so NapCat's group-file tools are configurable and visible even on Telegram-only deployments.
- **Tool policy has no settings.** `ToolPolicyDocument` (`config/model/WorkspaceConfigDocument.kt:81`) is `allow / deny / allowedRiskLevels / enabled / minimumPermissionGroups`, and `ConfigurableToolDescriptor` (`config/resolve/ToolPolicyResolver.kt:6`) is `(id, riskLevel, defaultEnabled)`. `WebSearchTool` therefore hardcodes its SearXNG endpoints.

Two earlier proposals were written against a narrower frame and are superseded by this one: `add-agent-runtime-scope` (per-Agent `runtimeScope` + `engineId`, an `ExternalAgentRunner` contract, and an engine-id registry) and `add-codex-agent-type` (an app-server engine built on that scope). Their reasoning that survives is recorded under Decisions 2, 3, 5 and Preserved Evidence; their scope-selection abstraction does not, because this change makes the Agent *type* — not a separate scope field — the thing that declares capability.

Pipeline ordering is not a constraint on the injection decision: `ImRouteStage` (order 0) writes `ctx.imRoute` and `ctx.permissionGroup` (`pipeline/stages/ImRouteStage.kt:34,40`) long before `PreProcessStage` (order 7) assembles the tool surface, so the route that selected the Agent is available at the point where injection is decided.

## Goals / Non-Goals

**Goals:**

- Make "what an Agent can do" a declared, validated property rather than an emergent consequence of which fields happen to be set.
- Let one Agent be driven by an external engine without giving that engine's requirements to engines that do not have them.
- Separate protocol from vendor so a connection can state what it speaks and an Agent type can restrict what it accepts.
- Make tool injection an explicit, route-scoped choice with a small, fixed vocabulary of shapes.
- Give tools a place to hold configuration, with secrets referenced rather than stored.
- Record the app-server findings that a later change must consume, so nothing verified is lost when the earlier proposals are removed.

**Non-Goals:**

- No runtime implementation. No new Kotlin type, no registry, no validator rule, no Dashboard control ships in this change.
- No engine implementation. The `codex` engine is P5; this change records what is known about it and the one mechanism that must be spiked.
- No changes to `agent-loop`, `pipeline` or `platform-abstraction` behaviour. Those deltas belong to P2 and P4.
- No new injection shape beyond `NONE` / `SINGLE` / `MULTI` / `SKILL`.
- No engine-native tool suppression, no per-agent credential override, no IM-side interactive approval UI.
- No rewrite of the runtime's own tool semantics: `ToolExecutor`, `ToolPolicy` and risk levels keep their meaning for tools this runtime owns.

## Decisions

### 1. `type` replaces `preset` on the configuration surface; the descriptor keeps two layers internally

`agents[].type` is the single operator-facing selector and `preset` disappears from the configuration model. The registry resolves a type to a descriptor that still separates *who runs the loop* from *how an internal loop runs*:

```kotlin
enum class AgentType { NORMAL, DEEPSEEK_HARNESS, CODEX }

data class AgentTypeDefinition(
    val type: AgentType,
    val displayName: String,
    val engine: AgentEngine,                 // INTERNAL | CODEX
    val internalPreset: AgentPreset?,        // non-null iff engine == INTERNAL
    val llmProtocols: Set<WireProtocol>,
    val toolInjectionModes: Set<ToolInjectionMode>,
    val defaults: AgentTypeDefaults,         // maxSteps / maxContextTokens / maxRounds
)
```

Rationale: a flat enum whose members mean "internal loop variant" for two values and "external engine" for a third would force the internal-only fields (`sections`, `identityTemplate`, `instructionsDocument`, parallel scheduling, compression policy) to be supplied for an engine that ignores all of them, and would make every future internal variant a new "Agent type". Keeping the two layers inside the descriptor preserves one dropdown for operators and two honest concepts in the model.

Alternative rejected: keep `preset` and add `engineId` beside it (the superseded `add-agent-runtime-scope` shape). It leaves the operator with two fields that must agree, and it cannot express "this type accepts only Responses" because a preset has no opinion about providers.

Consequence: the `preset → type` rename touches `AgentProfileDocument`, the v3 projection, `AgentDefinitionDocument`, `EffectiveAgent`, `Agent`, `AgentPresetRegistry`, `configV3.ts`, `AgentEditor.vue`, `config.example.json`, and the existing preset tests. Existing values map one-to-one (`NORMAL → NORMAL`, `DEEPSEEK_HARNESS → DEEPSEEK_HARNESS`), so no behaviour changes and no dual-write period is needed. The rename stays inside schema v3 as an in-place migration and does not warrant a schema version bump, consistent with v3's stated one-way development migration.

### 2. Capability is a set, never a boolean

A type declares `llmProtocols: Set<WireProtocol>` and `toolInjectionModes: Set<ToolInjectionMode>`. A type that cannot accept injection declares an empty set, and a route that requests an injection mode outside it fails validation — it is never silently dropped.

The registry's completeness check upgrades from `AgentPresetRegistry`'s "every preset has a definition" to "every type declares a non-empty protocol set" (an injection-mode set may legitimately be empty), so capability cannot be forgotten when a type is added.

Precedent: `ProviderMetadata` already carries `supportToolCalling / supportVision / supportStreaming` as static capability bits beside a registry (`provider/Provider.kt`), the same shape used by `PlatformRegistry` and `PluginProviderRegistration`.

A declared capability is an *intent*, not a measured fact. For `CODEX` the tool-injection intent depends on the installed binary: dynamic tools require `initialize.capabilities.experimentalApi = true` and their wire shape changed during the 0.15x series. The engine therefore validates the intent against the actual binary at startup and fails fast outside a supported version range; the type descriptor is not trusted as proof.

### 3. A provider connection has a vendor family and a wire protocol

`llms[].type` stays as the vendor/adapter family and supplies the default, endpoint semantics, and auth style. A new `llms[].protocol` states what the connection actually speaks:

| Protocol | Notes |
|---|---|
| `OPENAI_CHAT_COMPLETIONS` | today's `OpenAIProvider` behaviour; default for `openai` |
| `OPENAI_RESPONSES` | required by Codex; not interchangeable with the above |
| `ANTHROPIC_MESSAGES` | a distinct protocol, not an OpenAI wire mode |
| `GEMINI_GENERATE_CONTENT` | distinct |
| `OLLAMA_*` | ollama-native |

Rationale for separate axes: the superseded proposals expressed this as `settings.wireApi ∈ {chat, responses}` on the OpenAI adapter. That is a two-valued special case of a general axis, it cannot express Anthropic's Messages API (which is a different protocol, not a different mode of one), and it leaves the vendor type as the only place protocol can be inferred from.

A declared protocol is not a verified one. A connection can be configured for `OPENAI_RESPONSES` against an endpoint that only serves `/chat/completions`, and connectivity testing cannot settle it: the existing `test()` path exercises `/models`, and probing `/responses` would send a billable model request. Validation therefore rejects *unknown* protocols and the operational surface reports the declared protocol; it does not claim the endpoint implements it.

### 4. A wire protocol has two consumers, and the secret crosses the boundary exactly once

- An **internal** Agent consumes a connection through `ChatProvider.textChat(LLMRequest)`; the protocol is adapted into the existing request/response DTOs.
- An **external** engine consumes only `endpoint + protocol + secret` and speaks the protocol itself.

This asymmetry is why the protocol belongs on the connection rather than inside an adapter: one connection must be usable both as a `ChatProvider` source and as a raw engine endpoint, and the two paths must agree on what it speaks.

Security consequence: the engine needs the *plaintext* secret in its child process environment, while `GuardedSecret.reveal()` (`config/model/EffectiveConfigModels.kt:108`) is deliberately internal and every API model opts into `redacted()`. The engine must receive it through one narrow, audited resolution path at process spawn — never by widening `GuardedSecret`, never by writing it into engine configuration files or logs. The existing proposal text "no secret is ever written to Codex's config file or logged" is adopted as a rule of the model, not of one engine.

### 5. Tool injection is decided on the IM route, not on the Agent

Injection is configured on `ImRouteActionDocument` — the route that selected the Agent — because the IM message is the origin of the whole run: with no incoming platform message there is no platform action to inject, and a command route that never reaches the Agent has nothing to inject into.

The decision point is already correct in the pipeline: `ImRouteStage` runs first and records both the matched route and the resolved permission group, and `PreProcessStage` assembles the tool surface afterwards. No new stage or ordering is required.

Consequences:

- Injection shape is a **per-request** decision and cannot be cached on the Agent snapshot.
- Validation becomes a chain: `route.action.injection.mode ∈ route.targetAgent.type.toolInjectionModes`, checked at activation with both ids named.
- The Dashboard places the control in the route editor and, for discoverability, shows which actions the route's IM connection can supply. The Agent editor does not show it.
- Routes whose action is `COMMAND` carry no injection configuration.

### 6. `SINGLE` is one dispatcher per IM platform, with the platform owning its action table

In `SINGLE` mode a platform advertises exactly one tool; the platform owns the mapping from an action name to its implementation. This is a property of the platform contribution contract, not of the Agent.

Two costs are accepted explicitly rather than discovered later:

- **Argument validation weakens.** `ToolExecutor.validateArguments` checks each tool's `parameters.required`. A dispatcher has one generic argument object, so per-action required-argument validation moves inside the dispatcher, which must return a structured validation error rather than throw.
- **Permission granularity collapses.** `minimumPermissionGroups` is keyed by tool name. Under one dispatcher, "reply to the message" and "delete a group file" land in the same permission class. The policy key must therefore be able to address a dispatcher action (`tool` or `tool#action`) so a route can still narrow one action without narrowing the platform.

`MULTI` mode remains the current shape, one tool per capability. `SKILL` mode surfaces the platform's capabilities as a skill document loaded on demand, which reuses the existing `UseSkillTool` + `PipelineSkillState` mechanism (`tool/builtin/SkillTools.kt`). `NONE` injects nothing.

### 7. The tool library supplies defaults and an Agent may override them

A library entry is `{ id, enabled, settings: Map<String, String>, credentials: Map<String, CredentialReference> }`. An Agent's tool section may override `settings` per key and narrow `enabled` / `minimumPermissionGroups`; the merge is field-wise with the Agent winning, and the editor offers an explicit "restore library default" action so a default is never dead configuration.

Credentials stay library-scoped in this iteration: an Agent may override a *setting* but not a *credential*, because per-agent credential resolution multiplies the secret-handling and redaction surface. A later change may lift this, and it must then reuse `CredentialReference` rather than introduce a second secret shape.

Merge happens at compile time into the immutable per-Agent snapshot, preserving the existing "next message sees the change" hot-reload semantics.

### 8. `CODEX` retains instructions, persona and skills through an explicit delivery channel

Choosing to keep them means the runtime must deliver them, because Codex does not read `AgentContext`. Available channels:

| Channel | Assessment |
|---|---|
| App-server developer/base-instructions field on `thread/start` / `turn/start` | **Chosen.** Persona is already merged into `instructions` by `PersonaMemoryInjector` before the runner sees it, so it travels with no extra machinery. Exact field name is pinned at P5 against the supported CLI version. |
| An `AGENTS.md` written into the Agent's `configDirectory` | Rejected as the primary channel: it snapshots persona to disk, needs rewriting on every persona change, and collides with the instruction-document semantics the harness preset already owns. |
| Prefixing the first turn's text | Rejected: it pollutes conversation history and is not removable. |

Skills converge here: the natural way to keep a priestess skill available to Codex is to map it to a Codex skill (`$name` plus a `skill` input item on `turn/start`), which is the same mechanism as the `SKILL` injection mode. The runtime therefore needs a defined skill-discovery root for the engine (a per-Agent `CODEX_HOME` or an extra skills root) — a P5 decision that P4's `SKILL` mode depends on.

### 9. Engine-native tools keep precedence; the boundary is disclosed, not enforced

An external engine's own tools are not modelled as `FunctionTool`, do not appear in the tool library, and are never suppressed. Where a tool this runtime injects overlaps an engine-native capability — `web_search`, command execution, file editing — the model may reach either, and the engine-native one is not covered by `toolPolicy`, `allowedRiskLevels` or `minimumPermissionGroups`.

Because suppression is rejected, two things become mandatory rather than optional:

- **Name collision is a validation error.** An injected tool whose name collides with an engine-native tool is unreachable configuration; activation rejects it with both names.
- **Overlap is disclosed.** For an Agent bound to an external engine, the configuration surface reports which injected capabilities overlap engine-native ones, and operator documentation states that permission narrowing does not apply to the native ones. This is the deliberate cost the superseded proposal recorded; stating it in the model keeps it from being rediscovered as a bug.

### 10. Capability declarations are server-reported

Every roster and matrix — Agent types, their protocol and injection capabilities, each connection's declared protocol, each platform's available actions and supported dispatcher shape — is reported by the server. The Dashboard filters and warns from that data and never duplicates a matrix in the frontend, so a new type or protocol cannot leave the two sides inconsistent.

## Capability matrices

**Agent types (target state):**

| Type | Engine | Internal preset | LLM protocols | Injection modes | Retains `instructions` / persona / skills |
|---|---|---|---|---|---|
| `NORMAL` | `INTERNAL` | `NORMAL` | all adaptable | `NONE`, `SINGLE`, `MULTI`, `SKILL` | yes |
| `DEEPSEEK_HARNESS` | `INTERNAL` | `HARNESS` | all adaptable | `NONE`, `SINGLE`, `MULTI`, `SKILL` | yes, plus the instruction document |
| `CODEX` | `CODEX` | — | `OPENAI_RESPONSES` only | `NONE`, `SKILL` guaranteed; `SINGLE` / `MULTI` conditional on dynamic tools | yes, via the P5 delivery channel |

The `CODEX` row is the one the spike must settle. `SINGLE` / `MULTI` depend on dynamic tools, which are experimental and unverified end to end; `SKILL` and `NONE` do not.

**Field validity per type** must be expressed by validation, not by silence: budgets and compression settings are inert for `CODEX`, and the type descriptor is where that is decided.

## Preserved Evidence: the Codex engine (from the removed `add-codex-agent-type`)

**Why app-server rather than `codex exec`.** `exec` — and the TypeScript SDK, which is a thin wrapper that spawns `codex exec --experimental-json` and exchanges JSONL — cannot satisfy three requirements: this runtime's tools cannot reach the model, this runtime's permission model cannot gate the engine's actions, and the engine's progress cannot be observed or interrupted with structure. Verified independently: the SDK's `ThreadOptions` exposes only fixed values (`sandboxMode`, `approvalPolicy`, `workingDirectory`, `skipGitRepoCheck`, `outputSchema`, …) with no registration or callback surface, and under `exec` an MCP tool call is auto-cancelled because the approval prompt reads EOF from a closed stdin — the only workaround also disables the read-only sandbox (openai/codex#24135).

**App-server surface, verified against `codex-cli 0.154.0-alpha.6.2`; npm `@openai/codex` was at 0.155.1 at analysis time.**

```
codex app-server --help          # --listen stdio:// (default) | unix:// | ws://IP:PORT
codex app-server generate-json-schema --experimental --out <dir>
```

The generated bundle contained 159 client-request methods, 81 server notifications and 11 server-initiated requests, including:

```
DynamicToolSpec   { name, description, inputSchema }        # experimental
ThreadStartParams { …, dynamicTools: [DynamicToolSpec] }

server request  item/tool/call   → { threadId, turnId, callId, tool, namespace?, arguments }
host response   { success, contentItems: [{type:"inputText", text} | {type:"inputImage", imageUrl}] }

server requests item/commandExecution/requestApproval
                item/fileChange/requestApproval
                item/permissions/requestApproval
                applyPatchApproval, execCommandApproval
```

Dynamic tools and `item/tool/call` are gated behind `initialize.params.capabilities.experimentalApi = true`, and the identifiers were realigned with the Responses API after the version originally probed (openai/codex#12732, #20724, #27365). A verified mock-Responses turn captured Codex's own request: a ~17 KB `instructions` block plus its native tool list (`exec_command`, `write_stdin`, `request_user_input`, `view_image`, `multi_agent_v1`, `get_goal`, `create_goal`, `update_goal`, `web_search`) — which is the basis for Decision 9.

**One mechanism is unverified.** Dynamic tools appear in the schema and the protocol documents them, but no end-to-end invocation was observed, and the sibling implementation in the DeepSeek Harness checkout (`packages/subagent/subagent-codex`, a working app-server client over 0.153.4: `initialize` → `thread/start` → `turn/start` → notifications → approvals → `turn/interrupt`) does not use them at all. P5 must begin with a spike that proves declaration, invocation and response round-trip before it is scoped as implementable.

**Transport options for Kotlin.** A third-party Kotlin app-server client exists (CoKit, `io.github.vupoint.cokit`) and models approvals as typed handlers, but at analysis time it was `0.0.x`, tracked `codex-cli 0.146.0`, listed dynamic-tool-call handling as unimplemented roadmap, had no GitHub release, and was not resolvable from Maven Central. It is therefore not a consumable dependency today; the transport is either hand-written or CoKit is vendored, and either way it stays behind a thin adapter.

**Operational constraints.** The engine binary is a new runtime dependency absent from the current image (a Node runtime is needed only if the TypeScript SDK is used; the native binary speaks both `exec` and `app-server` directly, and platform payloads exist for linux x64/arm64 and macOS). Codex expects a git repository by default while the Agent configuration directory generally is not one. The app-server protocol is experimental and has already made breaking changes, so a supported version range with a fail-fast message is required.

## Preserved Decisions: runtime scope (from the removed `add-agent-runtime-scope`)

These decisions were reached in the superseded proposal and survive unchanged. They constrain P2 and P5 rather than being reopened.

- **An external Agent still references a provider connection.** `llm.providerRef` stays required for both engines. Giving an external engine its own endpoint and credential fields would duplicate the provider model, duplicate credential handling, and make rotation and redaction inconsistent. What changes is only who consumes the connection: an internal Agent builds a `ChatProvider`, an external one hands the resolved connection to the engine.
- **The external contract is a turn, not a step machine.** `ExternalAgentRunner` receives the `AgentContext` and the Agent's admissible tools, runs a whole turn, and returns the existing `AgentResponse`. It receives no `ChatProvider`, no `ContextManager`, and no scheduler: the engine owns its own state machine and compaction, and modelling that as `step()` would make this runtime responsible for a lifecycle it cannot observe or resume correctly.
- **The engine receives the already-filtered tool surface.** It gets the same admissible set the internal runner would compute — filtered by `effectiveToolIds`, `deniedToolIds`, `allowedRiskLevels`, `strictPermissionToolFiltering` and the caller's permission group — so risk and permission behaviour cannot diverge between engines. The existing filtering is reused, not reimplemented.
- **No reverse mapping.** The engine's built-in tools are never imported into `FunctionTool` / `ToolSchema`, never appear in tool listing or the tool library, and are configured, if at all, through the engine's own settings. The declaration sent to the engine is produced by the engine module in the engine's own format — not by `ToolSchema.toOpenAIFormat()`, which emits the chat-completions `{type:"function", function:{…}}` wrapper.
- **Registration precedes the first message.** The engine registry is populated at composition time; a missing registration must fail activation, not a user's message, consistent with how an unknown type is handled.
- **A trace records an external run without fabricating a model exchange.** The execution trace is identified with the engine and model, and no synthetic `llmRequest` / `llmResponse` pair is emitted for a turn this runtime did not drive.

## Migration Plan

1. P0 archives `rebuild-agent-im-configuration` and `add-deepseek-harness-agent-type`; nothing else can be sequenced before it.
2. P1 introduces the protocol axis with defaults per vendor type, so every existing connection keeps its current behaviour with no configuration change.
3. P2 renames `preset → type` with a one-to-one value mapping and defaults every existing Agent to the type of the same name; existing types' budgets move onto the type descriptor unchanged.
4. P3 introduces the library and normalizes existing `toolPolicy` switches into library entries with empty settings, preserving today's enabled sets.
5. P4 defaults every existing route to the current injection shape, so deployments observe no change until a route opts into another mode.
6. P5 lands last and is the only step that adds a runtime dependency.
7. Rollback for P1–P4 is configuration-level: remove the new fields and the previous defaults apply. P5 rolls back by removing the engine binding; persisted configuration gains no required field before it.

## Risks / Trade-offs

- **The umbrella over-promises.** This change ships no behaviour; its value is the model and the split. Mitigated by keeping P1–P5 independently valuable and by refusing to fold implementation into it.
- **`CODEX` injection capability is conditional on an experimental mechanism.** If the P5 spike fails, `SINGLE` / `MULTI` are unavailable on Codex and only `SKILL` / `NONE` remain. The matrix states this up front rather than assuming the full set.
- **`SINGLE` weakens validation and permission granularity.** Accepted, with the dispatcher owning argument validation and the policy key extended to address actions.
- **Engine-native actions are outside `toolPolicy`.** Accepted and disclosed; not enforced, per Decision 9.
- **Persona and skills for `CODEX` depend on a channel whose exact field name is not pinned.** Deferred to P5 with the channel chosen; the alternative channels are recorded so the decision is not reopened from scratch.
- **A declared protocol may not match the endpoint.** Validation cannot settle it without a billable probe; the declared protocol is reported and the limitation documented.
- **Two capability axes can drift from reality** (a type claims a mode the engine cannot serve; the frontend shows a mode the server rejects). Mitigated by fail-fast engine validation and by server-reported rosters.

## Resolved During Review

| Question | Decision |
|---|---|
| Does the `preset → type` rename stay inside schema v3? | **Stays in v3 as an in-place rename**, with no schema version bump, consistent with v3's stated one-way development migration and with how the earlier v3 changes were applied. |
| When do the implemented prerequisites get archived? | **Archived 2026-09-23** (`rebuild-agent-im-configuration`, `add-deepseek-harness-agent-type`), with the outstanding NAS deployment verification recorded in `tasks.md` as an operational item rather than a blocker. |
| Is `add-openai-responses-provider` kept as a separate change? | **No.** P1 absorbs it and removes it when P1 is created; its Responses mapping and fidelity boundary are carried in `tasks.md` 3.6. |

Also confirmed during review and recorded as decisions above: the Agent type replaces the preset selection (D1); capability is declared as sets (D2); the provider gains a protocol axis (D3); injection is route-scoped (D5); the tool library supplies defaults with a per-Agent override (D7); `CODEX` retains instructions, persona and skills (D8); engine-native tools keep precedence and are disclosed rather than suppressed (D9).

## Open Questions

- Which of an Agent's remaining fields are retained, inert or forbidden for a `CODEX` Agent: `execution.maxSteps`, `context.compression`, `memory`, `mcpServerIds`? Instructions, persona and skills are already decided as retained.
- Does the `SINGLE` dispatcher's policy key become `tool#action`, or an explicit `{tool, action}` pair?
- Should a route be allowed to set an injection mode for an Agent type that supports none, as an inert default, or is that always a validation error?
- Which app-server field carries developer instructions for the supported CLI version, and is `baseInstructions` needed in addition?
- How is the skill root exposed to the engine — a per-Agent `CODEX_HOME`, an extra skills root, or a generated skill directory?
- For a `CODEX` Agent, should the Dashboard hide injected tools whose capability overlaps an engine-native tool, or show them with an overlap warning?
