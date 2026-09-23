## Why

No provider in this project can talk to the OpenAI **Responses API**. `OpenAIProvider` builds `/chat/completions` only (`OpenAIProvider.kt:39-44, 53-103`), and every other adapter is Ollama, Anthropic or Gemini.

That became a hard blocker rather than a nice-to-have: Codex requires `wire_api = "responses"` and no longer accepts `"chat"`. The `chat/completions` wire API was deprecated in February 2026 and a configuration that still sets it fails at load time from v0.138 onward. Verified locally against `codex-cli 0.154.0-alpha.6.2`:

```
Error loading config.toml: `wire_api = "chat"` is no longer supported.
How to fix: set `wire_api = "responses"` in your provider config.
```

So a Codex agent cannot be backed by any provider this project can currently express, and an internal Agent cannot use a Responses-only hosted model either. This change adds the wire mode. It is sequenced before the Codex engine because the engine consumes a provider connection and requires this property of it.

There is also a documentation drift to settle: the `provider` capability promises "OpenAI-compatible services … the provider works without code changes" (`spec.md:33-35`). That promise now fails for any OpenAI-compatible service that has moved to the Responses API, or that only ever offered it.

## What Changes

- Add a **wire API** selection to the OpenAI-compatible provider connection: `settings.wireApi` with values `chat` (default, unchanged behaviour) and `responses`. The existing `openai` type keeps working with no configuration change.
- Implement the Responses request/response mapping behind that selection: build a Responses request from `LLMRequest`, and flatten the Responses `output` item list back into the existing `LLMResponse`.
- Keep the provider's identity, endpoint, credential handling and model listing path unchanged, so the Dashboard connection editor and credential resolution are untouched.
- State and test the fidelity boundary explicitly: text, function calls, function-call outputs and token usage round-trip; reasoning items and `reasoning.encrypted_content` do not.
- Expose the wire API so the operational surface can report it: provider metadata and the connection view name the wire API in use, and validation rejects an unknown value before activation.

## Capabilities

### New Capabilities

None. This extends an existing provider adapter rather than introducing a new one.

### Modified Capabilities

- `provider`: the OpenAI-compatible adapter gains a selectable wire API and a Responses-API implementation; the "OpenAI-compatible services work without code changes" expectation is narrowed to the wire API the connection selects.

## Impact

- Touches `ProviderConfig`/`ProviderConnectionDocument.settings`, `OpenAIProvider` (or a sibling Responses adapter it delegates to), `ProviderController`'s connection projection, provider validation, `docs/configuration-v3.md`, and `config.example.json`.
- New Ktor request/response mapping in the provider layer: `/responses` request construction and `output[]` item flattening. No new dependency.
- No change to `LLMRequest`/`LLMResponse`/`ConversationMessage` in this change. The consequence of that decision is recorded as an explicit, tested limitation rather than left implicit — see the design's Decision 3.
- No change to any existing provider's default behaviour: `chat` remains the default, so every current deployment and test is unaffected.
- Deliberately does not add: streaming, image/multimodal input, reasoning-item round-tripping, the Codex engine, or any change to how an Agent selects a provider.
