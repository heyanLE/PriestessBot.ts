# platform-abstraction Specification

## Purpose
TBD - created by archiving change priestess-v1-core. Update Purpose after archive.

> TypeScript requirements apply to runtime `priestess-ts`. Unmodified Kotlin/workspace-specific requirements below remain reference requirements for the legacy runtime.

## Requirements

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

### Requirement: Telegram platform adapter
The system SHALL provide a `TelegramPlatform` that connects via Telegram Bot API with long polling support.

#### Scenario: Telegram bot receives a message
- **WHEN** a Telegram user sends a message to the bot
- **THEN** the message is parsed into a `MessageEvent` and committed to the EventBus

#### Scenario: Telegram bot sends a reply
- **WHEN** `sendMessage()` is called with a text chain
- **THEN** the bot sends the message to the correct Telegram chat

### Requirement: NapCat platform adapter
The system SHALL provide a `NapCatPlatform` that connects to NapCat via HTTP API using IP and port configuration only.

#### Scenario: NapCat platform connects to QQ
- **WHEN** NapCat is running and the IP/port configuration is correct
- **THEN** the platform connects via HTTP API and receives QQ messages as `MessageEvent`

#### Scenario: NapCat sends a reply to QQ
- **WHEN** `sendMessage()` is called with a message chain
- **THEN** the message is sent to the correct QQ chat via NapCat HTTP API

### Requirement: Platform runtime management
The system SHALL expose configured platform status and allow runtime enable/disable through management APIs.

#### Scenario: Platform status exposed
- **WHEN** a dashboard client requests platform status
- **THEN** configured platforms include whether their adapter is currently running

#### Scenario: Platform disabled through API
- **WHEN** a dashboard client disables a platform
- **THEN** the platform config is updated
- **AND** the platform controller stops the adapter

#### Scenario: Plugin platform metadata exposed
- **GIVEN** a plugin has registered a platform adapter
- **WHEN** platform metadata is requested from the registry
- **THEN** the plugin-provided platform metadata is returned

#### Scenario: Plugin platform created from config
- **GIVEN** a plugin has registered a platform adapter
- **WHEN** a matching enabled `PlatformConfig` is used
- **THEN** the platform adapter can be created through `PlatformRegistry.createFromConfig`

### Requirement: Sender identity metadata
Every inbound adapter SHALL expose the real sender as a validated principal distinct from chat/session identity, preserving a compatibility senderId projection where required.

#### Scenario: Group identity
- **WHEN** a group event contains different sender and group IDs
- **THEN** authorization SHALL use the sender identity and routing SHALL retain the independent group ID

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
