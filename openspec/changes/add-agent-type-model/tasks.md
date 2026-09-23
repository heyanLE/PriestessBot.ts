This change ships no runtime code. Its tasks are the roadmap actions that turn the model into implementable changes, plus the verification that the model itself is complete and consistent.

## 1. Supersede the earlier proposals

- [x] 1.1 Confirm every surviving finding of `add-agent-runtime-scope` and `add-codex-agent-type` is recorded in `design.md` (Decisions 2, 3, 5 and Preserved Evidence), including the app-server protocol facts, the `exec`/SDK rejection reasoning, the CoKit assessment, and the unverified `dynamicTools` mechanism.
- [x] 1.2 Remove `openspec/changes/add-agent-runtime-scope/` and `openspec/changes/add-codex-agent-type/` once 1.1 is confirmed, so no implementer can pick up an abstraction this change replaces.
- [ ] 1.3 Note in each P1–P5 change that it supersedes the corresponding part of the removed proposals.
- [ ] 1.4 Confirm `add-openai-responses-provider` is superseded by P1 and remove it when P1 is created, carrying forward its fidelity-boundary table (reasoning items and `encrypted_content` do not round-trip; hosted Responses tools are dropped).

## 2. P0 — archive the implemented prerequisites

- [x] 2.1 Archive `add-deepseek-harness-agent-type` (43/43 tasks done) to `openspec/changes/archive/2026-09-23-add-deepseek-harness-agent-type/`, syncing its delta specs into `openspec/specs/agent-presets/`, `agent-loop` and `agent-im-runtime`.
- [x] 2.2 Archive `rebuild-agent-im-configuration` (20/21 tasks done) to `openspec/changes/archive/2026-09-23-rebuild-agent-im-configuration/`, syncing its delta specs into `openspec/specs/agent-im-runtime/` and `execution-trace-dashboard/`.
- [x] 2.3 Confirm the capabilities P2 and P4 modify (`agent-im-runtime`, `agent-loop`) are present in `openspec/specs/` after archiving.
- [ ] 2.4 Operational item carried over from `rebuild-agent-im-configuration` task 5.4, deliberately not a blocker: build a complete distribution and deploy/migrate the NAS when reachable, then verify health and actual routing.

## 3. P1 — `add-provider-protocol-axis`

- [ ] 3.1 Create the change with proposal, design, tasks and spec deltas for `provider` and `agent-im-runtime`.
- [ ] 3.2 Model `WireProtocol` as a closed set (`OPENAI_CHAT_COMPLETIONS`, `OPENAI_RESPONSES`, `ANTHROPIC_MESSAGES`, `GEMINI_GENERATE_CONTENT`, `OLLAMA_*`) selected on the connection, with the vendor type supplying the default so existing connections do not change.
- [ ] 3.3 State the two-consumer rule in the design: an internal Agent adapts the protocol into `ChatProvider`; an external engine receives endpoint, protocol and secret and speaks it itself.
- [ ] 3.4 State the secret boundary rule: exactly one audited resolution path at engine spawn; never widen `GuardedSecret`, never write the secret to engine configuration or logs.
- [ ] 3.5 Specify the validation and observability surface: unknown protocol rejected at activation; resolved protocol reported on the connection view; the "declared but unverified" limitation documented.
- [ ] 3.6 Carry forward the `OPENAI_RESPONSES` request/response mapping and its explicit fidelity boundary from `add-openai-responses-provider`.
- [ ] 3.7 Exit criteria: existing connections keep their behaviour with no configuration change; a Responses connection is expressible and reported; no secret appears in any API model, log or engine config file.

## 4. P2 — `add-agent-types`

- [ ] 4.1 Create the change with proposal, design, tasks and spec deltas for a new `agent-types` capability plus `agent-im-runtime` and `agent-loop`.
- [ ] 4.2 Define `AgentType`, `AgentTypeDefinition` (engine, internal preset, `llmProtocols`, `toolInjectionModes`, defaults) and the registry, replacing `AgentPreset` / `AgentPresetRegistry` on the configuration surface.
- [ ] 4.3 Rename `agents[].preset` to `agents[].type` across the projection chain (`AgentProfileDocument` → `AgentDefinitionDocument` → `EffectiveAgent` → `Agent`) with a one-to-one value mapping and no behaviour change.
- [ ] 4.4 Introduce the `ExternalAgentRunner` contract (one call per turn, no `ChatProvider`, no `ContextManager`, returning the existing `AgentResponse`) and an id-keyed registry as the engine seam, replacing the removed proposal's `runtimeScope` + `engineId` selection.
- [ ] 4.5 Make provider resolution type-aware: an internal type requires a `ChatProvider`; an external type requires only that the referenced connection resolves and that its protocol is in the type's `llmProtocols`.
- [ ] 4.6 Express the per-type field-validity matrix: budgets, compression and instruction-document settings are inert for an external type and must be reported, not silently ignored.
- [ ] 4.7 Add the registry completeness rule (every type declares a non-empty protocol set) and the capability validation rules.
- [ ] 4.8 Add the Dashboard type selector fed by a server-reported type roster, including each type's protocol and injection capabilities.
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

- [ ] 6.1 Create the change with proposal, design, tasks and spec deltas for a new `im-tool-injection` capability plus `platform-abstraction`, `agent-loop` and `agent-im-runtime`.
- [ ] 6.2 Define `ToolInjectionMode = NONE | SINGLE | MULTI | SKILL` and place the selection on the route action, with the reasoning that the IM message is the origin of injection.
- [ ] 6.3 Define the platform contribution contract for `SINGLE`: exactly one dispatcher tool per platform, with the platform owning the action table and performing per-action argument validation internally.
- [ ] 6.4 Extend the policy key so a dispatcher action can be narrowed independently, and specify the structured validation error a dispatcher returns.
- [ ] 6.5 Map `SKILL` mode onto the existing `UseSkillTool` + `PipelineSkillState` mechanism, and record that it is also the shape a future engine consumes.
- [ ] 6.6 Make the injection decision per-request at the `PreProcessStage` tool-assembly point, consuming the route recorded by `ImRouteStage`.
- [ ] 6.7 Stop globally advertising every platform's tools as configurable; scope advertisement to the route's IM connection.
- [ ] 6.8 Add route-editor UI fed by the platform's available actions and its supported dispatcher shape.
- [ ] 6.9 Exit criteria: a deployment that only runs Telegram no longer sees NapCat tools; every existing route keeps today's injection shape by default; an unsupported mode fails activation naming route, Agent and mode.

## 7. P5 — `add-codex-engine`

- [ ] 7.1 Create the change with proposal, design, tasks and spec deltas for a new `codex-engine` capability.
- [ ] 7.2 Spike `dynamicTools` end to end before scoping the rest: prove `initialize(experimentalApi=true)`, `thread/start(dynamicTools=[…])`, a model-issued `item/tool/call`, the `contentItems` response, and a terminal `turn/completed`. Record the pinned CLI version and the exact `DynamicToolSpec` shape observed.
- [ ] 7.3 If the spike fails, narrow `CODEX.toolInjectionModes` to `NONE` / `SKILL` and record the reduction in both this change and P2's spec.
- [ ] 7.4 Implement the app-server process supervisor and stdio JSON-RPC transport, or vendor CoKit behind a thin adapter if it models dynamic tool calls and approvals by then.
- [ ] 7.5 Synthesize engine provider configuration from the referenced connection (endpoint, protocol, secret) through the single audited secret path from P1; redirect the engine home into the Agent's own directory.
- [ ] 7.6 Map conversations to engine threads with a persisted mapping, and resume rather than replay.
- [ ] 7.7 Service `item/tool/call` through `ToolExecutor` so risk levels, permission groups and the enable table keep applying; answer approval requests from the sender's permission group.
- [ ] 7.8 Deliver the Agent's instructions, persona and skills through the chosen channel, and define the skill-discovery root.
- [ ] 7.9 Enforce name-collision rejection and the overlap disclosure from Decision 9.
- [ ] 7.10 Return the turn's final agent message as the runtime's final response and map turn notifications into the execution trace without a synthetic LLM request/response pair.
- [ ] 7.11 Pin a supported CLI version range with a fail-fast message, add the binary to the image, and document that engine-native actions are outside `toolPolicy`.
- [ ] 7.12 Exit criteria: a Codex Agent completes a turn in the Agent's directory; injected tools execute through `ToolExecutor`; an approval is decided from the sender's permission group; the runtime survives an engine crash and shutdown drains cleanly.

## 8. Verification of this change

- [x] 8.1 Read `proposal.md`, `design.md` and `specs/agent-type-model/spec.md` end to end and confirm no requirement here contradicts a P1–P5 boundary or duplicates one.
- [x] 8.2 Confirm every decision taken in the exploration is recorded (type replaces preset; capability as sets; protocol axis; route-scoped injection; library defaults with Agent override; `CODEX` retains instructions/persona/skills; engine-native tools take precedence and are disclosed).
- [x] 8.3 Confirm no runtime, configuration, Dashboard or test file was modified by this change.
- [x] 8.4 Confirm the roadmap table in `proposal.md`, the Preserved Evidence and Open Questions in `design.md`, and these tasks agree on ordering and on the one unverified mechanism.
