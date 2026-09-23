## ADDED Requirements

### Requirement: Personas own ordered example-dialog pairs
The system SHALL let a Persona store an ordered list of user/assistant example pairs, defaulting to an empty list.

#### Scenario: Existing Persona has no examples
- **WHEN** an existing row or API request does not provide example dialogs
- **THEN** the Persona SHALL load and save with an empty example list

#### Scenario: Invalid example is rejected
- **WHEN** either side of a pair is blank, a message exceeds 8,000 characters, or the Persona contains more than 20 pairs
- **THEN** the Persona save SHALL fail validation

### Requirement: Example dialogs preserve chat roles during injection
The system SHALL expand every selected Persona example into one user message followed by one assistant message.

#### Scenario: Persona and history are both present
- **WHEN** an active Persona has examples and the conversation has stored history
- **THEN** the provider message order SHALL be system prompt, Persona examples in configured order, stored history, and current user turn

#### Scenario: Persona is absent or has no examples
- **WHEN** no eligible Persona is resolved or its example list is empty
- **THEN** message assembly SHALL remain compatible with the existing behavior

### Requirement: Example dialogs remain configuration-only
The system SHALL NOT persist Persona example messages as conversation messages.

#### Scenario: A request completes
- **WHEN** a request using Persona examples is persisted
- **THEN** only real request, response, and eligible tool-traffic messages SHALL be written to conversation history

### Requirement: Dashboard manages example dialogs
The Persona API and Dashboard SHALL round-trip, add, remove, edit, and reorder example-dialog pairs.

#### Scenario: User edits examples
- **WHEN** the user saves a Persona with reordered or edited pairs
- **THEN** a subsequent Persona read SHALL return the same normalized order and content
