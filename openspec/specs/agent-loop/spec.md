# agent-loop Specification

## Purpose
TBD - created by archiving change priestess-v1-core. Update Purpose after archive.
## Requirements

### Requirement: AgentRunner interface with per-message isolation
The system SHALL define `AgentRunner` interface with `reset()`, `step()`, `stepUntilDone()`, `isDone()`. Each Runner instance SHALL serve exactly one message chain and be discarded after completion.

#### Scenario: New Runner per message
- **WHEN** ProcessStage receives a new message event
- **THEN** a fresh `ReActRunner` instance is created via Koin `factory` scope

#### Scenario: Runner isolation
- **WHEN** two messages arrive concurrently
- **THEN** their respective Runner instances operate independently with no shared mutable state

### Requirement: Agent state machine
The system SHALL implement `AgentState` with states: IDLE, RUNNING, DONE, ERROR.

#### Scenario: State transitions
- **WHEN** `reset()` is called → state becomes IDLE
- **WHEN** first `step()` is called → state becomes RUNNING
- **WHEN** final response is obtained → state becomes DONE
- **WHEN** an unrecoverable error occurs → state becomes ERROR

### Requirement: Agent hooks
The system SHALL provide `AgentHooks` with callbacks: `onAgentBegin`, `onToolStart`, `onToolEnd`, `onAgentDone`.

#### Scenario: Tool invocation hook
- **WHEN** the Agent invokes a tool
- **THEN** `onToolStart` is called with tool name and arguments, and `onToolEnd` is called with the result

#### Scenario: Agent lifecycle hook
- **WHEN** the Agent loop begins
- **THEN** `onAgentBegin` is called. When the loop ends, `onAgentDone` is called.

### Requirement: ReActRunner Thought-Action-Observation loop
The system SHALL implement `ReActRunner` that iterates: check context → call LLM → execute tool calls if present → repeat until final answer or max steps.

#### Scenario: Single turn without tools
- **WHEN** the LLM responds with text and no tool calls
- **THEN** `AgentResponse.Final` is emitted with the response text

#### Scenario: Multi-turn with tools
- **WHEN** the LLM responds with a tool call
- **THEN** the tool is executed, result returned to LLM, and the loop continues

#### Scenario: Max steps exceeded
- **WHEN** the loop reaches maxSteps without a final answer
- **THEN** `AgentResponse.Error` is emitted

#### Scenario: Persona and memory are available before first LLM call
- **GIVEN** persona or memory injection is enabled for the current workspace
- **WHEN** the Agent runner builds the initial LLM messages
- **THEN** the system message includes the injected persona and memory prompt section
- **AND** the first LLM call receives the enhanced instructions

### Requirement: Context compression strategy interface
The system SHALL define `ContextCompressStrategy` interface with configurable implementations.

#### Scenario: Round truncation strategy
- **WHEN** `compressStrategy` is set to `RoundTruncationStrategy` with `maxRounds = 5`
- **THEN** messages older than the last 5 conversation rounds are discarded

#### Scenario: Token window strategy
- **WHEN** `compressStrategy` is set to `TokenWindowStrategy` with `maxTokens = 4096`
- **THEN** messages exceeding the token limit are trimmed from the earliest

#### Scenario: Strategy switchable via config
- **WHEN** `AgentConfig.compressStrategy` is changed
- **THEN** the new strategy takes effect on the next message without restart

### Requirement: Agent context carries platform reference
The system SHALL include `Platform` and `MessageSession` references in `AgentContext`, enabling built-in tools like `EarlyReplyTool` to send messages.

#### Scenario: Tool sends early reply
- **WHEN** a tool needs to send a proactive message during the loop
- **THEN** it retrieves the Platform and MessageSession from AgentContext and calls `platform.sendMessage()`

#### Scenario: Context carries persona and memory injection trace
- **GIVEN** persona and memory injection ran while preparing the Agent context
- **WHEN** Agent hooks, tools, or Dashboard chat response builders inspect the context metadata
- **THEN** they can read the injected persona id and injected memory result metadata

### Requirement: Context compression strategies SHALL be safe to execute

Configured context compression strategies SHALL compress conversation history without crashing the Agent loop for supported strategy names.

#### Scenario: LLM compression falls back safely

- **GIVEN** an Agent uses the `llm_compress` strategy
- **AND** the message history exceeds the configured context budget
- **WHEN** the context manager compresses the history
- **THEN** compression SHALL complete without throwing `NotImplementedError`
- **AND** the compressed result SHALL keep the system message when one is provided
- **AND** the compressed result SHALL preserve recent messages within the configured budget

#### Scenario: Strategy name remains observable

- **WHEN** the `llm_compress` strategy is inspected
- **THEN** its strategy name SHALL remain `llm_compress`

### Requirement: ReActRunner SHALL have unit test coverage for core state transitions
`ReActRunner` behavior SHALL be covered by deterministic unit tests for final responses, tool-call loops, provider failures, tool failures, max-step limits, and terminal states.

#### Scenario: Final response without tool call is tested
- **WHEN** a fake provider returns assistant text without tool calls
- **THEN** a unit test SHALL verify `ReActRunner` emits `AgentResponse.Final` and transitions to `DONE`

#### Scenario: Tool-call loop is tested
- **WHEN** a fake provider first returns a tool call and later returns a final response after receiving the observation
- **THEN** a unit test SHALL verify assistant and tool messages are appended before the loop continues

#### Scenario: Tool failure observation is tested
- **WHEN** the tool executor returns or throws a tool failure during a tool call
- **THEN** a unit test SHALL verify the failure is converted into an observation that the Agent loop can pass back to the provider

#### Scenario: Provider exception is tested
- **WHEN** the provider throws during an Agent step
- **THEN** a unit test SHALL verify `ReActRunner` emits `AgentResponse.Error` and transitions to `ERROR`

#### Scenario: Max steps exceeded is tested
- **WHEN** the fake provider keeps returning tool calls until `maxSteps` is exceeded
- **THEN** a unit test SHALL verify `ReActRunner` emits `AgentResponse.Error`

#### Scenario: Terminal state step behavior is tested
- **WHEN** `step()` is called after the runner is already `DONE` or `ERROR`
- **THEN** a unit test SHALL verify the runner does not restart the message chain or duplicate side effects

### Requirement: Context compression SHALL have unit test coverage
Context compression behavior SHALL be covered by deterministic unit tests for round truncation, token window, and LLM compression fallback behavior.

#### Scenario: Round truncation is tested
- **WHEN** conversation history exceeds the configured round count
- **THEN** a unit test SHALL verify only the allowed recent rounds remain

#### Scenario: Token window is tested
- **WHEN** conversation history exceeds the configured token budget
- **THEN** a unit test SHALL verify older messages are trimmed while required system context is preserved

#### Scenario: LLM compression fallback is tested
- **WHEN** LLM compression cannot call a provider or returns an unusable result
- **THEN** a unit test SHALL verify fallback compression completes without crashing the Agent loop

### Requirement: Agent tool timeout SHALL be honored
The Agent loop SHALL pass the configured tool timeout to tool execution so tool calls cannot block an Agent run indefinitely.

#### Scenario: Agent timeout config reaches executor
- **GIVEN** an Agent has `toolTimeoutMs` configured
- **WHEN** the Agent loop executes a tool call
- **THEN** the configured timeout SHALL be passed to `ToolExecutor`

#### Scenario: Tool timeout produces observable event
- **GIVEN** a tool call exceeds `toolTimeoutMs`
- **WHEN** the Agent loop receives the timeout result
- **THEN** the loop SHALL append the timeout observation for the model
- **AND** tool start/end events SHALL expose the timeout status

#### Scenario: Missing timeout uses runtime default
- **GIVEN** an Agent does not configure `toolTimeoutMs`
- **WHEN** the Agent loop executes a tool call
- **THEN** the runtime default tool timeout SHALL be used

### Requirement: Tools declare parallel safety and the runner honours it
The system SHALL let a tool declare whether it is safe to run concurrently, and a preset MAY configure a ceiling on concurrent parallel-safe calls within one step. Mutating calls SHALL retain submission order and SHALL NOT run concurrently with other calls.

#### Scenario: Parallel-safe calls overlap
- **WHEN** one step returns several calls whose tools declare parallel safety acceptable
- **THEN** they SHALL be dispatched concurrently, bounded by the preset's ceiling

#### Scenario: Mutating calls stay ordered and exclusive
- **WHEN** one step returns a call whose tool does not declare parallel safety
- **THEN** it SHALL run alone, in submission order, without overlapping any other call

#### Scenario: Observations stay in submission order
- **WHEN** parallel-safe calls complete in an order different from their submission order
- **THEN** the appended observations SHALL still follow submission order so the transcript is deterministic

#### Scenario: Serial presets are unaffected
- **WHEN** a preset declares no concurrency ceiling
- **THEN** every call SHALL run serially in submission order

#### Scenario: One failing call does not cancel its siblings
- **WHEN** one of several concurrent parallel-safe calls fails
- **THEN** each call SHALL still record its own result or failure, and the step SHALL continue

### Requirement: Context compression supports model summarization
The system SHALL provide a compression strategy that replaces the oldest balanced span of conversation with a model-generated structured summary when context pressure requires it, preserving the current request and never splitting a tool call from its result.

#### Scenario: Current request is never summarized
- **WHEN** summarization runs
- **THEN** the current request SHALL remain verbatim in the context

#### Scenario: Tool exchanges stay intact
- **WHEN** the summarized span is selected
- **THEN** it SHALL NOT contain a tool call without its corresponding result

#### Scenario: Replacement is marked as generated
- **WHEN** a span is replaced by a summary
- **THEN** the replacement SHALL be identifiable as a generated checkpoint rather than user or assistant content

#### Scenario: Oversized tool observations are pruned first
- **WHEN** a tool observation exceeds the configured pruner threshold
- **THEN** it SHALL be replaced by a bounded head and tail around an explicit prune marker before summarization input is assembled

#### Scenario: Falls back when summarization is unavailable
- **WHEN** the summarization model call fails
- **THEN** the run SHALL continue using the existing truncation behaviour rather than failing the message
