## ADDED Requirements

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
