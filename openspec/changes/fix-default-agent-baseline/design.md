## Context

The fallback Agent handles all IM traffic that no keyword route matches, so it carries the bot's default quality. Today it underperforms for four independent reasons, and only one of them is model choice.

`CompressionSettingsDocument.maxTokens` defaults to `4096` and `dashboard/src/models/configV3.ts`'s `newAgent()` hardcodes the same value, so every newly created Agent starts with a window smaller than one assembled request: the system prompt alone carries platform facts, message-identity rules, directory information, formatting and delivery rules, the role document, and the skill blocks. `Agent.maxContextTokens` separately defaults to `8000`, so the three sources of "the default" already disagree.

Route matching is first-match-wins over an operator-ordered array, which `agent-im-runtime` specifies as the contract. Migration derives routes from legacy orchestration keywords and emits each as `*keyword*`, ordered by legacy `priority` and then keyword index. Because a `*P*` pattern matches every input containing `P`, an earlier broad keyword makes a later narrower one unreachable: `*file*` fully subsumes `*search_files*`, and realistic sentences match several routes at once with the earliest winning.

`ReActRunner.buildSystemPrompt()` builds one string by concatenation, placing `## Platform`, `## Message Identity`, `## Agent Directories`, `## Formatting` and `## Response Delivery` before `## Role Document`. It also renders a numbered plain-text tool list — even though tool schemas already travel as provider-native function definitions — and annotates entries the caller cannot use with `当前权限不足：需要 <ROLE>`.

## Goals / Non-Goals

**Goals:**

- Give a newly created Agent a context window and step budget that fit its model rather than truncating the first request.
- Present the Agent's own role before platform mechanics, and stop duplicating or leaking information into the prompt.
- Remove the broad-keyword starvation class from migration-generated routes without changing route semantics.
- Make route unreachability and a lost delegation role visible at configuration time instead of as a wrong answer in chat.
- Leave a reproducible fallback-Agent baseline so the next change can be measured against a sane starting point.

**Non-Goals:**

- Introduce the Agent type/preset mechanism, a DSH-style numeric section registry, or per-type prompt composition.
- Change first-match-wins route evaluation, or replace keyword routes with model-based routing.
- Add session-scoped task state, plan mode, goals, todos, subagents, or an interactive approval channel.
- Parallelise tool execution or change compaction algorithms.
- Select models, or edit the operator's model choices.

## Decisions

### 1. Raise the three sources of the defaults together

`CompressionSettingsDocument.maxTokens` 4096 → 32768 and `ExecutionSettingsDocument.maxSteps` 10 → 25. `Agent`/`AgentController` and the Dashboard `newAgent()` factory carry the same numbers, and a test asserts all three agree so they cannot drift again.

Rationale: 4096 is below the assembled system prompt plus a single tool result, so the default silently degrades every new Agent. Choosing a value that fits a typical model window removes the failure without asking the operator to know the number.

Alternative rejected: leave defaults and document "set `maxTokens` explicitly". The failure is silent — the Agent answers without the context it needs, which is indistinguishable from a weak model.

Note: raising a default only affects Agents created afterwards, plus configurations that omit the field. Existing profiles that persisted `4096` keep it, because the operator may have chosen it deliberately; the baseline task therefore updates the development profile explicitly rather than relying on the new default.

### 2. Compose the system prompt from an ordered section list

Replace string concatenation in `ReActRunner.buildSystemPrompt()` with an ordered list of named sections that each render to a string, are dropped when empty, and are joined with a blank line. The Agent role document moves to the front; platform and session facts follow; formatting and delivery rules close.

Rationale: the role document is the only part that tells the model what it is, and it currently sits below five blocks of platform mechanics. An explicit ordered list also gives the Agent-type change a structure to parameterise later instead of another rewrite.

Alternative rejected: adopt DSH's numeric `SECTION_ORDERS` registry and scoped section registration now. It solves composition for many independently-registered plugins, which this codebase does not have; it would introduce a registry, scoping and shadowing rules for no present consumer.

### 3. Stop duplicating tool schemas and disclosing permission mechanics

Remove the plain-text tool enumeration from the system prompt. Tool schemas reach the provider through `ToolSchema.toOpenAIFormat()` in the request's `tools` array, so the text list is a second and lossier copy of the same information. Also remove the `当前权限不足：需要 <ROLE>` suffix: `ReActRunner.workspaceScopedTools()` already filters unavailable tools out of the request, so the prose only advertises capabilities the model cannot use.

Rationale: the prose list duplicates the schema and mixes a permission hint into a capability list. Neither helps the model act; both consume window.

Preserved deliberately: the available-skill and loaded-skill blocks, the platform and message-identity facts, the Agent directory paths, and the delivery rules. Only the tool enumeration and permission prose are removed.

### 4. Order migrated routes by descending keyword specificity

In `ApplicationConfigurationMigrator`, sort keyword-derived routes by descending keyword length within the same legacy priority, before generating the per-session-type entries.

Rationale: `*P*` matches every input containing `P`, so if `P` occurs inside `Q` then `*P*` preceding `*Q*` makes `*Q*` unreachable. Ordering narrower keywords first removes that class. Measured against the reproduced inputs, this corrects five of the six mis-routes; the remaining case is a tie between equal-length CJK keywords, which is inherently ambiguous and stays operator-ordered.

Alternatives rejected: specificity-based matching at runtime (breaks the documented first-match contract and the Dashboard's explicit ordering control), and dropping keyword routing in favour of the model (a routing change far outside this change's scope).

Because migration runs once and the current profile is already v3, this decision fixes future migrations; the present profile is corrected by the baseline task, and decision 5 makes the problem visible.

### 5. Report reachability and lost delegation as diagnostics, not silent acceptance

Two diagnostics:

- `IM_ROUTE_UNREACHABLE`: within one IM and session type, an earlier enabled route's glob strictly subsumes a later enabled route's pattern, so the later route can never match. Subsumption for `*P*` / `*Q*` globs is decided by whether `P` is a substring of `Q`, which is exact and produces no false positives. The route table stays loadable so the operator can reorder it.
- `AGENT_DELEGATION_UNAVAILABLE`: migration carried over a Workspace whose orchestration designated an Agent as the router, but the deployment exposes no delegation capability. The trigger is the structural `orchestration` configuration, not a text heuristic over instructions, and migration must not rewrite the operator's authored instructions.

Rationale: both failures are currently invisible — the first surfaces as a misrouted message, the second as an Agent answering outside its stated role. Both are decidable from configuration at validation time.

Alternative rejected: heuristic scanning of instructions for routing verbs. It would misfire on unrelated phrasing and would still not tell the operator what to do.

## Risks / Trade-offs

- **Raising the window increases cost per request** for profiles that previously ran at 4096. Mitigation: the default follows the model window, and existing explicit values are left untouched, so only new or unspecified Agents change.
- **Removing the tool-list prose may reduce a weak model's awareness of tools** that it would otherwise see named twice. Mitigation: schemas already carry name and description natively; the baseline task measures route selection and tool use before and after rather than assuming.
- **Reordering the system prompt changes the request prefix**, so provider KV-cache reuse is lost once per Agent at upgrade. This is a one-time cost and is accepted.
- **The diagnostics are advisory** and do not forbid an intentional ordering, so a determined operator can still shadow a route. Accepted: the spec states first-match-wins is the contract, and validation only reports.
- **`IM_ROUTE_UNREACHABLE` covers strict subsumption only**, so partially-overlapping keywords of similar length still mis-route. Accepted: it detects exactly what is provable and defers the ambiguous cases to the operator.
- **This change touches `agent-im-runtime` before it is archived**, so it must be applied after `rebuild-agent-im-configuration`. Sequencing is explicit rather than implicit.
