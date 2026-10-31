#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/priestess-v2-smoke.XXXXXX")"
SMOKE_PORT="${PRIESTESS_SMOKE_PORT:-18082}"

cleanup() {
  rm -rf "$SMOKE_ROOT"
}
trap cleanup EXIT INT TERM

mkdir -p "$SMOKE_ROOT/workspace"
cat > "$SMOKE_ROOT/config.json" <<JSON
{
  "schemaVersion": 2,
  "runtime": {
    "server": { "enabled": true, "host": "127.0.0.1", "port": $SMOKE_PORT },
    "database": { "path": "$SMOKE_ROOT/priestess.db" },
    "plugins": { "enabled": false }
  },
  "providers": [
    { "id": "smoke-provider", "type": "ollama", "endpoint": "http://127.0.0.1:11434" }
  ],
  "workspaces": {
    "defaultWorkspaceId": "default",
    "entries": [ { "id": "default", "directory": "workspace" } ]
  }
}
JSON
cat > "$SMOKE_ROOT/workspace/config.yaml" <<'YAML'
schemaVersion: 2
id: default
name: Launcher Smoke
primaryAgentId: smoke-agent
agents:
  - id: smoke-agent
    providerRef: smoke-provider
    model: smoke-model
YAML

PRIESTESS_CONFIG_PATH="$SMOKE_ROOT/config.json" \
PRIESTESS_HEALTH_URL="http://127.0.0.1:$SMOKE_PORT/health" \
PRIESTESS_BLACKBOX_EXIT_AFTER_READY=true \
PRIESTESS_EXPECT_CONFIG_MODE=v2 \
PRIESTESS_BUILD_DASHBOARD=false \
"$PROJECT_DIR/run-blackbox-test.sh"

echo "v2 launcher smoke test passed"
