## 1. Wire API selection

- [ ] 1.1 Add a `WireApi` enum (`CHAT` default, `RESPONSES`) with config-name parsing, owned by the provider layer.
- [ ] 1.2 Read the selection from `ProviderConfig.config["wireApi"]` (projected from `ProviderConnectionDocument.settings`); absent means `CHAT`.
- [ ] 1.3 Reject an unknown value during provider validation with an error naming the connection and the value.
- [ ] 1.4 Expose the resolved wire API on the provider metadata view and the redacted connection view.
- [ ] 1.5 Tests: absent value resolves to `CHAT`; `chat` and `responses` resolve; an unknown value fails validation; existing connections are unaffected.

## 2. Extract the chat strategy without behaviour change

- [ ] 2.1 Move the current chat-completions request builder and response parser behind the wire strategy, verbatim.
- [ ] 2.2 Keep endpoint derivation, bearer auth, `getModels()` and `test()` at the provider level, shared by both strategies.
- [ ] 2.3 Confirm every existing `OpenAIProvider` test passes unchanged.

## 3. Responses request building

- [ ] 3.1 Resolve the request URL to `/responses` from the base URL, handling a base URL that already ends in `/responses` or `/chat/completions` the way the chat path handles its own suffix.
- [ ] 3.2 Map a system message to `instructions`; map user/assistant text and tool exchanges to `input[]` items (`message`, `function_call`, `function_call_output`).
- [ ] 3.3 Unwrap the runtime's chat-completions tool wrapper into Responses `{type:"function", name, description, parameters}`; do not modify `ToolSchema`.
- [ ] 3.4 Map `temperature` and `maxTokens` to `temperature` and `max_output_tokens`; send `store = false`.
- [ ] 3.5 Tests: a plain user turn; a system prompt; an assistant tool call; a tool result; tools present and absent; `maxTokens` absent.

## 4. Responses response parsing

- [ ] 4.1 Concatenate `output[].type = "message"` text parts into `content`.
- [ ] 4.2 Map `output[].type = "function_call"` to `ToolCall(id = call_id, name, arguments)`.
- [ ] 4.3 Map `usage.input_tokens` / `output_tokens` / `total_tokens` into `TokenUsage`.
- [ ] 4.4 Derive `finishReason` from `status` / `incomplete_details`.
- [ ] 4.5 Ignore `reasoning` and hosted-tool output items without failing.
- [ ] 4.6 Tests: text-only; tool call only; text plus tool call; usage mapping; `incomplete`; an output array containing only a reasoning item; a malformed body.

## 5. Fidelity boundary

- [ ] 5.1 Add a test asserting reasoning items and `encrypted_content` are not carried into `LLMResponse` and are not replayed in a subsequent request.
- [ ] 5.2 Document the boundary (text, function calls, function-call outputs and usage round-trip; reasoning and multimodal do not) in operator documentation.

## 6. Configuration surface

- [ ] 6.1 Add a wire-API select to the LLM connection editor, defaulting to `chat`, with only the label local and the available values reported by the server.
- [ ] 6.2 Extend `config.example.json` and `docs/configuration-v3.md` with a Responses connection example.
- [ ] 6.3 Extend client-side configuration validation with the same known-value check the server applies.

## 7. Verification

- [ ] 7.1 Run the full JVM suite; all pre-existing provider tests pass unchanged.
- [ ] 7.2 Verify against a live Responses-capable endpoint: a plain completion, a tool-calling turn, and token usage reported.
- [ ] 7.3 Verify the `chat` default against an existing OpenAI-compatible endpoint, confirming byte-compatible request shape.
- [ ] 7.4 `npm run build` (including `vue-tsc`) and the dashboard smoke tests pass.
