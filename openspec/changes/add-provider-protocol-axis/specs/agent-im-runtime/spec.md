## ADDED Requirements

### Requirement: Agent LLM references preserve the connection protocol

An Agent's LLM reference SHALL resolve to an effective connection that includes its declared or vendor-default wire protocol. The runtime SHALL NOT infer a different protocol from the model name or endpoint path.

#### Scenario: Agent selects a Responses connection
- **WHEN** an Agent references an enabled OpenAI-compatible connection with `protocol = OPENAI_RESPONSES`
- **THEN** the effective Agent sees that protocol on its resolved provider connection
- **AND** the internal provider uses the Responses adapter when that Agent runs
