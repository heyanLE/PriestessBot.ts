## MODIFIED Requirements

### Requirement: Every provider-bound tool result uses one materialization policy
The system SHALL evaluate the payload of every provider-bound tool result from every tool source before appending it to Agent conversation history.

#### Scenario: Small result stays compatible
- **WHEN** a success output or failure error is within the inline token budget
- **THEN** the original payload SHALL be appended unchanged

#### Scenario: Oversized success is referenced
- **WHEN** a successful tool output exceeds the inline token budget
- **THEN** the complete output SHALL be stored temporarily and the provider SHALL receive only a bounded preview and conversation-scoped result reference

#### Scenario: Oversized failure is referenced
- **WHEN** a failed, denied, timed-out, or execution-error payload exceeds the inline token budget
- **THEN** it SHALL use the same temporary reference protocol while preserving structured failure metadata outside the observation text

#### Scenario: All tool sources converge
- **WHEN** an oversized result originates from a built-in, platform, plugin, Workspace, or MCP tool
- **THEN** no source-specific materialization implementation SHALL be required

### Requirement: Referenced tool results are temporary, bounded, and private
The system SHALL write referenced UTF-8 payloads beneath a runtime-owned temporary directory and expose only opaque identifiers.

#### Scenario: Conversation ownership is enforced
- **WHEN** another conversation requests a valid result ID
- **THEN** it SHALL receive the same not-found response as an unknown ID

#### Scenario: Capacity or expiry removes availability
- **WHEN** a result expires or storage capacity evicts it
- **THEN** its file and metadata SHALL be removed and subsequent reads SHALL return not found

#### Scenario: Runtime closes
- **WHEN** runtime shutdown closes the store
- **THEN** every stored file and the managed temporary directory SHALL be removed

### Requirement: One bounded tool retrieves referenced results
The system SHALL expose `read_tool_result` with `result_id`, Unicode code-point `offset`, and bounded `limit` parameters.

#### Scenario: Owner reads subsequent windows
- **WHEN** the owner requests successive offsets
- **THEN** each response SHALL contain the selected content, total size, current offset, next offset, and whether more content remains

#### Scenario: Retrieval remains context safe
- **WHEN** a requested limit exceeds the reader ceiling
- **THEN** the reader SHALL clamp it and SHALL NOT recursively produce another oversized result

### Requirement: Tool-result settings are validated
The configuration compiler SHALL reject non-positive budgets, preview budgets above inline budgets, and total storage capacity below the per-result limit.
