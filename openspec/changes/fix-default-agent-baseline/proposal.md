## Why

Every IM input that no keyword route matches falls back to a single Agent, so that fallback Agent's baseline decides the perceived quality of the whole bot. Measurements on the current development profile show the baseline is degraded by defaults and routing mechanics, not by model capability:

- The compiled context window defaults to `maxTokens = 4096` (`CompressionSettingsDocument`), and the Dashboard Agent factory repeats the same number. Assembled system prompt plus one tool result already exceeds that, so compression discards the context the Agent needs.
- `maxSteps` defaults to `10` in the configuration model and the Dashboard factory, and the fallback Agent is configured with `3`.
- 58 enabled Agent routes are evaluated first-match-wins, and migration generates each keyword route as a bare `*keyword*` glob. A broad keyword therefore starves a narrower one. Reproduced on the current profile: `terminal read the log` selects the file Agent over the terminal Agent, `remind me to read a book` selects the file Agent over the reminder Agent, `please remember the file` selects the file Agent over the memory Agent, and `帮我搜索网页文件` selects the file Agent over the web Agent. The `*search_files*` route is fully unreachable because an earlier `*file*` subsumes it.
- The system prompt prints the Agent's role document after five platform boilerplate blocks, restates tools as plain text beside the provider-native schemas that already carry them, and embeds permission-denial prose inside the tool list.
- The migrated fallback Agent's instructions still describe routing to other Agents, but the runtime exposes no delegation tool, so that instruction cannot be honored and the Agent answers outside its stated role.

## What Changes

- Raise the runtime defaults for context window and execution steps consistently across the configuration model, the compiled Agent, and the Dashboard Agent factory, and make the three unable to drift apart silently.
- Compose the Agent system prompt from an explicit ordered section list with the Agent role first, stop duplicating tool schemas as prompt text, and stop disclosing permission mechanics to the model.
- Order migration-generated keyword routes by descending keyword specificity within the same priority, so a broad keyword cannot precede and starve a narrower one that contains it.
- Report configuration diagnostics for a route made unreachable by an earlier matching route, and for a migrated orchestrator Agent that lost its delegation path.
- Establish a real fallback-Agent baseline (role, step budget, window) in the example configuration and the operator profile, and record measured before/after route selection and execution traces.

## Capabilities

### Modified Capabilities

- `agent-loop`: Agent runtime defaults, and system-prompt composition from ordered sections.
- `pipeline`: the Agent prompt context blocks scenario, which currently requires a tool block in the system prompt.
- `agent-im-runtime`: route specificity ordering during migration, and route-reachability diagnostics.

## Impact

- Touches `CompressionSettingsDocument`, `ExecutionSettingsDocument`, `Agent`, `AgentController`, `ReActRunner` system-prompt assembly, `ApplicationConfigurationMigrator`, `ConfigurationValidator`, `config.example.json`, and `dashboard/src/models/configV3.ts`.
- Depends on `rebuild-agent-im-configuration` being archived first, because two of its delta requirements modify the `agent-im-runtime` capability that change introduces.
- Deliberately does not change route matching semantics: first-match-wins evaluation and Dashboard ordering remain the contract.
- Deliberately does not add the Agent type/preset mechanism, session-scoped task state, plan mode, goals, todos, or a delegation tool. Those are follow-up changes; this change only removes the reasons the current baseline underperforms.
- Does not choose models on the operator's behalf. Model selection stays operator-owned and is recorded as baseline context, not changed by this change.
