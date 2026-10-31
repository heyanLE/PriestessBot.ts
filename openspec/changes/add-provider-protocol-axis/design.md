## Decisions

`WireProtocol` is a closed vocabulary independent of the provider vendor: `OPENAI_CHAT_COMPLETIONS`, `OPENAI_RESPONSES`, `ANTHROPIC_MESSAGES`, `GEMINI_GENERATE_CONTENT`, `OLLAMA_CHAT`. An omitted protocol resolves to the vendor's existing behavior. A known vendor rejects a protocol outside its supported set; unknown plugin vendors may continue using their own adapter.

The internal OpenAI adapter shares URL, bearer authentication and `/models` handling across both wire formats. Responses uses `/responses`, maps system text to `instructions`, maps text and function exchanges into `input[]`, unwraps function schemas, sends `store=false`, and flattens text, function calls and token usage back into `LLMResponse`. It intentionally drops reasoning items and `encrypted_content`, hosted tools and multimodal items because the common DTO has no representation for them. This is an explicit fidelity boundary for internal Agents, not a constraint on Codex's native Responses path.

| Shared runtime value | Responses mapping |
|---|---|
| System text | `instructions` |
| User and assistant text | `input[]` message with `input_text` or `output_text` |
| Assistant tool call | `input[]` `function_call` with call id, name and arguments |
| Tool result | `input[]` `function_call_output` with call id and output |
| Tool schema | `tools[]` function declaration |
| Temperature and output limit | `temperature` and `max_output_tokens` |
| Model text and function calls | `output[]` message text and `function_call` items |
| Token use | `usage.input_tokens`, `output_tokens`, `total_tokens` |
| Incomplete response | `status` and `incomplete_details` mapped to finish reason |
| Reasoning, `encrypted_content`, hosted tools, images, audio | Intentionally omitted from shared DTO |

The external engine consumes the effective connection's endpoint, protocol and guarded secret through a single native bootstrap path. It must not serialize the secret in dashboard views or Codex config files. Codex's fork accepts an explicit custom Responses provider without account login; P5 still must audit rollout and log persistence before using a real token.

The Dashboard gets protocol choices from `/api/provider-protocols`; it does not maintain an independent capability matrix. The server's config decoder and compiler validate the field before activation. Connectivity testing remains a `/models` request and cannot certify Responses compatibility without a billable model call.
