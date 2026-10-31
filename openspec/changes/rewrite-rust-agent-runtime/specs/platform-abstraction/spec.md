## MODIFIED Requirements

### Requirement: Platform abstract base class
The Rust runtime SHALL define a PlatformAdapter trait with lifecycle, normalized event delivery, message sending, optional edit/stream updates and capability metadata.

#### Scenario: Platform starts listening for messages
- **WHEN** a configured adapter starts
- **THEN** it SHALL normalize native messages into platform-scoped events.

#### Scenario: Platform sends a message
- **WHEN** the reply service supplies unified content
- **THEN** the adapter SHALL deliver supported content to the correct conversation and return native delivery identifiers.

#### Scenario: Platform terminates gracefully
- **WHEN** an adapter stops
- **THEN** it SHALL stop intake and close connections without abandoning tracked delivery outcomes.

### Requirement: Unified message event model
The system SHALL preserve text, images, files, mentions, replies and trustworthy sender/session metadata in a serializable Rust message model. Audio and voice SHALL remain outside this release.

#### Scenario: Text message received from Telegram
- **WHEN** Telegram supplies text
- **THEN** a normalized event SHALL preserve the text and original identity.

#### Scenario: Image message received from NapCat
- **WHEN** NapCat supplies an image
- **THEN** the event SHALL retain an authorized resolvable image reference and media metadata through the model input path.

### Requirement: Platform registry via annotations
The Rust runtime SHALL register platform factories and capability descriptors through a code-owned registry rather than JVM annotations.

#### Scenario: All registered platforms listed
- **WHEN** management requests supported platforms
- **THEN** it SHALL receive registered adapters and their actual content, reply and streaming capabilities.

## ADDED Requirements

### Requirement: Streaming capability fallback
Adapters SHALL implement bounded streaming updates according to their native capabilities or provide an explicit final-message fallback.

#### Scenario: Platform cannot edit messages
- **WHEN** an Agent streams on a platform without edit support
- **THEN** the reply service SHALL send bounded chunks or a final complete message without producing one message per token.



### Requirement: Bounded authorized media preparation
The gateway SHALL resolve image/file attachments only after an Agent is selected and Read permission is granted. It SHALL verify original message ownership, bound downloads and decoding, exclude audio/voice, and preserve prepared content provenance without leaking credential-bearing download URLs into model input.

#### Scenario: File-only message
- **WHEN** an authorized route selects an Agent for a supported text or PDF attachment without a caption
- **THEN** the Agent SHALL receive the extracted content and file provenance.

#### Scenario: Cancel during media preparation
- **WHEN** an active session is stopped while downloading or parsing an attachment
- **THEN** preparation SHALL stop and no subsequent model turn SHALL start for that request.

#### Scenario: Uncertain preview edit
- **WHEN** an edit loses its acknowledgement
- **THEN** the ledger SHALL retain an uncertain outcome and no automatic replacement message SHALL repeat the content.

#### Scenario: Custom graph reply
- **WHEN** the Agent result does not lead directly to an unchanged Reply node
- **THEN** intermediate model text SHALL NOT bypass the graph's reply policy.


### Requirement: Platform-specific Markdown presentation
Telegram SHALL convert supported Markdown to escaped MarkdownV2 with balanced page boundaries. NapCat SHALL default to readable text and SHALL offer segmented, final and whole-document image policies. Normal native image/file components SHALL bypass Markdown parsing.

#### Scenario: Private Telegram streaming
- **WHEN** a private chat supports draft previews
- **THEN** previews SHALL remain ephemeral and completion SHALL send one persistent message per completed segment without treating draft acknowledgement as final delivery.

#### Scenario: Incomplete Markdown
- **WHEN** a stream ends temporarily inside a code fence, table, reference or mutable trailing paragraph
- **THEN** irreversible chunks SHALL wait for a stable presentation boundary while editable previews remain well formed.

#### Scenario: Confirmed format rejection
- **WHEN** the platform definitively rejects formatted content
- **THEN** a plain-text fallback MAY be sent and SHALL be audited separately; a network timeout or lost acknowledgement SHALL NOT trigger a duplicate persistent send.

#### Scenario: Unavailable image renderer
- **WHEN** configured document-to-image output cannot render all required glyphs or exceeds its resource limits
- **THEN** the complete readable text SHALL be delivered instead of dropping content.
