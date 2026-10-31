This change ships no runtime code. Its tasks are the roadmap actions that turn the model into implementable changes, plus the verification that the model itself is complete and consistent.

## 1. Supersede the earlier proposals

- [x] 1.1 Confirm every surviving finding of `add-agent-runtime-scope` and `add-codex-agent-type` is recorded in `design.md` (Decisions 2, 3, 5 and Preserved Evidence), including app-server protocol facts, `exec`/SDK rejection, the transport boundary, upstream `dynamicTools` integration evidence, and the remaining packaged-CLI compatibility check.
- [x] 1.2 Remove `openspec/changes/add-agent-runtime-scope/` and `openspec/changes/add-codex-agent-type/` once 1.1 is confirmed, so no implementer can pick up an abstraction this change replaces.
- [ ] 1.3 Note in each P1–P5 change that it supersedes the corresponding part of the removed proposals. P1, P2, P4 and P5 are recorded; P3 remains.
- [x] 1.4 Confirm `add-openai-responses-provider` is superseded by P1 and remove it when P1 is created, carrying forward its fidelity-boundary table (reasoning items and `encrypted_content` do not round-trip; hosted Responses tools are dropped).

## 2. P0 — archive the implemented prerequisites

- [x] 2.1 Archive `add-deepseek-harness-agent-type` (43/43 tasks done) to `openspec/changes/archive/2026-09-23-add-deepseek-harness-agent-type/`, syncing its delta specs into `openspec/specs/agent-presets/`, `agent-loop` and `agent-im-runtime`.
- [x] 2.2 Archive `rebuild-agent-im-configuration` (20/21 tasks done) to `openspec/changes/archive/2026-09-23-rebuild-agent-im-configuration/`, syncing its delta specs into `openspec/specs/agent-im-runtime/` and `execution-trace-dashboard/`.
- [x] 2.3 Confirm the capabilities P2 and P4 modify (`agent-im-runtime`, `agent-loop`) are present in `openspec/specs/` after archiving.
- [ ] 2.4 Operational item carried over from `rebuild-agent-im-configuration` task 5.4, deliberately not a blocker: build a complete distribution and deploy/migrate the NAS when reachable, then verify health and actual routing.

## 3. P1 — `add-provider-protocol-axis`

- [x] 3.1 Create the change with proposal, design, tasks and spec deltas for `provider` and `agent-im-runtime`.
- [x] 3.2 Model `WireProtocol` as a closed set (`OPENAI_CHAT_COMPLETIONS`, `OPENAI_RESPONSES`, `ANTHROPIC_MESSAGES`, `GEMINI_GENERATE_CONTENT`, `OLLAMA_CHAT`) selected on the connection, with the vendor type supplying the default so existing connections do not change.
- [x] 3.3 State the two-consumer rule in the design: an internal Agent adapts the protocol into `ChatProvider`; an external engine receives endpoint, protocol and secret and speaks it itself.
- [x] 3.4 State the secret boundary rule: exactly one audited native resolution path; never widen `GuardedSecret`, never write the secret to engine configuration or logs.
- [x] 3.5 Specify the validation and observability surface: unknown protocol rejected at activation; resolved protocol reported on the connection view; the "declared but unverified" limitation documented.
- [x] 3.6 Carry forward the `OPENAI_RESPONSES` request/response mapping and its explicit fidelity boundary from `add-openai-responses-provider`.
- [ ] 3.7 Exit criteria: existing connections keep their behaviour with no configuration change; a Responses connection is expressible and reported; no secret appears in any API model, log or engine config file.

## 4. P2 — `add-agent-types`

- [x] 4.1 Create the change with proposal, design, tasks and spec deltas for a new `agent-types` capability plus `agent-im-runtime` and `agent-loop`.
- [x] 4.2 Define `AgentType`, `AgentTypeDefinition` (engine, internal preset, `llmProtocols`, `toolInjectionModes`, defaults) and the registry, replacing `AgentPreset` / `AgentPresetRegistry` on the configuration surface.
- [x] 4.3 Rename `agents[].preset` to `agents[].type` across the projection chain (`AgentProfileDocument` → `AgentDefinitionDocument` → `EffectiveAgent` → `Agent`) with a one-to-one value mapping and no behaviour change.
- [x] 4.4 Introduce the `ExternalAgentRunner` contract (one call per turn, no `ChatProvider`, no `ContextManager`, returning the existing `AgentResponse`) and an engine-keyed registry as the seam, replacing the removed proposal's `runtimeScope` + `engineId` selection.
- [x] 4.5 Make provider resolution type-aware: an internal type requires a `ChatProvider`; an external type requires only that the referenced connection resolves and that its protocol is in the type's `llmProtocols`.
- [ ] 4.6 Express the per-type field-validity matrix: budgets, compression and instruction-document settings are inert for an external type and must be reported, not silently ignored.
- [ ] 4.7 Add the registry completeness rule (every type declares a non-empty protocol set) and the capability validation rules.
- [x] 4.8 Add the Dashboard type selector fed by a server-reported type roster, including each type's protocol and injection capabilities.
- [ ] 4.9 Pin the `INTERNAL` equivalence invariant with a test: a pre-change Agent compiles to the same-named type, dispatches to the same runner, and produces the same `AgentResponse`.
- [ ] 4.10 Exit criteria: every existing Agent behaves identically; an unsupported protocol or injection mode fails activation naming both the Agent and the value; the external-runner seam exists with no engine registered.

## 5. P3 — `add-tool-library`

- [ ] 5.1 Create the change with proposal, design, tasks and spec deltas for a new `tool-library` capability plus `workspace-runtime`.
- [ ] 5.2 Define a library entry `{ id, enabled, settings, credentials }` with credentials expressed only as `CredentialReference`, and an Agent-level override that merges field-wise with the Agent winning.
- [ ] 5.3 Extend `ConfigurableToolDescriptor` with the settings metadata the Dashboard needs to render a per-tool form, without changing tool execution semantics.
- [ ] 5.4 Keep credentials library-scoped in this iteration and record the reasoning; require any later per-Agent override to reuse `CredentialReference`.
- [ ] 5.5 Normalize existing `toolPolicy` switches into library entries with empty settings, preserving each deployment's current enabled set, and keep agent-level `enabled` / `minimumPermissionGroups` as narrowing.
- [ ] 5.6 Convert `WebSearchTool` from hardcoded endpoints to resolved settings as the first consumer, and define the "restore library default" behaviour.
- [ ] 5.7 Exit criteria: a tool's settings and credential reference are configurable and visible without code changes; no plaintext secret is persisted; existing tool behaviour is unchanged when settings are empty.

## 6. P4 — `add-im-tool-injection`

- [ ] 6.1 Create the change with proposal, design, tasks and spec deltas for a new `im-tool-injection` capability plus `platform-abstraction`, `agent-loop` and `agent-im-runtime`. Proposal, design and two deltas exist; `agent-loop` delta remains with the full dispatcher implementation.
- [ ] 6.2 Define `ToolInjectionMode = NONE | SINGLE | MULTI | SKILL` and place the selection on the route action, with the reasoning that the IM message is the origin of injection.
- [ ] 6.3 Define the platform contribution contract for `SINGLE`: exactly one dispatcher tool per platform, with the platform owning the action table and performing per-action argument validation internally.
- [ ] 6.4 Extend the policy key so a dispatcher action can be narrowed independently, and specify the structured validation error a dispatcher returns.
- [ ] 6.5 Map `SKILL` mode onto the existing `UseSkillTool` + `PipelineSkillState` mechanism, and record that it is also the shape a future engine consumes.
- [ ] 6.6 Make the injection decision per-request at the `PreProcessStage` tool-assembly point, consuming the route recorded by `ImRouteStage`.
- [ ] 6.7 Stop globally advertising every platform's tools as configurable; scope advertisement to the route's IM connection.
- [ ] 6.8 Add route-editor UI fed by the platform's available actions and its supported dispatcher shape.
- [ ] 6.9 Exit criteria: a deployment that only runs Telegram no longer sees NapCat tools; every existing route keeps today's injection shape by default; an unsupported mode fails activation naming route, Agent and mode.

## 7. P5 — `add-codex-engine`

- [x] 7.1 Create the change with proposal, design, tasks and spec deltas for a new `codex-engine` capability.
- [x] 7.2 Pin the reference fork revision and confirm `codex-rs/astrbot-py` builds as an `rlib` without the Python feature. Record the public `Engine` methods and the exact event and dynamic-tool JSON shapes.
- [ ] 7.3 Build a JNI `cdylib` for macOS arm64 and the NAS Linux architecture. The macOS arm64 debug build and mock no-login Responses smoke passed through a dynamic tool call, a narrowed second turn, persisted-rollout resume and token accounting; its latest local SHA-256 is `991139f3c9d218ddab2bd4f2ea4d34cf17c503eb37e9c3119efce91a6cecedf1` against fork revision `413f16a571a7a24557e70250c0284c5bebdd8c3f`. NAS Linux build and interrupt behavior remain.
- [ ] 7.4 If the pinned native engine does not complete the required round trip, narrow `CODEX.toolInjectionModes` to the mechanisms that passed (`NONE` / `SKILL`) and update both this change and P2's type capability spec before enabling the engine.
- [ ] 7.5 Implement `CodexNativeEngine`: bounded JSON, non-reused handles, panic-safe exports and acknowledgement-based event pumps are implemented; core futures now run on 16 MiB Rust workers after a JVM stack crash on resume. Architecture-matched library loading and production packaging remain.
- [x] 7.6 Implement an in-process engine generation per Agent CODEX home and a `CodexExternalAgentRunner` that adapts one inbound message to one complete Codex turn. The runner passes a real JNI restart/resume smoke; the shared registry loads it only for a checksum-verified local experiment and stops it after pipeline drain. Native DTOs remain behind this boundary.
- [ ] 7.7 Isolate persistent state at `configDirectory/codex-home`, use the Agent's `tempDirectory` as the explicit thread working directory, and start with `no_environment = true` and no code-mode host. Configure a custom Responses provider with `requires_openai_auth = false`; do not call `login_api_key`. The mock fake token did not appear in the scanned Codex home while live or after shutdown; log-side audit and rotation behavior remain. If a credential is persisted, extend the fork with an ephemeral credential API before using real credentials.
- [ ] 7.8 Persist the thread mapping by `(workspaceId, agentId, platformId, sessionId)`. Before each turn derive the dynamic-tool manifest from route and caller permission and pass it in `TurnRequest.dynamic_tools`; never advertise a prior caller's broader tool set. Serialize turns for the same thread while allowing independent threads to progress. On native failure, fail in-flight turns without replaying possible side effects.
- [ ] 7.9 Route every dynamic-tool event by its live `{threadId, turnId, callId}` tuple. The isolated runner now checks turn ID, call uniqueness, caller role and compiled tool set before `ToolCase.execute`, and submits bounded success/failure responses; cross-Agent lifecycle and configuration-time name-collision checks remain before activation.
- [ ] 7.10 Associate each active `turnId` with immutable caller permission. Resolve native execution, patch and permission reviews against that caller context; unknown or stale reviews default to deny. Map inbound cancellation to `Engine::interrupt`; drain and shut down with a deadline.
- [ ] 7.11 Deliver merged instructions and persona through `ThreadParams.developer_instructions` on start and resume. Changed model/instructions or authorized Skill list starts a new thread with a visible continuity notice. Authorized `use_skill` calls now return bounded Skill Markdown through the tool response; direct Codex Skill-input support and refresh behavior remain.
- [ ] 7.12 Enforce native-tool name collision rejection and report capability overlap per Decision 9. Collision rejection is now at activation and callback setup, and native web search is disabled in the custom provider; the remaining overlap report and operator guidance are pending.
- [x] 7.13 Map final assistant text to the existing `AgentResponse`; correlate turn, selected item and tool events plus actual token deltas into the execution trace without fabricating an LLM request/response pair. Trace payloads contain bounded metadata, not raw credentials.
- [ ] 7.14 Validate the native library revision and architecture at startup and package macOS and NAS Linux artifacts. Local startup requires an explicit path, OS/CPU family and SHA-256 check; invalid JSON, stale handles, turn timeout, duplicate tool calls and close during a pending poll have tests. Live-I/O cancellation, fatal-fault isolation and NAS shutdown remain. CODEX is off by default and locally opt-in; add no second container, listener or port.
- [ ] 7.15 Exit criteria: the pinned JNI library completes a turn in an isolated Agent home without Python or Codex login; injected tools execute through `ToolExecutor`; unauthorized tools and approvals are rejected; a conversation resumes its thread with a newly narrowed manifest; independent threads remain usable after one turn fails; and shutdown drains within a bound.

## 8. Verification of this change

- [x] 8.1 Read `proposal.md`, `design.md` and `specs/agent-type-model/spec.md` end to end and confirm no requirement here contradicts a P1–P5 boundary or duplicates one.
- [x] 8.2 Confirm every decision taken in the exploration is recorded (type replaces preset; capability as sets; protocol axis; route-scoped injection; library defaults with Agent override; `CODEX` retains instructions/persona/skills; engine-native tools take precedence and are disclosed).
- [x] 8.3 Confirm no runtime, configuration, Dashboard or test file was modified by this change.
- [x] 8.4 Confirm the roadmap table in `proposal.md`, the Preserved Evidence and Open Questions in `design.md`, and these tasks agree on ordering. Decision 11 and P5 were subsequently revised to the JNI path; its native smoke remains outstanding.
