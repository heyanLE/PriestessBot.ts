## ADDED Requirements

### Requirement: OpenAI-compatible connections select their wire API

The system SHALL let an OpenAI-compatible provider connection select the wire protocol it speaks, through the connection's `settings.wireApi` value. The supported values SHALL be `chat` and `responses`, and an absent value SHALL mean `chat` so that every existing connection keeps its current behaviour.

#### Scenario: Absent selection keeps the chat wire API
- **WHEN** an OpenAI-compatible connection does not set `wireApi`
- **THEN** it SHALL use the Chat Completions wire API
- **AND** its request and response shapes SHALL be unchanged from before this capability existed

#### Scenario: Responses wire API is selected
- **WHEN** an OpenAI-compatible connection sets `wireApi` to `responses`
- **THEN** its requests SHALL be sent to the Responses operation under the configured base URL

#### Scenario: Unknown wire API is rejected
- **WHEN** a connection sets `wireApi` to a value that is not a supported wire API
- **THEN** provider validation SHALL report an error naming the connection and the value
- **AND** the connection SHALL NOT be activated

#### Scenario: Wire API is observable
- **WHEN** an operator inspects a provider connection
- **THEN** the resolved wire API SHALL be reported on the provider metadata and the redacted connection view

### Requirement: Responses API mapping preserves the lossless subset

The system SHALL map the runtime's provider request and response types to and from the Responses API for the concepts they can express, and SHALL NOT claim fidelity for concepts they cannot.

#### Scenario: Messages map to Responses input
- **WHEN** a request carries a system message, user and assistant text, an assistant tool call, and a tool result
- **THEN** the system message SHALL be sent as `instructions`
- **AND** the remaining messages SHALL be sent as `input` items of the corresponding kind, with tool exchanges carrying their call identifier

#### Scenario: Tools map without changing the runtime schema model
- **WHEN** a request carries tools in the runtime's chat-completions wrapper
- **THEN** the adapter SHALL unwrap them into the Responses function-tool declaration
- **AND** the runtime's tool schema type SHALL NOT be modified

#### Scenario: Output items map back
- **WHEN** a Responses reply contains message text parts and function-call items
- **THEN** the text SHALL be concatenated into the response content
- **AND** each function call SHALL become a runtime tool call carrying its call identifier, name and arguments

#### Scenario: Usage maps
- **WHEN** a Responses reply reports usage
- **THEN** input, output and total tokens SHALL be populated on the runtime's token usage

#### Scenario: Reasoning and hosted-tool items do not round-trip
- **WHEN** a Responses reply contains reasoning items, encrypted reasoning content, or hosted-tool items
- **THEN** those items SHALL be ignored without failing the request
- **AND** they SHALL NOT be replayed in a subsequent request
- **AND** this limitation SHALL be documented for operators

#### Scenario: Malformed reply fails as a provider error
- **WHEN** a Responses reply has a non-success status or cannot be parsed
- **THEN** the call SHALL fail through the same provider error path the chat wire API uses

## MODIFIED Requirements

### Requirement: OpenAI provider adapter

The system SHALL provide `OpenAIProvider` that implements the OpenAI Chat Completions API, and SHALL also support the OpenAI Responses API on the same adapter when a connection selects it. Provider identity, endpoint resolution, credential handling and model listing SHALL be shared across both wire APIs.

#### Scenario: Basic chat completion
- **WHEN** `textChat()` is called with a user message over the chat wire API
- **THEN** the OpenAI API returns a completion with the assistant's response text

#### Scenario: Function calling
- **WHEN** `textChat()` is called with tools defined and the model decides to invoke a tool
- **THEN** the `LLMResponse` contains tool calls with function name and arguments

#### Scenario: Basic completion over the Responses wire API
- **WHEN** `textChat()` is called with a user message over the Responses wire API
- **THEN** the response content and token usage SHALL be populated from the Responses reply

#### Scenario: Function calling over the Responses wire API
- **WHEN** `textChat()` is called with tools defined over the Responses wire API and the model invokes a tool
- **THEN** the `LLMResponse` SHALL contain equivalent tool calls with function name and arguments

#### Scenario: OpenAI-compatible services
- **WHEN** the base URL is configured to a compatible service (e.g., DeepSeek, Qwen) and the connection selects the wire API that service speaks
- **THEN** the provider works without code changes

#### Scenario: Model listing is wire-API independent
- **WHEN** `getModels()` is called on a Responses-wire connection
- **THEN** the model catalog SHALL be read from the models operation under the configured base URL
