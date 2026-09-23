## Context

`PersonaMemoryInjector` resolves the active Persona and augments Agent instructions, while `PreProcessStage` separately loads persisted history into provider messages. Few-shot examples are conversations rather than instructions, so rendering them into the system prompt would lose role semantics.

## Goals / Non-Goals

**Goals:**

- Represent examples as ordered, structured user/assistant pairs.
- Preserve user and assistant roles in provider requests.
- Place examples before stored history and the current user turn.
- Ensure examples are configuration only and never saved as real conversation history.
- Support editing and round-tripping examples through the Dashboard API.

**Non-Goals:**

- Import AstrBot configuration files automatically.
- Add tool calls or system messages inside examples.
- Pin examples against normal context-window compression.

## Decisions

### 1. Use structured pairs

Each Persona stores `exampleDialogs: List<PersonaExampleDialog>`, where a dialog contains one non-blank `user` message and one non-blank `assistant` message. This prevents invalid alternating-role sequences and gives the Dashboard a natural repeatable editor.

### 2. Persist examples as JSON

The `personas` table gains an `example_dialogs` text column with a `[]` default. Existing databases are upgraded by the existing additive schema synchronization and old API payloads remain valid.

### 3. Inject with native roles

The injector returns the selected Persona with its examples. `PreProcessStage` expands each pair into a user message followed by an assistant message before stored history. `ReActRunner` still prepends the system prompt, producing: system, examples, stored history, current user.

### 4. Keep examples transient

Examples are added only to the in-memory `AgentContext`. The post-processing persistence path continues to save the incoming user turn, final answer, and tool traffic after that turn; it never iterates over earlier example messages.

### 5. Bound configuration input

A Persona may contain at most 20 example pairs, and each side may contain at most 8,000 characters after trimming. Invalid incomplete pairs are rejected instead of silently discarded.

## Risks / Trade-offs

- Examples consume context budget and can be removed by normal compression when the request is large.
- Poor examples can bias answers more strongly than prose instructions; the Dashboard makes their order and content explicit.
