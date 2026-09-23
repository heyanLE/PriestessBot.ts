## ADDED Requirements

### Requirement: Platform adapters expose scoped tool contributions
The Platform abstraction SHALL allow adapters to expose platform-native tools while keeping authentication and transport inside the adapter.

#### Scenario: Adapter contributes no tools by default
- **WHEN** a Platform does not implement tool contributions
- **THEN** its message runs receive no additional platform-native tools

#### Scenario: Tool cannot access adapter credentials
- **WHEN** a contributed tool executes
- **THEN** it calls a typed adapter action
- **AND** the tool context, result, prompt, and logs do not expose adapter credentials

### Requirement: NapCat preserves native event identifiers
NapCat SHALL map OneBot message, group, sender, file, image, and mention identifiers into the unified event model needed by current-session actions.

#### Scenario: Group event metadata is complete
- **WHEN** a NapCat group event is parsed
- **THEN** the event contains sender ID, group ID, self ID when present, and message ID
