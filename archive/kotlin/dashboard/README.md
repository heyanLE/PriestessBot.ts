# Dashboard

The main configuration UI edits the revisioned V3 document at `/api/config/v3`.
Independent Agent, IM, LLM, and platform resource forms share an unsaved draft across
navigation. Preview validates the exact draft; any subsequent edit invalidates it.
Applying a revision sends `expectedRevision`, and conflicts preserve the draft.
The old workspace URL redirects to Agents.

## Checks

```sh
npm ci
npm run build
npm run test:config-v3
npm run test:workspaces
npm run test:persona-memory
```

`test:config-v3` exercises the real Pinia store against a mocked HTTP client,
including preview invalidation, concurrent changes, and revision conflicts.

The browser smoke test serves the production build on an ephemeral localhost port
and mocks all API responses. It does not connect to a running bot. It requires an
installed Playwright package and Chromium:

```sh
# Use a local Playwright installation, or set PLAYWRIGHT_MODULE to its index.mjs.
npm run build
npm run test:v3-browser
```

Optional environment variables:

- `PLAYWRIGHT_MODULE`: absolute path to an existing Playwright `index.mjs`.
- `TEST_BROWSER_EXECUTABLE`: absolute path to a compatible Chromium executable.
- `DASHBOARD_SCREENSHOT`: path for the desktop Agent screenshot.

The browser test covers entity creation, Agent validation and saves, ordered IM
routes, Skill editing, memory/persona creation, execution details, and mobile
navigation. All resources created by the test remain in its in-memory fixtures.

For real API integration, `npm run test:v3-live` drives the same production UI
against a backend on `QA_BACKEND_URL` (default `http://127.0.0.1:18080`). It accepts
only the disposable configuration `/tmp/astrbot-v3-qa/config.json` (its canonical
`/private/tmp` path is also accepted) and requires no enabled IM connections.
It creates or reuses `qa-*` entities and leaves them available for inspection.
A local OpenAI-compatible test model must be running on `127.0.0.1:18081`, with
model `qa-model`, and support a `health_check` tool turn for input `trace-tool`.
This test uses real configuration, Skill, memory, persona, chat, and execution APIs;
it only serves the current local frontend assets in place of the packaged ones.
