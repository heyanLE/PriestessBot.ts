## ADDED Requirements

### Requirement: An LLM connection declares its wire protocol

An LLM connection SHALL optionally declare a wire protocol separate from the provider vendor. Omission SHALL preserve the vendor's previous behavior. The server SHALL reject an unknown protocol and a known vendor/protocol combination it cannot serve.

#### Scenario: Existing OpenAI connection
- **WHEN** an OpenAI connection omits `protocol`
- **THEN** it uses `OPENAI_CHAT_COMPLETIONS` with the existing request shape

#### Scenario: Responses connection
- **WHEN** an OpenAI-compatible connection selects `OPENAI_RESPONSES`
- **THEN** its internal adapter sends `/responses` requests
- **AND** the resolved protocol is visible in a redacted connection view

### Requirement: Internal Responses mapping has an explicit fidelity boundary

The internal adapter SHALL map text, function calls, function results and usage into the shared LLM DTOs. It SHALL NOT claim that reasoning items, encrypted reasoning state, hosted tools or multimodal items round-trip through those DTOs.

#### Scenario: Function-call continuation
- **WHEN** a Responses model returns a function call and the internal Agent submits its result
- **THEN** the call id, name, arguments and output are preserved in the next request

#### Scenario: Reasoning item appears
- **WHEN** a Responses output includes a reasoning item or `encrypted_content`
- **THEN** the internal adapter ignores it without treating it as text or replaying it

### Requirement: Protocol choices are server-reported

The Dashboard SHALL obtain available protocol choices and defaults from the server and SHALL NOT maintain a separate vendor capability matrix.
