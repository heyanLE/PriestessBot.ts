## Implemented

- [x] Add route-scoped injection vocabulary and optional setting with `MULTI` as the legacy default.
- [x] Validate Agent routes against server-reported type capabilities and reject injection settings on command routes.
- [x] Assemble IM platform tools per request for `NONE` and `MULTI`.
- [x] Add a Dashboard selector driven by the target Agent's supported modes.
- [x] Test default, NONE, unsupported SINGLE and command-route validation; run JVM and Dashboard builds.

## Remaining

- [ ] Implement IM-owned `SINGLE` dispatcher with per-action schema validation and permission floors.
- [ ] Implement `SKILL` mode with authorized route-scoped skill materialization and loading.
- [ ] Scope the global configurable tool catalog to active IM connections, so a Telegram-only deployment does not see NapCat tools.
- [ ] Add an end-to-end message test proving an explicit `NONE` route cannot execute an IM tool even when the model requests it.
