# Agent management workspace

## Pages and persistence

- `/chat`: create a Dashboard conversation for an enabled Agent; messages, attachments and run links survive page reload. Same-sender additions can continue an active logical run at a safe SDK boundary. `?conversation=<id>` opens a specific conversation.
- `/sessions`: search titles and message text; rename, archive, move to a folder, export JSON, continue Dashboard conversations, stop work and delete conversation records. IM conversations continue on their originating IM. `/runs` remains the detailed execution/approval page.
- `/personas`: create/edit reusable personas, organize folders and bind one to an Agent. A binding replaces its inline persona for new turns; its system instructions and capability ceilings remain intact. Referenced personas cannot be deleted before unbinding.
- `/files`: browse configured execution work roots; create directories, upload, preview UTF-8 text, download, rename/move and delete files or empty directories. Upload/download is limited to 10 MB; text preview to 1 MB. Existing files are not overwritten. Root deletion, traversal and symlink escape are rejected. The local backend is trusted-host, not an OS sandbox; Docker environments expose their configured mounted work root.
- `/extensions`: MCP/Skills plus independently managed native extensions. Installed native operations appear in Agent resource choices; explicit tool and capability authorization remains necessary. See [extension API](native-extensions-memory.md).
- `/memories`: ordinary memory CRUD plus semantic consolidation preview/apply and optional periodic jobs. See [memory maintenance](native-extensions-memory.md).
- `/settings`: configuration import/export/recovery, login/session information, write-only secret references and the latest 2000 operator audit records.

Persona and conversation folders are separate kinds. Their hierarchy supports rename/move and rejects cycles. Nonempty folders must first have contents moved out. Configuration drafts use the existing global save bar; personas, folders, conversation metadata, extension state and memory policy changes have their own explicit save actions and revisions.

## Login and secrets

An operator signs in using the existing management token. The server issues an eight-hour HttpOnly, SameSite=Strict cookie; refresh restores the session and logout invalidates it. Session identifiers are stored hashed in SQLite. Cross-origin management calls are rejected. Existing Bearer authentication remains supported for tools and scripts. This is a single-operator management session system, not a multi-user account or TOTP implementation.

Secret values entered in Settings are stored in the local runtime database (protected with mode0600 by the launcher) and override environment variables of the same name. GET endpoints expose names/timestamps only, configuration exports omit values, and audit records never log request bodies. Full database backups contain secret values and must be treated as sensitive. Updating a secret reconnects configured IM instances to reload constructor-time credentials. Model connections read the current value on new runs.

## Conversation data boundaries

Conversation identity contains platform instance, private/group kind, chat ID, Agent and history generation. The management transcript preserves individual sender provenance; private SDK histories remain separately keyed by authorization domain. Archiving changes organization only. Deletion cancels linked active work, installs a tombstone and advances the active generation when necessary. Late replies cannot recreate deleted transcript records. Detailed run audit events are a separate operational record, and retained SDK data from old generations is not reused.

Existing pre-upgrade runs are backfilled with metadata and run links only. The system does not invent missing original messages. Such recovered conversations are identified in the UI. New user messages/replies are captured durably; uploaded-media references are retained without duplicating inline Base64 in transcripts.

## Validation

`npm run check` covers persistence, scope isolation, revisions, folder cycles, real localhost HTTP authentication/session/logout, write-only secrets, path confinement, native extension calls, memory preview conflicts, periodic shutdown and approval delivery. `tools/management-preview.ts` serves an isolated Dashboard on8083 with fake models, no IM accounts and a temporary work root. `tools/live-memory-smoke.ts` validates real model consolidation against the existing local debug provider using only two synthetic in-memory records.

Browser acceptance on2026-10-25 verified login restoration, persona/folder creation, chat history after refresh, conversation editing, workspace directory creation and file preview, and memory consolidation preview. The existing Telegram consumer remains on8082; QA data is separate. Detailed SDK input and context-compaction timing is documented in [messages and concurrency](messages-and-concurrency.md).
