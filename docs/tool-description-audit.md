# Tool description audit

The 2026-10-31 audit applies the clarity principles in [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf). It uses short instructions, one action per sentence, and consistent terms. This is an adaptation for model tool contracts. It is not a claim of full STE vocabulary compliance or certification.

## Description contract

Each description states the operation, resource scope, relevant side effects, and the next action when needed. Parameter descriptions identify the expected value, its source, and the meaning of `null`, an empty string, or a cursor. Resource IDs are not interchangeable.

Descriptions supplement validation and authorization. They do not grant permissions. A successful tool call does not by itself establish that the whole user task succeeded.

## Audited model-facing surfaces

| Surface | Definitions | Changes |
| --- | --- | --- |
| Core tools | `packages/adapters/src/agents/tools.ts` | File zones, process IDs, result IDs, skills, memory, history, and delegation are maintained with the workspace and skill changes. |
| Search | `packages/adapters/src/search/index.ts` | Four names/aliases. Separate search summaries, fetched page text, and downloaded files. Explain truncation and provider failures. |
| QQ tools | `packages/adapters/src/plugins/qq-file.ts`, `packages/contracts/src/plugins/qq-file.ts` | Twelve tools. Explain group scope, file/folder/notice IDs, pagination, partial deletion, upload sources, and temporary URLs. |
| Bilibili | `packages/adapters/src/plugins/bilibili.ts` | Ten tools. Explain resource ID types, video parts, comments, subtitle/transcription modes, and subscription scope. |
| Bangumi | `packages/adapters/src/plugins/bangumi.ts` | Nine tools. Separate subject, episode, character, person, and account identifiers. Explain calendar values, collection writes, and subscriptions. |
| Local reminiscence | `packages/adapters/src/plugins/reminiscence.ts` | Seven tools. Explain sender/conversation/Agent scope, record IDs, replacement effects, dates, and job completion. |
| MCP | `packages/adapters/src/agents/mcp.ts` | Provider-authored descriptions and schemas are preserved. Tools are namespaced and authorized at runtime. The application cannot guarantee the quality of external descriptions. |
| Native extensions | `packages/adapters/src/extensions/index.ts` | Manifest-authored operation and field descriptions are preserved. Authors should follow the description contract above. The manifest remains the source of truth. |

Plugin settings descriptions and Dashboard labels are separate from the model's tool definitions. The audit does not translate arbitrary third-party manifests or modify configured MCP servers.

## Fetch diagnostics

Search and fetch tool failures include a safe `code` and an actionable `error` string. The result does not include provider response bodies, credentials, internal addresses, or raw network exceptions.

| Code | Meaning | Next action |
| --- | --- | --- |
| `provider_http` | The configured provider returned a non-success HTTP status. This is not proof of the source page's status. | Use another source or report the provider failure. |
| `provider_transport`, `provider_timeout` | The provider connection failed or timed out. | Retry once or use another source. |
| `provider_body`, `provider_json`, `provider_schema` | The provider response could not be read within the limit, was not JSON, or did not match the expected format. | Use another source or report the provider failure. |
| `invalid_url`, `dns_failed`, `blocked_destination` | The URL is invalid, DNS failed, or at least one resolved address is disallowed. | Correct the URL or use another public source. Do not bypass address checks. |
| `cancelled`, `request_failed` | The run stopped or another validation/access check failed. | Read the error and stop claiming success. |

These diagnostics do not repair unavailable upstream pages, network resolution, or missing execution-image dependencies. They give the model enough information to choose a different action instead of repeating an unchanged failed call.

## Verification

Focused regression coverage includes provider status versus source status, transport errors, bounded response failures, invalid JSON/schema, DNS failures, mixed public/reserved DNS answers, timeout versus cancellation, and secret redaction. Existing QQ protocol, Bilibili, Bangumi, and reminiscence behavior tests cover unchanged side effects and authorization.
