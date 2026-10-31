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
- Record the verified Codex source findings, including the public in-process Rust engine, so the JNI implementation has a pinned baseline.

**Non-Goals:**

- No runtime implementation. No new Kotlin type, no registry, no validator rule, no Dashboard control ships in this change.
- No engine implementation. The `codex` engine is P5; this change records the source-verified dynamic-tool mechanism and the native-library smoke check that must precede activation.
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

A declared capability is an *intent*, not a measured fact. For `CODEX`, P5 must verify the loaded native library exposes the pinned engine contract and complete a dynamic-tool round trip against a mock Responses endpoint. The type descriptor is not trusted as proof.

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

Security consequence: the engine needs the *plaintext* secret, while `GuardedSecret.reveal()` is deliberately internal and every API model opts into `redacted()`. Pass it through one audited, in-memory JNI call. The fork's custom provider supports `requires_openai_auth = false`, `wire_api = "responses"` and an explicit bearer token, so no Codex login is needed. Before enabling the engine, verify that runtime overrides containing the token do not reach rollout files, diagnostics or logs; if they do, add a dedicated ephemeral credential API in the native binding. Never widen `GuardedSecret` or write the secret into `config.toml`.

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
| `ThreadParams.developer_instructions` on `Engine::start_thread` and `Engine::resume_thread` | **Chosen default.** Persona is already merged into `instructions` by `PersonaMemoryInjector` before the runner sees it. Verify replacement semantics against the pinned engine; if it cannot replace instructions without losing history, start a new thread with an explicit continuity diagnostic. Do not prefix every user turn with a copy of the prompt. |
| An `AGENTS.md` written into the Agent's `configDirectory` | Rejected as the primary channel: it snapshots persona to disk, needs rewriting on every persona change, and collides with the instruction-document semantics the harness preset already owns. |
| Prefixing the first turn's text | Rejected: it pollutes conversation history and is not removable. |

Skills converge here: map a priestess skill to a Codex skill input, the same mechanism as `SKILL` injection. For an existing authorized skill, pass its validated absolute `SKILL.md` path directly if the pinned Rust `UserInput` contract accepts it. Otherwise mount only authorized skills beneath the Agent's isolated home. The P5 adapter must verify refresh semantics and expose only skills authorized for the current Agent and caller.

### 9. Engine-native tools keep precedence; the boundary is disclosed, not enforced

An external engine's own tools are not modelled as `FunctionTool`, do not appear in the tool library, and are never suppressed. Where a tool this runtime injects overlaps an engine-native capability — `web_search`, command execution, file editing — the model may reach either, and the engine-native one is not covered by `toolPolicy`, `allowedRiskLevels` or `minimumPermissionGroups`.

Because suppression is rejected, two things become mandatory rather than optional:

- **Name collision is a validation error.** An injected tool whose name collides with an engine-native tool is unreachable configuration; activation rejects it with both names.
- **Overlap is disclosed.** For an Agent bound to an external engine, the configuration surface reports which injected capabilities overlap engine-native ones, and operator documentation states that permission narrowing does not apply to the native ones. This is the deliberate cost the superseded proposal recorded; stating it in the model keeps it from being rediscovered as a bug.

### 10. Capability declarations are server-reported

Every roster and matrix — Agent types, their protocol and injection capabilities, each connection's declared protocol, each platform's available actions and supported dispatcher shape — is reported by the server. The Dashboard filters and warns from that data and never duplicates a matrix in the frontend, so a new type or protocol cannot leave the two sides inconsistent.

### 11. JNI calls the reference fork's Rust `Engine` in process

At `codex_for_astrbot` revision `413f16a571a7a24557e70250c0284c5bebdd8c3f`, `codex-rs/astrbot-py` publishes `engine` as a Rust module and builds as both `rlib` and `cdylib`; the Python feature is optional. Its `Engine` already implements thread start/resume, turn submission, event polling, dynamic-tool responses, approval decisions, interruption and shutdown. P5 adds a small JNI `cdylib` around that public Rust module. PriestessBot remains the only server and starts no app-server process.

The Kotlin boundary is `CodexNativeSession`, separate from `CodexExternalAgentRunner`. JNI exchanges bounded JSON payloads with Rust, mirroring the existing Python wrapper rather than mirroring every Codex protocol type in Kotlin. The native library owns a Tokio runtime with the fork's 16 MiB worker stack requirement. **Never call `Runtime::block_on` for Codex core operations on a JVM executor thread**: a real resume smoke crashed the JVM at its approximately 2 MiB stack guard. The bridge now dispatches core futures onto its 16 MiB Rust workers and waits for their results from JNI. Every exported native method catches Rust panics, reports a bounded error without echoing secrets, and uses a non-reused handle registry so `close()` cannot free an engine while another native call uses it. A fatal native fault can still terminate the JVM; CODEX is off by default and only locally opt-in with an explicit path and SHA-256 while NAS/production gates remain.

Use one engine generation per active CODEX Agent home. Set `EngineOptions.codex_home` to `configDirectory/codex-home`, set `ThreadParams.cwd` to the Agent's `tempDirectory`, and use `no_environment = true` unless an explicit, separately reviewed native execution policy exists. With no `codex_self_exe`, the fork uses `EnvironmentManager::without_environments`; PriestessBot supplies tools through its own permission-aware dispatcher. Code mode may still require a helper process if enabled, so it is disabled for the first integration.

Configure a custom provider with `wire_api = "responses"`, `requires_openai_auth = false`, the selected base URL, and an explicit bearer token. Do not call `login_api_key`: it persists an auth record in `CODEX_HOME`. Pass the resolved secret only through the audited native boundary. The fork currently accepts `experimental_bearer_token` in the provider config, but P5 must prove that runtime overrides do not serialize this value into rollout files or logs; otherwise extend the fork with an ephemeral provider-token API before allowing real credentials. A provider endpoint, protocol or credential change retires the old engine generation after bounded draining; later turns use a new generation.

Persist a unique mapping keyed by `(workspaceId, agentId, platformId, sessionId)` to the Codex thread ID. Serialize turns for one mapping while independent conversations run concurrently. Resume the mapped thread instead of replaying PriestessBot's transcript. On each accepted turn, pass a freshly filtered `TurnRequest.dynamic_tools` set based on the matched route, enabled Agent tools and caller permission. The fork applies this through `ThreadSettingsOverrides.dynamic_tools`, so the declarations can be narrowed per turn without rotating the thread. The host callback still rechecks the live turn's policy; declarations alone are not authorization.

Give each loaded thread one durable event pump that owns `Engine::next_event` until termination and queues events to Kotlin. Do not cancel a pending poll: the fork's Python wrapper warns that an event can otherwise be consumed and dropped. Tool and approval responses use separate JNI calls while the event pump runs. Register immutable caller authorization by `turnId`; reject unknown, stale, duplicate or cross-Agent calls. On cancellation call `Engine::interrupt`; on shutdown stop assigning work, interrupt active turns, drain with a deadline, then call `shutdown_thread` and `shutdown`. Never replay a turn that may already have produced side effects.

The macOS arm64 native bridge has built and passed a mock Responses smoke: an isolated no-login engine completed a turn, answered a dynamic tool call through `ToolCase`, completed a second turn after the advertised tool set was narrowed to empty, and resumed a persisted rollout after an engine restart. The Kotlin supervisor persists conversation-to-rollout mapping, serializes one conversation and rotates the engine generation when its credential changes. A fake token was absent from the scanned Codex home while live and after shutdown. An explicit local experiment can register the runner after path/OS/CPU/SHA-256 checks; the NAS Linux build, concurrent-close/fault behavior, skill delivery and log-side credential audit remain before production activation.

## Capability matrices

**Agent types (target state):**

| Type | Engine | Internal preset | LLM protocols | Injection modes | Retains `instructions` / persona / skills |
|---|---|---|---|---|---|
| `NORMAL` | `INTERNAL` | `NORMAL` | all adaptable | `NONE`, `SINGLE`, `MULTI`, `SKILL` | yes |
| `DEEPSEEK_HARNESS` | `INTERNAL` | `HARNESS` | all adaptable | `NONE`, `SINGLE`, `MULTI`, `SKILL` | yes, plus the instruction document |
| `CODEX` | `CODEX` | — | `OPENAI_RESPONSES` only | `NONE`, `SKILL` guaranteed; `SINGLE` / `MULTI` conditional on dynamic tools | yes, via the P5 delivery channel |

The `CODEX` row is conditional on the pinned JNI bridge's dynamic-tool smoke. `SINGLE` / `MULTI` require the native tool-call path; `SKILL` and `NONE` do not. The fork's public engine exposes the relevant methods, but the packaged native artifact and selected model still need an end-to-end test.

**Field validity per type** must be expressed by validation, not by silence: budgets and compression settings are inert for `CODEX`, and the type descriptor is where that is decided.

## Preserved Evidence: earlier app-server exploration (superseded by Decision 11)

**Why not `codex exec`.** `exec` — and the TypeScript SDK, which wraps it — cannot register PriestessBot's dynamic tools or provide the required per-call permission callbacks. The historical app-server investigation below established a capable process protocol, but the reference fork's public in-process engine now provides a shorter integration path.

**Historical app-server surface, checked against the referenced `codex_for_astrbot` source revision above. It is not the selected P5 transport.**

```
codex app-server --help          # --listen stdio:// (default) | unix:// | ws://IP:PORT
codex app-server generate-json-schema --experimental --out <dir>
```

The relevant v2 contract contains client requests, notifications and server-initiated requests, including:

```
DynamicToolSpec =
  { type:"function", name, description, inputSchema, deferLoading? }
  | { type:"namespace", name, description, tools:[{type:"function", …}] }
ThreadStartParams { …, cwd, developerInstructions?, dynamicTools? }

server request  item/tool/call   → { threadId, turnId, callId, tool, namespace?, arguments }
host response   { success, contentItems: inputText | inputImage | inputAudio }

server requests item/commandExecution/requestApproval
                item/fileChange/requestApproval
                item/permissions/requestApproval
                applyPatchApproval, execCommandApproval
```

The function/namespace union is important: a function carries a JSON Schema `inputSchema`; a namespace has a name, description and typed function members. `item/tool/call` is a server-initiated JSON-RPC request that arrives while a turn is active, not a notification polled after `turn/start` returns. Its `DynamicToolCallResponse` includes `success` and `contentItems` (text, image or audio); the test suite also covers failure output and content-item round-tripping. Dynamic tools require the experimental API capability. The official docs also confirm that declarations persist with a thread; route-specific visibility must be reconciled before each turn.

**Historical evidence.** At the referenced source revision, `codex-rs/app-server/tests/suite/v2/dynamic_tools.rs` exercises dynamic tool calls. The chosen JNI path instead needs its own engine-level mock Responses smoke and native packaging test.

**Transport decision.** Kotlin calls a JNI boundary and consumes events from a dedicated native pump. Keep the rest of Agent, pipeline and provider code independent of JNI-specific DTOs.

**Operational constraints.** Bundle a pinned native library for each target OS and architecture. Verify library loading, Rust runtime shutdown and mock endpoint behavior on macOS and NAS Linux. The Agent home and thread working directory remain separate so persistent Codex state does not share the scratch tree.

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
- **JNI shares the JVM failure domain.** A native abort can terminate PriestessBot; the CODEX Agent type remains opt-in until the pinned library, caller-approval boundary and lifecycle smoke pass.
- **`SINGLE` weakens validation and permission granularity.** Accepted, with the dispatcher owning argument validation and the policy key extended to address actions.
- **Engine-native actions are outside `toolPolicy`.** Accepted and disclosed; not enforced, per Decision 9.
- **Persona and skills for `CODEX` depend on the pinned engine's thread instruction and skill-loading behavior.** P5 must confirm replacement and skill refresh semantics before promising live updates.
- **A declared protocol may not match the endpoint.** Validation cannot settle it without a billable probe; the declared protocol is reported and the limitation documented.
- **Two capability axes can drift from reality** (a type claims a mode the engine cannot serve; the frontend shows a mode the server rejects). Mitigated by fail-fast engine validation and by server-reported rosters.

## Resolved During Review

| Question | Decision |
|---|---|
| Does the `preset → type` rename stay inside schema v3? | **Stays in v3 as an in-place rename**, with no schema version bump, consistent with v3's stated one-way development migration and with how the earlier v3 changes were applied. |
| When do the implemented prerequisites get archived? | **Archived 2026-09-23** (`rebuild-agent-im-configuration`, `add-deepseek-harness-agent-type`), with the outstanding NAS deployment verification recorded in `tasks.md` as an operational item rather than a blocker. |
| Is `add-openai-responses-provider` kept as a separate change? | **No.** P1 absorbs it and removes it when P1 is created; its Responses mapping and fidelity boundary are carried in `tasks.md` 3.6. |
| Which field carries external-Agent instructions? | **`ThreadParams.developer_instructions` on start and resume.** Confirm replacement semantics against the pinned engine; do not repeat the text in every user turn by default. |
| Where are Codex skills discovered? | **Under the Agent's isolated Codex home**, with only Agent-authorized skills exposed. P5 verifies how the pinned engine refreshes edited skills. |
| What happens to unsupported route injection modes and native-tool overlap? | **Reject unsupported modes at activation; show capability overlap with a warning.** Decisions 2 and 9 define both behaviors. |

Also confirmed during review and recorded as decisions above: the Agent type replaces the preset selection (D1); capability is declared as sets (D2); the provider gains a protocol axis (D3); injection is route-scoped (D5); the tool library supplies defaults with a per-Agent override (D7); `CODEX` retains instructions, persona and skills (D8); engine-native tools keep precedence and are disclosed rather than suppressed (D9).

## Open Questions

- Which of an Agent's remaining fields are retained, inert or forbidden for a `CODEX` Agent: `execution.maxSteps`, `context.compression`, `memory`, `mcpServerIds`? Instructions, persona and skills are already decided as retained.
- Does the `SINGLE` dispatcher's policy key become `tool#action`, or an explicit `{tool, action}` pair?
