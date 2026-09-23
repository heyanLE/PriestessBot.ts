## Context

Agent behaviour is currently fixed. `AgentCase.runWithProvider` constructs a `ReActRunner` directly, `ReActRunner.buildSystemPrompt()` hardcodes one section layout, and `ContextManager` offers two truncation strategies (`TOKEN_WINDOW`, `ROUND_TRUNCATION`). The only per-Agent variation is the data an Agent carries, not how it operates.

Change 1 already turned the system prompt into ordered named sections and removed the duplicated tool enumeration, so the assembly seam exists. What is missing is the ability to select a *different* assembly, a different tool-scheduling policy and a different compression policy per Agent.

DeepSeek Harness's `standard` preset supplies the reference behaviour. Its relevant properties, confirmed by reading that codebase:

- `packages/core/system-prompt/src/index.ts:121-154` declares `SECTION_ORDERS`, a repository-owned numeric table. Sections sort by `order` then by name; a section rendering empty is dropped; survivors join with `\n\n`.
- Persona is not special: `deployment:persona-prefix` (order 0) and `deployment:persona-suffix` (order 10200) are ordinary sections, with `{{model}}`/`{{cwd}}` interpolated at render time.
- Runtime context is a separate channel from sections: it renders as sourced **user-role** snapshots prefixed with a supersedes-earlier header. This change deliberately does not copy that channel; see Decision 4.
- Tool *schemas* travel as provider-native function definitions only. The prompt instead carries one short prose guidance section per tool (orders 1000-2900) — behavioural advice, not schemas.
- `packages/context/agent-instructions` loads `AGENTS.md`/`CLAUDE.md` plus `.local` overlays from `$DSH_HOME` then the project chain, broad to specific; dedupes by trimmed-content digest; honours `maxBytes` by dropping the broadest documents first and truncating the most specific one; and emits an explicit budget notice.
- `packages/core/agent-loop` runs parallel-safe tool calls concurrently, bounded by `maxParallelToolCalls` (default 10), while exclusive calls retain submission order.
- `packages/compaction/compaction-basic` summarizes the oldest balanced span with the model under a fixed 8-section structure; `tool-result-pruner` then replaces an oversized observation with head 4096 + marker + tail 1024 code points.

This change brings the selectable-behaviour half of that list. Task-state features (plan mode, todos, goals, continuation rounds, delegation) are deliberately excluded; see Goals/Non-Goals.

## Goals / Non-Goals

**Goals:**

- Make Agent behaviour a per-Agent choice so a chat Agent and a task Agent coexist under one runtime.
- Provide a preset definition that is data, so a third preset needs no new branch in the runner.
- Give the task Agent the instruction and guidance inputs it needs for complex work: an on-disk instruction document and per-tool guidance.
- Give it enough execution machinery for real tasks: concurrent parallel-safe tool calls and summarization-based compaction that preserves task state.
- Leave the `NORMAL` preset observably unchanged.

**Non-Goals:**

- Plan mode, todos, goals, autonomous continuation rounds, subagent delegation, or IM approval primitives. Each needs session-scoped persisted task state, which does not exist; bundling them would make this change unreviewable.
- Moving the skill catalog out of the system prompt. DeepSeek Harness injects it as a durable user message to keep the system prefix stable; doing that here changes skill-injection semantics and is deferred.
- Vector retrieval, a new provider protocol, or any change to tool schemas, tool implementations or permission gating.
- Reproducing DeepSeek Harness's Cordis scoping/realm model. This codebase has no plugin-scoped section registration, so sections are a flat ordered list owned by the preset.
- Changing model selection or costs on the operator's behalf.

## Decisions

### 1. Add a preset identifier, not a boolean

`AgentProfileDocument` gains `preset: AgentPreset = AgentPreset.NORMAL`, threaded through the existing four layers:

```
config.json  agents[].preset
   │  AgentProfileDocument                        config/model/ApplicationConfigurationDocument.kt
   ▼  AgentDefinitionDocument                      config/application/ApplicationConfigurationSource.kt:141  (v3 projection)
   ▼  EffectiveAgent                               config/model/EffectiveConfigModels.kt:98
   ▼  Agent                                        agent/Agent.kt
   ▼  AgentCase.runWithProvider                    agent/AgentCase.kt:26   (the dispatch point)
```

Rationale: an enum plus a registry extends to a third preset without touching validation, the projection, or the Dashboard beyond a new option. Validation runs on the *projected* document (`ConfigurationValidator` validates `WorkspaceConfigDocument.agents`), so the projection must carry `preset` before validation can see it.

Alternative rejected: infer behaviour from other Agent fields (e.g. "has an instruction document ⇒ harness"). Implicit selection makes behaviour unpredictable and untestable.

No migration is needed: every existing Agent decodes as `NORMAL`.

### 2. A separate runner composed from shared primitives, not a second copy of the loop

`AgentPresetDefinition.runner` selects a runner kind. `HARNESS` gets a `HarnessRunner`; `NORMAL` keeps `ReActRunner`.

The naive form of this — copy `ReActRunner` and change the prompt and scheduling — would duplicate roughly 400 lines of tool-loop logic, and change 3 will add more harness-only behaviour on top. So the tool-execution portion of `ReActRunner` is first extracted into a shared collaborator (materialization, overflow spilling, hook dispatch, observation appending, trace recording), and both runners compose it. `HarnessRunner` then contains only what differs: prompt assembly, tool scheduling, and compaction policy.

Rationale: keeps the two presets independently evolvable — which change 3 needs — without two copies of the same loop.

Alternative rejected: one `ReActRunner` parameterised by three policy objects and no new class. Cheaper now, but it makes the runner the union of both presets' behaviours and pushes preset branching into every step.

### 3. Preset definitions are data in a registry

```kotlin
data class AgentPresetDefinition(
    val preset: AgentPreset,
    val displayName: String,                    // "普通" / "DeepSeek Harness"
    val description: String,                    // shown by the Dashboard
    val runner: AgentRunnerKind,                // REACT | HARNESS
    val promptSections: List<PromptSectionSpec>,// ordered
    val identityTemplate: IdentityTemplateSpec?,
    val instructionsDocument: InstructionsDocumentSpec?,
    val parallelToolCalls: Int?,                // null = serial
    val compression: CompressionPolicySpec,
    val defaults: AgentPresetDefaults,
)
```

`AgentPresetRegistry` resolves a preset to its definition. `NORMAL`'s definition reproduces today's section order, budgets and serial tool execution exactly, and a test pins that equivalence so the chat Agent cannot drift.

### 4. Prompt assembly: ordered numeric sections, empty dropped

Sections carry an explicit `order` and a name; assembly sorts by `order` then name, drops any section that renders blank, and joins survivors with `\n\n`. This generalises what change 1 introduced and matches DeepSeek Harness.

Harness section order (derived from `SECTION_ORDERS`, restricted to what this runtime has):

| order | section | source |
|---|---|---|
| -1000 | `harness:identity` | preset constant |
| 0 | `deployment:identity-prefix` | identity template, `{{model}}`/`{{cwd}}` interpolated |
| 900 | `context:instructions` | instruction document, when present |
| 1000…2900 | `tool:<name>` | per-tool prose guidance, ascending |
| 9000 | `agent:role` | the Agent's own `instructions`, including its platform persona |
| 9100 | `platform:facts` | platform, session, agent directories |
| 9200 | `context:message-identity` | identity rules |
| 9300 | `formatting` | markdown and delivery rules |
| 10200 | `deployment:identity-suffix` | identity suffix |

Rationale for putting `agent:role` at 9000 rather than first: the harness prompt should read as *harness identity → who you are → how to behave → what the platform is → how to answer*, and the per-tool guidance must be read before the task instructions that reference tools. This differs from change 1's "role first" only for the harness preset; `NORMAL` keeps role-first.

**Two DeepSeek Harness mechanisms are deliberately not copied.**

*The runtime-context channel.* DeepSeek Harness renders per-turn facts — sandbox policy, approval policy, subagent delegation — as sourced user-role snapshots precisely so they do not disturb the stable system prefix, and because those facts genuinely change between turns and must supersede earlier ones. This runtime's platform facts (platform, session, permission group, agent directories) are stable for the life of a session, so a system section keeps the prefix cacheable and reads in a predictable order. Copying the channel would cost prefix stability and buy nothing.

*Persona.* DeepSeek Harness has no platform-persona concept: its `dsh-persona` is a deployment identity wrapper, which is why it can be expressed purely as prefix/suffix sections. Here a persona is a platform-owned record whose content `PersonaMemoryInjector` has already merged into the Agent's `instructions` before the runner sees it. The preset's templated wrapper is therefore named an **identity template** and kept separate from the platform persona, which stays inside the role document. Merging them would make an Agent's personality depend on which preset it runs.

### 5. Instruction document: `AGENTS.md` in the Agent configuration directory

`InstructionsDocumentSpec(fileNames = ["AGENTS.md"], maxBytes = 65536, ...)` is read from the Agent's `configDirectory` — the directory already resolved into `context.metadata["agentConfigDirectory"]` by `PreProcessStage:325`. Candidates are the configured names; discovery is a single directory for now (the Agent directory *is* the project root for that Agent), with `AGENTS.local.md`-style overlays accepted.

Rules: reject symlinks and non-regular files, cap the document at `maxBytes`, dedupe identical documents by trimmed-content digest, escape a literal `</system-reminder>`, and when over budget emit an explicit notice naming the path and the byte counts rather than silently dropping content. Reading reuses the hardened file-access pattern already proven in `AgentSkillCatalog` (`withDirectory`, `NOFOLLOW_LINKS`, size checks).

Deferred: DeepSeek Harness walks `$DSH_HOME` then the ancestor chain of the working directory and re-injects on file change. An IM Agent has one configuration directory, and a per-request re-read already picks up edits on the next message, so the chain and the nested-discovery messages are not reproduced.

### 6. Per-tool guidance sections

`ToolSchema` gains `guidance: String = ""`. A tool with non-blank guidance contributes a `tool:<name>` section at an order derived from the risk level (read tools before mutating tools). Guidance is behavioural prose ("use this instead of shell commands when…"), not a schema restatement; schemas stay native-only, which change 1 already established.

Rationale: this is where "complex instructions" actually come from. Today all operating advice has to fit in the Agent's single `instructions` string; DeepSeek Harness lets each tool own its guidance next to its implementation.

### 7. Parallel-safe tool scheduling

`ToolSchema` gains `parallelSafe: Boolean = false`. `HarnessRunner` groups the tool calls of one step: consecutive `parallelSafe` calls run concurrently under the step's ceiling (`parallelToolCalls`, default 10) and everything else runs alone in submission order. Append order of observations stays submission order regardless of completion order, so the transcript remains deterministic.

Rationale: a read-heavy task step (several file reads, searches) is where the wall-clock win is, and determinism is required for reproducible tests. Defaulting to `false` keeps every existing tool's behaviour unchanged until it opts in.

Alternative rejected: inferring parallel-safety from `riskLevel == SAFE_READ`. It happens to align today, but safety and concurrency are different properties and would drift.

### 8. Summarization compaction plus a tool-result pruner

Add `CompressStrategy.LLM_SUMMARIZATION`. Triggered by context pressure, it selects the oldest balanced span (never splitting a tool-call/result pair, never dropping the current request), calls the model once under a fixed structured-summary instruction, and replaces the span with a single marked message recording that it is a generated summary. The pruner replaces an oversized tool observation with head + marker + tail before the summary runs, so the summarizer sees bounded input.

Rationale: truncation drops task state exactly when a complex task has the most of it. A structured summary preserves intent, decisions and next steps.

Alternative rejected: reusing `ToolResultOverflowStore` as the only bound. It spills a *single* oversized result; it does not bound the accumulated conversation, which is what a long task exhausts.

### 9. `NORMAL` equivalence is a tested invariant

A test asserts the `NORMAL` definition's section order, budgets, serial scheduling and truncation compression match the pre-change behaviour. Without it, "keep the chat Agent cheap" is a comment rather than a guarantee.

## Risks / Trade-offs

- **Two runners can drift.** Mitigated by extracting the shared tool-execution collaborator and by the `NORMAL` equivalence test; not fully eliminated, since prompt assembly remains separate per preset.
- **Per-tool guidance adds prompt tokens for every visible tool.** Mitigated by making guidance optional and short, and by the harness preset's budget being explicitly larger than `NORMAL`'s. A deployment with many tools should expect a real increase in per-request cost.
- **Concurrent tool calls make failures harder to attribute.** Mitigated by keeping observation order deterministic and dispatching `onToolStart`/`onToolEnd` per call with its own identifiers, so traces remain per-call accurate.
- **Summarization compaction costs an extra model call** and can lose detail the operator wanted. Mitigated by triggering only under pressure, never touching the current request, and marking the replacement as generated.
- **Parallel-safe is a new opt-in flag**, so tools that would benefit silently stay serial until annotated. Accepted: defaulting to `true` for anything would risk concurrent mutation.
- **The instruction document is read from the Agent configuration directory**, so a deployment that puts secrets there could surface them to the model. Mitigated by documenting the directory as model-visible once the preset is enabled, and by the byte cap; not prevented.
- **This change touches `agent-im-runtime` before it is archived**, so it must be applied after `rebuild-agent-im-configuration`, the same sequencing constraint change 1 has.
