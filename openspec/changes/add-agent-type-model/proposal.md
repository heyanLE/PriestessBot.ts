## Why

An Agent is currently described by three unrelated fields that all try to answer "what is this Agent?": `preset` selects an internal prompt/scheduling policy, `AgentPresetDefinition.runner` selects an internal runner, and the two unarchived proposals `add-agent-runtime-scope` / `add-codex-agent-type` wanted to add `runtimeScope` + `engineId` on top. Nothing declares what an Agent *can do* — which model protocols it may consume, which tool-injection shapes it can accept, or which of its configuration fields are meaningful at all.

That becomes a hard blocker the moment an Agent can be driven by an external engine. Codex cannot use an arbitrary chat-completions connection, cannot accept a `FunctionTool`, and does not read this runtime's persona or instructions. The runtime has no way to say so, so every mismatch would surface as a runtime failure on a user's message instead of a configuration error.

Three more problems share the same root:

- **Protocol is welded to vendor.** `llms[].type` (`openai` / `anthropic` / `gemini` / `ollama`) picks the adapter, so `LLMKind` means vendor and protocol at once. No connection can declare that it speaks the OpenAI Responses API, and Codex requires exactly that.
- **Platform tools are injected unconditionally and advertised globally.** `PreProcessStage` concatenates `snapshot.runtimeTools + platform.platformTools()` for every message, and `PlatformRegistry.allToolDescriptors()` folds every platform's tools into one configurable catalogue. NapCat's group-file tools therefore appear in the Dashboard tool list for deployments that only run Telegram.
- **Tool policy carries no per-tool configuration.** `ToolPolicyDocument` has allow/deny/risk/enabled/permission-group and nothing else, so `web_search` hardcodes its SearXNG endpoints in Kotlin. There is nowhere to say "use this search provider with this credential".

## What Changes

This change defines the model and the split. It ships no runtime behaviour: its deliverable is the capability model, the validation invariants, the decision record, and the roadmap that turns it into four to five implementable changes.

- **Agent type becomes the operator-facing identity of an Agent**, replacing `preset`. A type resolves to a data-driven descriptor that holds the engine (`INTERNAL` | `CODEX`), the internal preset for internal engines, the accepted LLM protocols, the accepted tool-injection modes, and the default budgets.
- **Capabilities are declared as sets, not booleans.** An Agent type declares `llmProtocols` and `toolInjectionModes`; a configuration that selects an unsupported protocol or injection mode fails validation before activation instead of failing a message.
- **Provider connections gain a wire protocol axis**, separate from the vendor/adapter family: a connection declares which protocol it speaks, and the vendor type supplies the default.
- **Tool injection becomes a route-scoped decision.** The injection mode is configured on the IM route that selected the Agent, because without an incoming IM message there is nothing to inject; unsupported combinations are rejected against the target Agent's type.
- **A tool library replaces the flat tool switch table**, holding per-tool settings and credential references, with the library supplying defaults that an Agent may override.
- **Retain, do not reimplement.** An external engine's own tools keep precedence, and the boundary consequence — that engine-native actions are outside `toolPolicy` — is disclosed by validation and in operator documentation rather than left implicit.
- **Supersede the two earlier proposals.** `add-agent-runtime-scope` (scope selection + `ExternalAgentRunner` + `engineId`) and `add-codex-agent-type` (app-server engine built on that scope) are replaced by this model and its roadmap. Their verified findings are preserved in `design.md`; the proposal documents themselves are removed.

## Capabilities

### New Capabilities

- `agent-type-model`: the Agent type descriptor and its capability declaration; the provider wire-protocol axis; the route-scoped tool-injection decision; the tool library with per-tool settings; and the cross-cutting validation invariants that bind them.

### Modified Capabilities

None in this change. The capabilities this model replaces or extends — `agent-im-runtime`, `agent-loop`, `provider`, `platform-abstraction`, `tool-mcp`, `sub-agent-orchestration` — are modified by the roadmap changes listed below, each with its own deltas.

## Roadmap

This change is the umbrella. Each item below becomes its own change with its own specs and tasks.

| Order | Change | Covers | Depends on |
|---|---|---|---|
| P0 | archive `rebuild-agent-im-configuration`, `add-deepseek-harness-agent-type` | — | **done 2026-09-23**, specs synced |
| P1 | `add-provider-protocol-axis` | provider wire protocol axis; Agent type protocol restriction | supersedes `add-openai-responses-provider` |
| P2 | `add-agent-types` | Agent type registry, capability declaration, external-runner seam | P1 |
| P3 | `add-tool-library` | tool library entries, per-tool settings, credential references | independent |
| P4 | `add-im-tool-injection` | route-scoped injection modes, single-dispatcher contract | `add-platform-scoped-tools`, P2, P3 |
| P5 | `add-codex-engine` | the `codex` external engine over app-server | P1, P2, P4 |

P0 was a prerequisite for all of them and is complete: both changes were implemented in the working tree but unarchived, and `add-agent-types` modifies the capabilities they introduce. Their delta specs are now synced into the main specs (`agent-presets`, `agent-im-runtime`, `execution-trace-dashboard`, `agent-loop`).

P5 deliberately carries forward the app-server findings recorded in this change's `design.md`, including the one unverified mechanism (`dynamicTools`) that must be spiked before P5 is scoped as implementable.

## Impact

- **Configuration model.** `AgentProfileDocument` gains `type` and loses `preset`; `ProviderConnectionDocument` gains a protocol selection; `ToolPolicyDocument` is joined by a tool library; `ImRouteActionDocument` gains an injection selection.
- **Validation and projection.** `ConfigurationValidator`, `ConfigurationCompiler`, `ApplicationConfigurationSource`, `ToolPolicyResolver`, and `ApplicationToolPolicyInitializer` all learn the new invariants.
- **Dashboard.** The Agent editor loses the preset selector in favour of a type selector; the route editor gains the injection section; the tool surface becomes a library with per-tool settings; every roster and matrix is server-reported.
- **Runtime seams.** `AgentPresetRegistry` becomes the Agent type registry, `AgentCase` dispatch becomes type-driven, and the platform tool path gains a mode decision.
- **No migration of behaviour.** Existing Agents keep their behaviour: `preset: NORMAL | DEEPSEEK_HARNESS` maps to the same-named type, and every existing route defaults to the current injection shape.
- **Documentation.** `docs/configuration-v3.md`, `config.example.json`, and the operator note that an external engine's native tools are outside `toolPolicy`.
