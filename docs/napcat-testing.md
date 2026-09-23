# NapCat Testing

This project keeps NapCat coverage in two layers:

1. Default unit tests parse representative OneBot/NapCat message payloads without a live server.
2. An opt-in integration test connects to a local NapCat WebSocket endpoint and calls `get_status`.

The NapCat setup reference used for the integration target is:
https://napneko.github.io/guide/start-install

## Unit Tests

Run the normal test task:

```powershell
.\gradlew.bat test
```

Covered behavior:

- Private WebSocket message payloads become `MessageEvent` with `SessionType.PRIVATE`.
- Group WebSocket message payloads use `group_id` as the session id.
- Non-message WebSocket events are ignored.
- HTTP fallback payloads with `sender.user_id` parse into message events.
- Structured OneBot arrays and legacy CQ strings preserve text, mentions, images, files, and reply targets.
- Message tools record annotations without sending anything during the model loop.
- Final replies preserve native segment order and transport failures propagate to the pipeline.
- Markdown code and tables become bounded PNG slices; formatting, lists, quotations, and rendering fallback are covered by `MarkdownMessageFormatterTest`.

## Sender Identity in Model Input

`InboundMessageFormatter` builds each user message with a `platform_message_context`
JSON block containing the sender ID/name, bot ID, session type/ID, group ID, message
ID, quotation target, and actual mention targets. NapCat prefers the sender's group
card over their nickname. The group number is never used as a fallback sender ID.
Mentions remain in their original positions in the model's message body.

This follows AstrBot's per-user-message identifier reminder and mention rendering.
The same annotated input is stored and replayed in conversation history, so each
group participant keeps their own identity. Earlier unannotated messages retain
unknown authorship. Raw message text remains the input for commands, routing,
permission checks, and memory retrieval. Only explicitly selected identity fields
enter this block; credentials and arbitrary runtime metadata are excluded.

## Final Response Assembly

The ordered `MessageChain` is the common message representation. `ResponseIntent`
belongs to one agent run and holds deduplicated mentions and attachments.
`ResponseAssembler` constructs the final chain; `RespondStage` delivers it once the
model finishes. Platform adapters own formatting and native serialization.

`napcat_mention_user(user_id)` records a mention for the start of the final group
response. `napcat_send_file(url, name, folder_id?)` records an attachment for final
delivery and retains its administrator permission requirement. Their `marked`
results do not indicate successful delivery. Read and file-management tools still
execute their normal operations. Failed agent runs discard delivery annotations.
The old `napcat_reply_message`, `early_reply`, and `send_message` tools are removed;
update any explicit tool allow lists to use `napcat_mention_user` where needed.

Quoting is determined by the incoming message: an inbound reference to message A
produces a final reply referencing A. A regular message, including an ordinary
mention of the bot without a quotation, produces an unquoted response. The model
cannot override the reference. Quotation is emitted before the mentions and body.

NapCat receives OneBot segment arrays, so literal CQ-looking text is never executed
as a mention or reply. Markdown emphasis, strike-through, and underline markup are
removed; quoted text uses one `>` per line, unordered lists use `-`, and numbered
lists retain their original numbers. Code blocks and tables become PNG images in
their original position. Large blocks paginate; rendering failures or budget
limits fall back to complete readable text. Files upload after the final body.

Rendering uses local Java2D and sends `base64://` image data, so a remote NapCat
does not need access to the application's filesystem. Docker includes CJK fonts.
Other deployments need a Java runtime with Java2D and fonts covering the intended
languages (for example Noto CJK). Telegram's existing Markdown path is preserved.

## Local WebSocket Integration

The integration test is disabled by default so CI and developer machines do not
need a running NapCat instance.

Start NapCat locally, then run:

```powershell
.\gradlew.bat "-Dnapcat.integration.enabled=true" "-Dnapcat.ws.host=192.168.31.24" "-Dnapcat.ws.port=10001" test --tests com.heyanle.priestess.bot.platform.adapters.napcat4_18_6.NapCatWebSocketIntegrationTest
```

Equivalent environment variables:

```powershell
$env:NAPCAT_INTEGRATION_ENABLED="true"
$env:NAPCAT_WS_HOST="192.168.31.24"
$env:NAPCAT_WS_PORT="10001"
.\gradlew.bat test --tests com.heyanle.priestess.bot.platform.adapters.napcat4_18_6.NapCatWebSocketIntegrationTest
```

If your NapCat WebSocket requires an access token, add one of:

```powershell
$env:NAPCAT_ACCESS_TOKEN="<your-token>"
```

or:

```powershell
.\gradlew.bat "-Dnapcat.integration.enabled=true" "-Dnapcat.access.token=<your-token>" test --tests com.heyanle.priestess.bot.platform.adapters.napcat4_18_6.NapCatWebSocketIntegrationTest
```

The test opens `ws://<host>:<port>`, sends:

```json
{"action":"get_status","params":{},"echo":"priestess-napcat-test"}
```

and verifies that the response contains the matching `echo` plus a OneBot-style
status or retcode field.

When no token is supplied and the server requires one, `retcode=1403` is treated
as a successful reachability check: it proves the WebSocket endpoint is a live
NapCat/OneBot server, but not an authenticated API call.
