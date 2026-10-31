# Agent prompt and search alignment

The primary persona editor is the persona library. An Agent selects a library persona and can inspect its body and example turns; bound library fields are not duplicated as editable inline fields. Supplemental Agent instructions remain available in an advanced disclosure and are included before the selected persona. Unbinding activates the existing inline persona/examples/error response as an explicit fallback. Binding is saved independently with revision conflict checks; prompt previews use the current Agent draft and current saved binding. Library tool/skill restrictions remain intersections, never additional grants.

The effective prompt endpoint includes runtime message-source policy. Example dialogs are separate model-only messages, not conversation transcript entries. Real-time retrieved context, memory, knowledge and Skills depend on the caller and are identified as dynamic rather than fabricated in the static preview.

Search is an independent service, configured in `web-search/settings` with a revision. Defaults are disabled. Secrets are referenced by environment/managed-secret name and never returned. Configuration and tool capabilities:

| Provider | Search | Page content | Protocol |
| --- | --- | --- | --- |
| DeepSeek Search | `web_search`, `deepseek_search` | `web_fetch`, `deepseek_fetch` | configured base + `/v1/tools/search`, `/v1/tools/fetch`, Bearer key |
| Tavily | `web_search` | `web_fetch` | `/search`, `/extract`, Bearer key |
| Brave | `web_search` | unavailable | GET `/res/v1/web/search`, X-Subscription-Token |

The DeepSeek behavior follows the local AstrBotX `plugins/astrbot_plugin_deepseek_search/main.py`; Tavily and Brave follow its `astrbot/core/tools/web_search_tools.py`. No Python plugin is loaded. This implementation does not claim support for the other AstrBotX provider names, provider-specific advanced query forms, multiple-key rotation or automatic fallback. Search supports query/count, per-provider endpoint/key, bounded result count, timeout and page character cap. Results retain title/URL/summary/reference ID; fetched pages retain the requested URL and truncation flag.

Tools must be explicitly mounted and authorized for `chat`. Existing calls recheck tool authorization and settings revision after upstream work; changing/disabling the provider prevents stale results returning. Run cancellation reaches HTTP. Upstream bodies and exception strings never become diagnostics. HTTP redirects are rejected for credential-carrying provider requests. Page URLs reject credentials and private literal/resolved addresses before being submitted to the configured provider; provider-side redirects/DNS are the provider's responsibility (the runtime itself does not fetch that page URL). Response bytes and page text are bounded. Search/page content is labeled untrusted source data.

Authenticated management endpoints: GET/PUT `/api/ts/search`, GET/POST `/api/ts/agents/:id/effective-prompt`. PUT requires `expectedRevision` plus search fields; POST preview accepts a complete typed Agent draft. The Dashboard search editor stores secret references, displays credential availability, and directs secret values to the existing write-only key manager.
