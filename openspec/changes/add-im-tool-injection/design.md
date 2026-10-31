## Decisions

The injection setting belongs on `ImRouteActionDocument`, not the Agent, because an IM message and the route that matched it determine which platform actions may enter a turn. `null` means the old `MULTI` behavior, preserving saved v3 configurations. Command actions reject a non-null mode.

The compiler validates an enabled Agent route against the target Agent type's declared modes. This stage exposes only `NONE` and `MULTI`; registry capabilities reflect that implementation state. The CODEX runner has completed a `MULTI` tool round trip through `ToolCase`. CODEX is off by default and requires an explicit, checksum-verified local experimental gate; NAS/production qualification remains separate.

`PreProcessStage` consumes the matched `ImRouteStage` result. `NONE` omits `platform.platformTools()` but still retains separately compiled runtime tools. `MULTI` retains the previous distinct-by-name assembly. The Agent's tool policy and caller permission checks remain downstream.

`SINGLE` needs an IM-owned dispatcher with per-action argument validation and per-action permission keys. `SKILL` needs a route-scoped generated or mounted skill document and explicit loading. Both remain validation errors until implemented. The Dashboard reads the Agent type's supported modes from `/api/agent-types` and does not offer a second hardcoded capability matrix.
