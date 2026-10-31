---
name: telegram-web-smoke
description: Restart and validate this project's Telegram bot smoke-test flow through Telegram Web while coordinating local server health, runtime logs, and live tool replies. Use when Codex needs to debug or burn-test Telegram conversations for this repo, especially when sending commands to the bot through the Computer Use plugin, confirming tool behavior end to end, or recovering from flaky input-box, provider, or polling issues.
---

# Telegram Web Smoke

The current runtime is the root TypeScript project. Kotlin smoke artifacts are archived under `archive/kotlin/`; never start the archived IM consumer alongside the current bot.

Drive the repo's live Telegram smoke-test loop: start the local bot server, operate the standalone Telegram Web app, send one test command at a time, and verify each result against logs or health endpoints.

Read [references/runbook.md](references/runbook.md) before doing a live smoke test. It contains the project paths, concrete prompts, and the Telegram Web input-box rules learned during debugging.

## Quick Start

1. Read the runbook and use its project anchors instead of re-discovering the setup.
2. Start the current PriestessBot server from the repository root using `npm run dev` with the intended isolated configuration/data directory. `archive/kotlin/run-server.sh` is historical and must not be used for the current runtime.
3. Verify the server is actually responding before touching Telegram Web.
4. Use Computer Use against the standalone `Telegram Web` app, not an arbitrary browser tab.
5. Send one test prompt at a time and verify the response with logs, health checks, or chat evidence.

## Telegram Web Rules

- Call `mcp__computer_use.get_app_state` at the start of each assistant turn before any Telegram UI action.
- Focus the message input before typing or sending. An unfocused input can visually contain text but still fail to send.
- Prefer real `type_text` input for messages that must be sent. `set_value` is useful for drafts or inspection, but by itself may not enable `Send Message`.
- If a stale draft exists, replace it explicitly with `select_text`, then `type_text`.
- After real typing, click the `Send Message` button if it appears. Do not assume Enter will send.
- If Computer Use reports that the app changed, stop and re-run `get_app_state` before the next action.

## Verification Loop

For every live test:

1. Send exactly one prompt.
2. Poll the local server session or health endpoint.
3. Inspect the Telegram reply in chat.
4. Classify failures as one of:
   - local server/runtime failure
   - Telegram UI/input failure
   - upstream provider failure
   - tool-specific logic failure

Treat upstream provider `503` or timeout responses as external instability unless logs show a local exception.

## Burn-Test Scope

Use the runbook's prompt order for:

- first dialog flow
- safe read tools
- external read tools
- memory and reminders
- skills
- terminal, process, and read_terminal
- session-action tools
- knowledge search
- multi-role routing

## Guardrails

- Keep secrets out of the skill files. Refer to existing config paths instead of copying tokens or API keys.
- Prefer minimal repo changes. Use this skill to drive runtime validation, not to redesign unrelated code.
- If binding a local port fails inside the sandbox, re-run the server with escalation instead of changing server code first.
- If `knowledge_search` is under test, confirm a knowledge base is seeded before treating empty results as a bug.

## Resource

- Read [references/runbook.md](references/runbook.md) for the project-specific workflow, known pitfalls, and prompt set.
