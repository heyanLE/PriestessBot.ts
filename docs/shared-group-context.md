# Shared group conversations and quoted media

The group conversation follows AstrBotX's shared public-dialogue behavior. Current sender authorization remains independent of the public history.

- A shared transcript is keyed by platform, group, Agent and reset generation. It contains confirmed public user/assistant turns, including sender attribution and bounded image inputs. Default retention is 200 messages / 32,000 text characters, cut at complete-turn boundaries; up to eight historical images / 8 MiB are retained with explicit omission notices.
- Each model run uses a separate SDK working session. It starts from the shared public transcript, then obtains current tools, memory and knowledge under the current sender's authorization. Tool calls/results, approval state and private dynamic retrieval are not copied to another sender. Completed working sessions are cleared; paused state remains bound to the original sender and run.
- Existing current-runtime group dialogue is lazily seeded by exact conversation ID only when its original run completed and its delivery was confirmed. Private chats, restored/archived/imported histories, child runs and uncertain deliveries are excluded. This is not replay or migration of AstrBotX's archived tool sessions.
- Existing per-conversation scheduling serializes group model turns across senders. Only same-sender follow-ups may join a running turn. Queued triggering messages do not appear early as raw group chatter.
- Untriggered public chatter has a separate 200-entry bounded buffer. Recent entries fit the remaining context budget after current identity, quote and attachment metadata. Reset clears both old-generation dialogue visibility and pending raw chatter/reservations.
- Current group/private scene, current sender, quoted sender, message identifiers and attachment-image order are explicitly described. Group history is evidence of past public dialogue, not a fresh instruction or permission grant.

NapCat quote handling now reads verified `get_msg` results and retains image/file attachments, author and timestamp. Root message ID, chat type and group/private scope must match. Nested replies are not followed indefinitely. Quoted merged forwards are bounded to three API fetches, depth two, twenty nodes, one hundred segments, eight quoted attachments and 20,000 characters per incoming message; cycles are deduplicated and node authors are retained.

Top-level and quoted attachments share byte/text/count budgets. Downloaded images become verified data URLs before the model call. Missing/expired media are explicitly marked unavailable; cancellation and budget violations stop processing. Image-index attribution is rebuilt after download failures. Management transcript archival strips nested embedded image bytes and extracted file content using the same rules as top-level attachments.

Verification: 276 backend tests, strict TypeScript and ESLint passed; production Dashboard build passed. A real NAS group quote was resolved read-only: its chat/type/sender fields matched and one 28,704-byte image was materialized with correct source attribution. No IM writes were used for this check. Isolated live-model validation uses synthetic groups and images, an in-memory database and a capture-only adapter.

During live verification the provider accepted and understood synthetic image input, but the previous generic attachment wording caused the persona to answer as if only descriptors existed. Runtime context now explicitly distinguishes prepared visual pixels from unavailable references; persona examples also have an explicit end boundary before actual conversation. The persona body is unchanged. Official format reference: https://api-docs.deepseek.com/guides/vision/. Group SDK working-session byte limits accommodate the bounded current/historical image payload; token-window and media limits still apply.

## NAS delivery (2026-10-26, Asia/Shanghai)

Active release: `/home/heyanhub/apps/priestess/releases/20261026-group-context-final`.
Archive SHA-256: `7fc71447f259b9d0461290f0359ea1c6e9056a25d3b3cb77b530d730d5e04a84`.

Final isolated live-provider test: Alice introduced a synthetic public marker; Bob correctly recalled it, identified the current chat as a group, described the test image as red on top / blue below and attributed it to Alice. A separate private conversation correctly reported no group marker or image. A small flat-color probe was misclassified in an earlier run; the final visual-pattern check verifies the actual multimodal path without claiming perfect model recognition accuracy. Tests use a capture-only adapter and never post to real groups.

The deployment backs up the database and environment before switching, preserves configuration/persona settings, and retains the preceding release for rollback. Group transcript seeding is lazy and scope-checked on the next eligible group run. Existing AstrBotX archives are not imported into live SDK execution.

## Searchable public group history (2026-10-28)

`get_group_message_history` follows AstrBotX's current-group history tool. It is platform-neutral and only appears in group runs when the Agent/persona/resource grants expose that tool and `chat` is authorized. `keyword` and `sender` are literal case-insensitive filters; `limit` defaults to 20 and caps at 50; `before_id` is a local sequence cursor. Results are chronological JSON with sender ID/name, timestamp, role, platform message ID, bounded text, truncation and pagination markers. It cannot select another group, read private chats or fetch missing platform history.

Ingress stores accepted public group messages and untriggered chatter after acceptance/route checks, without starting a model for chatter. The independent SQLite table retains 700 records per platform/group/Agent/generation, at most 4,000 characters per message and under 24,000 serialized characters per search. Attachment references become text markers; binary data and attachment download URLs are omitted. Confirmed root replies are included; tools, private memory, delegated outputs and uncertain deliveries are excluded. An empty new scope may be seeded once from the existing validated public conversation snapshot, before its first new input. Old unrecorded chatter and legacy archives are not silently imported.

The current triggering message is a fixed sequence upper bound. Reset/deletion/revocation fail closed, and a missing boundary (including retention eviction) cannot reveal later-arriving messages. Tool binding controls collection; removing it stops new collection and tool visibility.

### Search tool deployment verification

2026-10-28: strict TypeScript, ESLint and all 343 backend tests passed; Dashboard production build passed. NAS isolated SDK smoke searched unmentioned public chatter and excluded another group without contacting a real model or sending IM messages. Active release: `/home/heyanhub/apps/priestess/releases/20261028-group-history`; archive SHA-256 `73b67841ef384b612087c7bf32b2c08b8aaea5ad9db858eedeb039a368942efd`. Configuration revision 7 adds the tool to the existing assistant and its two NapCat grants, retaining other settings and `context` token mode. Backup: `/home/heyanhub/apps/priestess/backups/group-history-retry-20261028-033438` (UTC directory time). First cutover rolled back because initialization exceeded the old 15-second health window; retry with a 75-second bound became healthy in 2 seconds.
