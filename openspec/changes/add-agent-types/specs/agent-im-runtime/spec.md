## MODIFIED Requirements

### Requirement: Agent configuration selects one type

The v3 Agent authoring field SHALL be `type`. A legacy `preset` field MAY be read as an alias for `type` during migration, but the system SHALL write only `type` in new configuration output.

#### Scenario: Old v3 file is read
- **WHEN** an existing Agent contains `"preset":"DEEPSEEK_HARNESS"`
- **THEN** it resolves to type `DEEPSEEK_HARNESS`
- **AND** the projected Agent keeps the same internal behavior
