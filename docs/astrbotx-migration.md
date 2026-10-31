# AstrBotX → 普瑞赛斯

`tools/migrate-astrbotx.ts` imports the Codex-based AstrBotX `cmd_config.json`, `skills.json`, `mcp_server.json` and `data_v4.db`. It is separate from the Kotlin migration tool. Stop the source service first and retain an independent backup. Never run both IM consumers simultaneously.

```sh
node dist/tools/migrate-astrbotx.js \
  --source /home/heyanhub/apps/astrbotx/data \
  --target /home/heyanhub/apps/priestess/data \
  --napcat-ws ws://127.0.0.1:10001 \
  --builtin-skills /home/heyanhub/apps/astrbotx/current/astrbot/builtin_stars/astrbot/skills \
  --napcat-token-file /private/path/to/forward-websocket-token
```

This prints a secret-free plan. Add `--apply` to perform the import. The destination must be empty; rerunning cannot overwrite an existing deployment. The token file is optional only when the source reverse WebSocket token is also valid for the forward connection. HTTP is optional (`--napcat-http`); omit it to send OneBot actions through WebSocket. Input JSON supports UTF-8 BOM.

The importer maps all source model-provider entries, selected model, base/developer instructions, active NapCat instance, whitelist and both administrator exceptions, disabled rate limiting, turn timeout, queue limit, streaming preference, context compaction threshold, administrators and active Skills. The new context policy uses the source threshold (32,768 tokens on this NAS), half that threshold as its compaction target and a 128,000-token default window; estimates and semantic summaries come from the new engine. DeepSeek connections use Chat Completions regardless of the source Codex wire-api setting. API credentials are stored only in the new database's `operator-secrets` namespace, referenced by generated names in configuration. The old Dashboard login is not reused as a management token.

The active Agent retains the project's three-state permission model. Migrated administrators default to elite operator; ordinary senders do not gain terminal or file-writing permissions. The migrated whitelist still limits incoming sessions. Skills receive a dedicated library containing only active source Skills. Workspace and Codex workspace files are copied into separate directories under the new authorized workspace.

Persona folders, persona system prompts, typed alternating example dialogs, tool/skill restrictions, custom errors and voice prompts become managed personas. The default enabled wildcard persona rule binds the Agent. Conversation JSON and platform message history become separate, archived management conversations under **PriestessBot 历史导入**. Platform message entries preserve original sender IDs/names. Agent-history rows without sender identity use an explicit unknown-source marker; they are not attributed to the group ID or administrator. Known attachment IDs are copied into the new artifact store, linked from transcripts and counted in the report. Paths and symlinks must stay inside the original data/archive roots. Missing attachments are counted explicitly and remain placeholders backed by the raw archive. Unsupported tool roles and structured components remain in original raw records. Management transcript timestamps are source timestamps; entries without individual timestamps retain order relative to the conversation creation time. These archived records are visible with the archived/all filter and can be exported. They are not copied into live authorization-bound Agents SDK sessions.

All original database tables are preserved as private `astrbotx-archive-*` namespaces. All persistent source files are copied to `imported/astrbotx`, excluding `temp` and `site-packages`, which remain in the independent source backup. Codex thread/compaction state, Python plugins, old auth state, preferences and source-only settings are retained there. They are not executable equivalents in the new engine. The original source remains read-only. Source memory-disabled stays disabled; an auto-consolidation preference does not enable it. Nonempty MCP configuration and unsupported enabled IM types fail closed until explicitly mapped.

`astrbotx-migration-report.json` records the source fingerprint, counts and compatibility warnings without credentials. Partial failures keep the source and backup intact and refuse automatic retry into the nonempty target; inspect and move aside the partial target before another import. Successful startup and actual IM delivery should be checked separately by the deployment operator.

AstrBotX bundled skills may be absent from data/skills. Supply --builtin-skills with the actual release builtin skill root; the importer validates each enabled skill and refuses missing files or escaping symlinks.
