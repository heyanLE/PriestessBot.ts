## MODIFIED Requirements

### Requirement: Platform abstract base class
The system SHALL define a strongly typed PlatformAdapter contract for start/receive/send/stop and optional edit/stream capabilities. All adapters SHALL convert validated protocol payloads into the common event model.

#### Scenario: Platform starts listening
- **WHEN** a configured adapter starts
- **THEN** it SHALL publish validated events with trusted identity through the shared ingress

#### Scenario: Platform sends a message
- **WHEN** delivery requests a typed reply
- **THEN** the adapter SHALL send to the exact target and return a typed delivery outcome

#### Scenario: Platform terminates gracefully
- **WHEN** shutdown begins
- **THEN** the adapter SHALL stop accepting new events and close protocol resources cleanly

### Requirement: Unified message event model
The system SHALL represent identity, text, images, files, mentions, quotes and references with explicit TypeScript domain types and validated media references. Audio/voice processing SHALL be unavailable in this release.

#### Scenario: Telegram text message
- **WHEN** a Telegram text message is accepted
- **THEN** the normalized event SHALL retain sender, chat, message identity and text content

#### Scenario: NapCat image
- **WHEN** a valid NapCat image message is accepted
- **THEN** the event SHALL retain image information usable by the media pipeline rather than only an image placeholder

### Requirement: Platform registry via annotations
The system SHALL register adapters through typed code-defined factories with versioned capability metadata; language-specific annotations SHALL no longer be required.

#### Scenario: Available adapters
- **WHEN** platform metadata is requested
- **THEN** only registered adapters and their actual supported capabilities SHALL be returned

### Requirement: Sender identity metadata
Every inbound adapter SHALL expose the real sender as a validated principal distinct from chat/session identity, preserving a compatibility senderId projection where required.

#### Scenario: Group identity
- **WHEN** a group event contains different sender and group IDs
- **THEN** authorization SHALL use the sender identity and routing SHALL retain the independent group ID

## ADDED Requirements

### Requirement: Capability-aware streaming delivery
Streaming replies SHALL use throttled edits where supported and configured chunk/final fallback otherwise. Delivery MUST track confirmed and uncertain outcomes and avoid replaying completed effects.

#### Scenario: Platform lacks edits
- **WHEN** a streamed result targets a platform without editing support
- **THEN** delivery SHALL use the configured bounded chunk or final-message strategy

#### Scenario: Uncertain send
- **WHEN** transport failure leaves send success unknown
- **THEN** delivery SHALL record uncertainty rather than blindly send the same message again

### Requirement: Reference-based platform qualification
Telegram, NapCat and WeChat iLink SHALL be the first migration targets. Additional AstrBotX adapters SHALL receive explicit protocol fixtures and integration qualification before being advertised as supported.

#### Scenario: Metadata-only adapter
- **WHEN** a proposed platform has no working transport implementation
- **THEN** it SHALL not appear as an enabled supported connection
