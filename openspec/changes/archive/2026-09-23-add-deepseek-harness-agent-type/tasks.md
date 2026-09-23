## 1. Preset selection and threading

- [x] 1.1 Add `AgentPreset` (`NORMAL`, `DEEPSEEK_HARNESS`) and `AgentProfileDocument.preset` defaulting to `NORMAL`.
- [x] 1.2 Carry `preset` through the v3 projection into `AgentDefinitionDocument`, into `EffectiveAgent.definition`, and into `Agent`.
- [x] 1.3 Reject an unregistered preset before activation. The field is a serialized enum, so an unknown value fails decoding and produces `APPLICATION_CONFIG_INVALID`; registry completeness is asserted separately in `AgentPresetRegistryTest`.
- [x] 1.4 Tests: omitted preset compiles as `NORMAL`, an unknown preset is rejected with no usable value, and the preset survives both the projection and compilation.

## 2. Preset registry

- [x] 2.1 Add `AgentPresetDefinition` with `PromptSectionSpec`, `IdentityTemplateSpec`, `InstructionsDocumentSpec` and `AgentPresetDefaults`.
- [x] 2.2 Define `NORMAL` to reproduce the pre-preset section order and the shared runtime defaults.
- [x] 2.3 Define `DEEPSEEK_HARNESS` with the priority-ordered harness layout, identity template, instruction document and larger budgets. Its `parallelToolCalls` and compression policy fields land with groups 6 and 7, where they are consumed.
- [x] 2.4 Tests pin `NORMAL`'s section order, absent wrapper and absent instruction document, plus registry completeness, unique orders and unique display names.

## 3. Ordered prompt assembly

- [x] 3.1 Extract assembly into `SystemPromptAssembler`; one assembler serves every preset.
- [x] 3.2 Assemble by ascending order then name, drop blank sections, join with a blank line.
- [x] 3.3 Render the identity template as prefix and suffix sections with `{{model}}`/`{{cwd}}` interpolation.
- [x] 3.4 Implement the harness layout from the design.
- [x] 3.5 Tests: ordering, blank omission, interpolation, absent template, instruction section, both presets end to end.

## 4. Instruction document

- [x] 4.1 Add `AgentInstructionsDocument` over the Agent `configDirectory`: regular files only, symlinks refused, byte cap.
- [x] 4.2 Inject as a labelled block naming its source path, with dedupe by content digest and `</system-reminder>` escaping.
- [x] 4.3 Emit an explicit budget notice on overflow and truncate only the most specific document.
- [x] 4.4 Tests: present, absent, blank, oversized, UTF-8 boundary, symlink, directory, embedded delimiter, duplicate content.

## 5. Per-tool guidance

- [x] 5.1 Add `ToolSchema.guidance`, declared last because plugins compile against the positional constructor.
- [x] 5.2 Render one guidance block per visible tool that declares guidance, read-only risks first.
- [x] 5.3 A tool without guidance, or filtered out of the request, contributes no block.
- [x] 5.4 Add guidance to `read_file`, `write_file`, `patch` and `search_files`. The remaining built-ins still need guidance.
- [x] 5.5 Tests: presence, ordering, absence, and no-guided-tools case.

## 6. Parallel-safe tool scheduling

- [x] 6.1 Extract `ToolCallExecutor` (materialization, overflow spilling, hook dispatch, trace recording) so both runners share one implementation.
- [x] 6.2 Add `HarnessRunner` extending `ReActRunner`, changing only the scheduler; added `AgentRunnerKind` and `AgentCase` dispatch by preset.
- [x] 6.3 Add `ToolSchema.parallelSafe` and `ParallelSafeToolCallScheduler`: each maximal run of consecutive parallel-safe calls runs concurrently under the preset ceiling, everything else alone in submission order.
- [x] 6.4 Observation append order follows submission order by construction (outcomes are indexed by submission position), and traces stay per-call.
- [x] 6.5 Tests: overlap proven, ceiling honoured, out-of-order completion still yields submission-order observations, a mutating call never overlaps, a failing call leaves its siblings intact, and the chat runner stays serial.

## 7. Summarization compaction

- [x] 7.1 Add `CompressStrategy.LLM_SUMMARIZATION`, `ContextSummarizer`, and per-call wiring through `ContextManager.compress` (the runner owns the provider).
- [x] 7.2 Reuse `ConversationRounds.split` so a round is atomic: a tool exchange can never be separated, and the last round (the request in flight) is always retained.
- [x] 7.3 Replace the span with a marked generated checkpoint carrying the model's summary.
- [x] 7.4 Add `ToolResultPruner` (threshold, head, tail, explicit marker) and run it on the span before summarizing.
- [x] 7.5 Fall back to truncation when the summary is blank or the call throws.
- [x] 7.6 Tests: request preservation, marked replacement, balanced tool exchanges, pruner shape and bounds, fallback, and single-round no-op.

## 8. Dashboard and configuration surface

- [x] 8.1 Add `preset` to `dashboard/src/models/configV3.ts` `AgentProfile`; `newAgent()` now takes the selected preset definition and inherits its budgets.
- [x] 8.2 Add a preset selector to the Agent editor's identity section, fed by `GET /api/agent-presets` so the roster is never duplicated. Includes an explicit "apply this preset's default budgets" action rather than silently overwriting the operator's values.
- [x] 8.3 Extend the example configuration with a task-preset Agent, and add a committable `docs/examples/AGENTS.md` template (the `agents/` tree is git-ignored).
- [x] 8.4 `npm run build` (including `vue-tsc`) and all four dashboard smoke tests pass.
- [x] 8.5 Fix the drift this exposed: `context.compression.strategy` was allowlisted in `ConfigurationValidator` separately from the compiler's mapping, so a config selecting `llm_summarization` failed activation. The enum now owns its config name; pinned by `CompressStrategyConfigNameTest`.
- [x] 8.6 Fix the same drift in the Dashboard: the compression-strategy dropdown hardcoded two of the three values, so `llm_summarization` could not be selected in the UI at all. Options now come from `GET /api/compression-strategies`; only the labels are local, and an Agent's current value is always kept selectable.

## 9. Verification

- [x] 9.1 Run the full JVM suite (424 tests, 0 failures, 2 live-integration skips).
- [x] 9.2 `NORMAL` equivalence: `AgentPresetRegistryTest` pins the chat preset's section order and shared defaults, and every pre-existing `ReActRunner` test passes unchanged after the tool-execution extraction.
- [x] 9.3 Ran a real instance against the example configuration: startup healthy with both presets, `GET /api/agent-presets` returns the registry, and `/api/config/v3` reports `task-agent` as `DEEPSEEK_HARNESS` / 60 steps / `llm_summarization` with no diagnostics.
- [x] 9.4 Deployed twice to the NAS (`v3-20260918T161609Z`, then `v3-20260918T161901Z` for 8.6): jar byte-identical to the local build, healthy, four rollback releases retained, new Dashboard asset served, `GET /api/agent-presets` and `GET /api/compression-strategies` both live, and the deployed Agent switched to `DEEPSEEK_HARNESS` from the Dashboard with no diagnostics.

## Follow-up found while verifying the deployment (not part of this change)

The redeploy interrupted an in-flight message: its trace ends `Process restarted before execution completed`. The app's pipeline drain budget is a hardcoded 10s (`PipelineController.DEFAULT_DRAIN_TIMEOUT_MILLIS = 10_000`) with no configuration knob, while `deploy-nas.sh` grants `docker stop -t 30`. So the app abandons any message whose remaining work exceeds 10s, and the next startup marks that trace failed. A long-running task Agent makes this far more likely, so the drain budget should become configurable — or the deploy should wait for quiescence. The other recent failure was unrelated: a NapCat `upload_group_file` acknowledgement timeout.

## Known gaps to close before this change is complete

- `AgentPresetDefaults` is consumed only by the Dashboard Agent factory. An Agent created by hand does not inherit a preset's budgets: its persisted values win, so `preset` alone changes behaviour but not limits. The editor's explicit "apply default budgets" action is the manual path.
- Summarization is not yet a preset default; it must be selected through `context.compression.strategy = "llm_summarization"`, as the example configuration now does.
- Only `read_file` and `search_files` declare `parallelSafe` and guidance. The remaining read-only built-ins still need both.
