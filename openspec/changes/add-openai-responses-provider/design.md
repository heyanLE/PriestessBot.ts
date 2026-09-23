## Context

The provider layer is uniform in a way that makes this change small: every adapter implements one method, `textChat(LLMRequest): LLMResponse`, and the internal loop is non-streaming.

```kotlin
// provider/Provider.kt:40-52
interface ChatProvider : Provider {
    suspend fun textChat(request: LLMRequest): LLMResponse
    suspend fun getModels(): List<String>
}
```

`OpenAIProvider` currently hardcodes the chat-completions shape in three places: the URL (`chatCompletionsUrl`, `:39-44`), the request body (`:62-93`) and the response parse (`:119+`). Auth (`Bearer`), base-URL handling and `/models` are provider-level, not wire-level.

Two internals matter for the mapping:

```kotlin
// provider/model/ConversationMessage.kt:8-21 — chat-completions shaped
data class ConversationMessage(role, content: String?, toolCalls: List<ToolCall>?, toolCallId: String?, name: String?)

// provider/model/LLMResponse.kt — chat-completions shaped
data class LLMResponse(content: String, toolCalls: List<ToolCall>, finishReason: String, tokenUsage: TokenUsage)
```

There is no `developer` role, no multimodal content parts, no output-item list, and no place to carry reasoning.

The connection settings already reach the provider:

```kotlin
// provider/ProviderController.kt:56-63 and :88-95
val config = ProviderConfig(..., config = connection.settings, ...)
```

`ProviderConnectionDocument.settings` is a free-form `Map<String, String>` (`AppConfigDocument.kt:96-103`), so a wire-API selection needs no new document field, no new enum in the config schema, and no Dashboard data-model change beyond a select control.

Finally, and decisively for the scope of this change: **the Codex path does not use this DTO layer.** Codex builds and parses its own Responses requests; what it needs from a priestess provider connection is the endpoint, the credential and the wire API, so it can synthesize its own `model_providers` entry. The fidelity limits below therefore constrain only *internal* Agents that select a Responses model — they do not constrain the Codex engine.

## Goals / Non-Goals

**Goals:**

- Let an OpenAI-compatible connection speak the Responses API by configuration alone, with `chat` as the unchanged default.
- Preserve everything provider-level: identity, metadata, endpoint resolution, bearer auth, `/models`, `test()`.
- Make the fidelity boundary explicit and tested, so nobody discovers it in production.
- Give a later change (the Codex engine) a validated way to require a Responses-capable connection.

**Non-Goals:**

- No streaming. `LLMRequest.stream` exists but the internal loop and every adapter are synchronous; adding SSE is a separate concern.
- No DTO redesign. `ConversationMessage`, `LLMRequest` and `LLMResponse` keep their current shape.
- No reasoning round-trip and no `include: ["reasoning.encrypted_content"]`. See Decision 3.
- No multimodal input. `ConversationMessage.content` is a plain string.
- No new provider type in the Dashboard, no Codex engine, no change to how an Agent selects a provider.
- Does not modify `OpenAIProvider`'s existing chat-completions behaviour, URL derivation or tests.

## Decisions

### 1. A wire-API setting on the existing OpenAI-compatible type, not a new provider type

`settings.wireApi`: absent or `chat` → today's behaviour; `responses` → the new mapping. Validation rejects any other value before activation.

Rationale: the two wire APIs share endpoint handling, bearer auth, credential reference and the model-listing path. A new provider type would duplicate the connection editor, the credential wiring and the validation, and would make an operator choose a *type* to express what is really a *protocol* choice for the same service. `wire_api` is also the exact vocabulary Codex uses for the same decision, so operator documentation does not have to explain two names for one thing.

Alternative rejected: a new `openai-responses` registration. It is marginally more discoverable in the provider list, but it splits one service family across two config types and would leave `test()`, `getModels()` and redaction implemented twice or shared through an awkward base class.

Alternative rejected: infer the wire API from the endpoint path (e.g. a base URL ending in `/responses`). Implicit selection makes the protocol unpredictable and untestable, and an operator cannot opt in or out.

### 2. One provider class, a wire strategy behind it

`OpenAIProvider` keeps identity, `metadata`, endpoint derivation, auth, `getModels()` and `test()`. The wire-specific work is isolated behind a small internal strategy with two implementations:

- `chat`: the current request builder and parser, moved verbatim.
- `responses`: the new builder and parser.

Rationale: the alternative — a second `ChatProvider` implementation — would either duplicate the provider-level half or force the shared half into a base class for no benefit. Keeping the strategy internal means `ProviderMetadata.kind` stays `OPENAI` and no caller changes.

### 3. Fidelity boundary: the lossless subset, stated and tested

Mapped in both directions:

| Runtime concept | Responses API |
|---|---|
| `role = system` | `instructions` |
| `role = user` / `assistant` text | `input[]` `message` items with `input_text` / `output_text` |
| `role = assistant` + `toolCalls` | `input[]` `function_call` items (`call_id`, `name`, `arguments`) |
| `role = tool` (`toolCallId`) | `input[]` `function_call_output` items (`call_id`, `output`) |
| `LLMRequest.tools` | `tools[]` `{type:"function", name, description, parameters}` |
| `temperature`, `maxTokens` | `temperature`, `max_output_tokens` |
| `output[].type = "function_call"` | `LLMResponse.toolCalls` |
| `output[].type = "message"` text parts | `LLMResponse.content` |
| `status` / `incomplete_details` | `LLMResponse.finishReason` |
| `usage.input_tokens` / `output_tokens` / `total_tokens` | `LLMResponse.tokenUsage` |

Deliberately dropped: `output[].type = "reasoning"` items and their `encrypted_content`; `web_search_call` and other hosted-tool items; image and audio content parts.

Consequence, recorded as a limitation rather than a bug: when an internal Agent uses a reasoning model over the Responses API, the model's reasoning context is not carried between turns. Output text and tool calling are unaffected.

Alternative rejected: extend the shared DTOs with an opaque passthrough (e.g. `ConversationMessage.providerItems: List<JsonObject>?` plus `LLMResponse.rawOutput`), letting a provider stash and replay provider-specific structures. It buys full fidelity for internal reasoning models, at the cost of putting an OpenAI-specific structure into the model type every provider and every persistence path shares, and of making the transcript's shape depend on which provider produced it. Given that the Codex path does not need it (see Context), the cost is not justified here. If internal reasoning fidelity is later required, that is its own change with its own migration.

Alternative rejected: silently ignore the loss. The boundary is asserted by a test so a future adapter cannot claim more fidelity than it has.

Note that `LLMRequest.tools` already arrives in the chat-completions wrapper (`ToolSchema.toOpenAIFormat()` emits `{type:"function", function:{name, description, parameters}}`). The Responses builder unwraps it. This keeps the change inside the adapter and leaves `ToolSchema` — and therefore plugins compiled against it — untouched.

### 4. `getModels()` and `test()` stay on `/models`

The Responses API has no model-listing operation of its own, and `/v1/models` remains the standard discovery endpoint. So `modelsUrl` is unaffected by the wire choice and `test()` keeps its current implementation. This also means a Responses connection is not distinguishable from a chat one by connectivity testing alone; the operational view reports the wire API explicitly (Decision 5).

### 5. The wire API is observable, and a required property for external engines

The resolved wire API is exposed on the provider metadata view and the redacted connection view, so an operator can see which protocol a connection uses without reading `config.json`.

It is also the property the Codex engine will depend on: a connection that an external Codex Agent references must resolve to `responses`, because Codex cannot use it otherwise. This change adds the field and its validation; the engine change adds the requirement at the point where the engine actually needs it. Stating it here keeps the dependency one-directional: the engine depends on this change, not the reverse.

### 6. Validation and failure behaviour

- An unknown `settings.wireApi` value is a configuration error naming the connection and the bad value, reported before activation, consistent with how other enum-valued settings are handled.
- A Responses call that returns a non-2xx status, a malformed body, or no `output` array produces the same class of error the chat adapter produces today (the existing `readJsonBody` / parse error path), so error handling and trace recording do not special-case the wire API.
- Existing connections are untouched: absent `wireApi` means `chat`.

## Risks / Trade-offs

- **Two wire implementations in one class can drift.** Mitigated by keeping the split at the request/response strategy boundary and by pinning the existing chat-completions tests unchanged; the shared provider-level half has one implementation.
- **The fidelity boundary is a real functional gap for internal reasoning models.** Mitigated by documenting it in operator documentation and by the boundary being an explicit non-goal rather than an oversight. It is not fixed here.
- **A server that implements `/responses` partially will look healthy.** `test()` exercises `/models`, not `/responses`, so a connection can pass connectivity testing and still fail on first use. Mitigated by naming this in the documentation; a dedicated probe is possible but would send a billable model request on a connectivity check, which is not acceptable as a default.
- **`settings` is a free-form string map**, so a typo in the key (`wireAPI`, `wire_api`) would be silently ignored rather than rejected. Mitigated by rejecting unknown *values* and by documenting the exact key; a stricter settings schema is a broader change and out of scope.
- **Hosted Responses tools are dropped silently.** An operator expecting `web_search` over the Responses API will not get it. Recorded as a non-goal; the runtime's own `web_search` tool is unaffected.
