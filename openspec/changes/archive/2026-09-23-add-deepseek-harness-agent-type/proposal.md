## Why

Every Agent currently behaves identically: one hardcoded prompt layout, one tool-call loop, one truncation-based compression strategy, and a single step budget. That is adequate for the simple chat Agent, but the deployment now needs an Agent that can carry complex, multi-step instructions — project conventions loaded from files, per-tool operating guidance, and enough budget to finish a task instead of abandoning it at a low step cap.

DeepSeek Harness's `standard` preset is the reference implementation: it composes one system prompt from ordered, priority-numbered sections; loads workspace instruction documents such as `AGENTS.md` under a byte budget; presents tool schemas natively while contributing a short prose guidance section per tool; runs parallel-safe tool calls of one step concurrently; and compacts context by model summarization rather than blunt truncation. None of that exists here.

Because behaviour is not selectable, an operator cannot keep a cheap chat Agent beside a capable task Agent, and improving the task Agent would change the chat Agent too.

## What Changes

- Add `preset` to the Agent configuration (`NORMAL` default, `DEEPSEEK_HARNESS` new) and carry it to the compiled runtime Agent.
- Introduce a data-driven preset definition — display name, runner kind, ordered prompt sections, persona templating, instruction-document spec, capability set and default budgets — so a third preset is data rather than another branch in the runtime.
- Assemble the harness system prompt from ordered, priority-numbered named sections, with an identity template that interpolates `{{model}}` and `{{cwd}}` as prefix and suffix sections.
- Let a tool contribute a short prose guidance section beside its native schema, so operating instructions live with the tool instead of in one hand-maintained block.
- Load the Agent's instruction document (`AGENTS.md`) from its configuration directory: broad-to-specific discovery, a byte budget, content-digest dedupe, `</system-reminder>` escaping and an explicit truncation notice.
- Let a tool declare itself parallel-safe so the runtime may run several parallel-safe calls of one step concurrently, bounded by a configured ceiling, while mutating calls keep submission order.
- Add model-summarization compaction with a structured summary, plus a tool-result pruner for oversized tool observations, as an additional compression strategy.
- Expose the preset in the Dashboard Agent editor, the Agent factory and configuration validation.

## Capabilities

### New Capabilities

- `agent-presets`: per-Agent behaviour selection, the preset definition registry, priority-ordered prompt assembly, the instruction document, and per-tool guidance sections.

### Modified Capabilities

- `agent-loop`: parallel-safe tool scheduling within a step, and a model-summarization compression strategy with a tool-result pruner.
- `agent-im-runtime`: the Agent configuration model gains the preset selection and its validation.

## Impact

- Touches `AgentProfileDocument`, the v3 projection in `ApplicationConfigurationSource`, `AgentDefinitionDocument`, `EffectiveAgent`, `Agent`, `AgentCase`, the new preset registry and prompt assembler, `ReActRunner` tool scheduling, the context compression strategies, `ToolSchema`, `ConfigurationValidator`, the Dashboard Agent editor and `configV3.ts`, and `config.example.json`.
- Depends on `rebuild-agent-im-configuration` being archived first, because it modifies the `agent-im-runtime` capability that change introduces.
- Deliberately does not add plan mode, todos, goals, autonomous continuation rounds, subagent delegation, or any IM approval primitive. Those need session-scoped persisted task state that does not exist yet, and they belong to the follow-up change so this one stays reviewable.
- Does not change the `NORMAL` preset's observable behaviour: its prompt sections, budgets and tool scheduling must remain equivalent to today's Agent.
- Does not adopt DeepSeek Harness's user-role runtime-context channel: this runtime's platform facts are session-stable, so they stay system sections to keep the prefix cacheable. Does not merge the preset's identity template with the platform persona, which stays in the Agent's role document.
- Does not change tool schemas, tool implementations, permission gating, or the existing skill-injection path.
