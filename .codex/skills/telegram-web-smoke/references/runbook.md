# Telegram Web Smoke Runbook

## Current PriestessBot runtime

Run from the repository root. Use `npm run dev` for the backend, `npm run dev:dashboard` for the frontend, and `/health` on the configured backend port (default 8081). Use an isolated data directory and an explicitly selected test bot; do not reuse NAS consumers. `tools/live-telegram.ts` is an explicit live-test launcher and reads legacy local credentials from `archive/kotlin/` unless overridden by its environment settings. Never copy those credentials into chat.

Use the currently available Computer Use API and its documented state checks; the historical API names below are not a current API contract. The following anchors and prompts describe the archived Kotlin workflow and must only be used when the user explicitly requests that old implementation.

## Archived Kotlin project anchors

- Server launcher: [run-server.sh](../../../../archive/kotlin/run-server.sh)
- Smoke prompts: [manual-test-logs/telegram-tools-smoke/tool-burn-cases.md](../../../../archive/kotlin/manual-test-logs/telegram-tools-smoke/tool-burn-cases.md)
- Multi-role plan: [manual-test-logs/telegram-tools-smoke/test-plan.md](../../../../archive/kotlin/manual-test-logs/telegram-tools-smoke/test-plan.md)
- Primary config path used by the launcher: [manual-test-logs/telegram-tools-smoke/config.json](../../../../archive/kotlin/manual-test-logs/telegram-tools-smoke/config.json)

Do not copy secrets from the config into chat or the skill. Reuse the configured files in place.

## Archived Kotlin local server workflow

1. From `archive/kotlin/`, start the explicitly requested historical server with `env PRIESTESS_SERVER_ENABLED=true ./run-server.sh`.
2. If sandboxed startup fails with a bind error such as `java.net.SocketException: Operation not permitted`, rerun with escalation instead of changing the code.
3. Confirm startup from logs. The current smoke setup has been responding at `http://127.0.0.1:18080`, even if config files suggest a different port, so trust runtime evidence.
4. Verify health with `curl -sS http://127.0.0.1:18080/health`.
5. Keep the server session open and poll it after each Telegram message to classify failures quickly.

## Telegram Web Workflow

1. Use the standalone `Telegram Web` app.
2. Call `mcp__computer_use.get_app_state` before any UI action each turn.
3. Open the chat with the bot if needed.
4. Focus the message input before typing.
5. If stale text is present, use `select_text` to replace it.
6. Use `type_text` for the real command so Telegram recognizes it as typed input.
7. Click `Send Message` after typing. Do not rely on `set_value` alone and do not assume Enter will send.
8. If Computer Use says the app changed, stop and call `get_app_state` again.

## Known UI Pitfalls

- `set_value` can make text visible in the input but still leave the chat unsendable.
- The send button usually appears only after real keyboard input.
- The input may need explicit focus even when the cursor looks present.
- Drafts can persist across retries and confuse later tests if not explicitly replaced.

## Verification Pattern

For each prompt:

1. Send one message.
2. Poll server logs.
3. Inspect the Telegram reply.
4. Decide which layer failed:
   - Telegram UI
   - local server/runtime
   - upstream provider
   - tool logic

Examples:

- Provider overload tends to surface as `503 Service Temporarily Unavailable` from the OpenAI-compatible endpoint.
- Tool logic failures show up as local exceptions in the server logs.
- UI failures show no corresponding server activity after a message appears to be typed.

## Prompt Set

Prefer short, single-purpose prompts while debugging.

### First dialog flow

- `你好，请先不要调用工具，只回复“对话链路已打通”。`

### Safe reads

- `请调用 system_info 和 list_tools，告诉我当前平台、会话、可用工具总数。`
- `请调用 health_check，返回当前运行状态摘要。`
- `请调用 skills_list 和 skill_view 查看 smoke-report skill。`
- `请调用 read_file 读取 workspace/config.yaml，并简述工具白名单。`
- `请调用 search_files 搜索 deepseek_tools。`
- `请调用 conversation_search 搜索最近 5 条对话。`

### External reads

- `请调用 fetch_url 读取 https://example.com 并给出标题。`
- `请调用 web_extract 提取 https://example.com 的正文摘要。`
- `请调用 web_search 搜索 Kotlin coroutines 官方文档，返回前 3 条。`

### Memory and reminders

- `请调用 memory_save 记住“我最关心 Telegram 工具燃烧测试稳定性”。`
- `请调用 memory_recall 搜索“燃烧测试稳定性”。`
- `请调用 create_reminder 创建一个 10 分钟后的提醒，内容是“检查 tool burn 结果”。`
- `请调用 list_reminders 查看刚创建的提醒。`
- `请调用 delete_reminder 删除刚才那条提醒。`
- `请调用 memory_delete 删除刚才保存的那条记忆。`

### Skills

- `请调用 use_skill 加载 smoke-report。`
- `现在请按技能格式总结刚才的测试进展。`
- `请调用 unload_skill 卸载 smoke-report。`

### Terminal and session tools

- `Use terminal with command sleep 1; echo bg done and background=true. Reply with only the session_id.`
- `Use process action=list and summarize whether session <session_id> exists.`
- `read_terminal session_id <session_id>`

### Session actions

- `请调用 early_reply，内容是“正在进行工具联调，请稍候”。`
- `请调用 send_message，向当前会话发送“send_message 工具验证成功”。`

### Knowledge search

- `请调用 knowledge_search 搜索“tool burn checklist”。`

Seed a knowledge base first. An empty workspace knowledge configuration is not proof of a broken tool.

## Known Runtime Findings

- `conversation_search` had a runtime serialization issue and now relies on manually built JSON output.
- `web_search` previously failed on `403 Forbidden` from SearX/openresty and now uses fallback providers.
- `read_terminal` requests can fail even when the tool path is correct if the upstream model provider is overloaded.

Use live evidence to decide whether a failure is a regression or a recurrence of an already-known external issue.
