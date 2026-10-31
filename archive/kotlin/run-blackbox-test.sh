#!/usr/bin/env bash

# 按黑盒测试环境的完整形态构建并启动应用：打包后的 Dashboard、
# Telegram 适配器和 HTTP 服务。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_CONFIG="$PROJECT_DIR/config.json"
if [[ ! -f "$DEFAULT_CONFIG" ]]; then
  DEFAULT_CONFIG="$PROJECT_DIR/manual-test-logs/telegram-tools-smoke/config.json"
fi

CONFIG_PATH="${PRIESTESS_CONFIG_PATH:-$DEFAULT_CONFIG}"
HEALTH_URL="${PRIESTESS_HEALTH_URL:-http://127.0.0.1:8080/health}"
EXIT_AFTER_READY="${PRIESTESS_BLACKBOX_EXIT_AFTER_READY:-false}"
EXPECT_CONFIG_MODE="${PRIESTESS_EXPECT_CONFIG_MODE:-}"
BUILD_DASHBOARD="${PRIESTESS_BUILD_DASHBOARD:-true}"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Configuration file not found: $CONFIG_PATH" >&2
  exit 1
fi

echo "Building the application distribution..."
(cd "$PROJECT_DIR" && ./gradlew --no-daemon -PbuildDashboard="$BUILD_DASHBOARD" installDist)

echo "Starting black-box runtime with config: $CONFIG_PATH"
env \
  PRIESTESS_CONFIG_PATH="$CONFIG_PATH" \
  PRIESTESS_SERVER_ENABLED=true \
  "$PROJECT_DIR/run-server.sh" &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in {1..30}; do
  if HEALTH_BODY="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; then
    if [[ -n "$EXPECT_CONFIG_MODE" ]]; then
      if ! grep -Eq "\"configMode\"[[:space:]]*:[[:space:]]*\"$EXPECT_CONFIG_MODE\"" <<< "$HEALTH_BODY"; then
        echo "Health response did not report configMode=$EXPECT_CONFIG_MODE" >&2
        echo "$HEALTH_BODY" >&2
        exit 1
      fi
    fi
    if [[ "$EXPECT_CONFIG_MODE" == "v2" ]]; then
      [[ "$HEALTH_BODY" == *'"activeSnapshotVersion"'* ]] || { echo "Health response omitted activeSnapshotVersion" >&2; exit 1; }
      [[ "$HEALTH_BODY" == *'"workspaceSnapshotVersions"'* ]] || { echo "Health response omitted workspaceSnapshotVersions" >&2; exit 1; }
    fi
    echo "Black-box runtime is ready. Dashboard: ${HEALTH_URL%/health}"
    if [[ "$EXIT_AFTER_READY" == "true" ]]; then
      exit 0
    fi
    wait "$SERVER_PID"
    exit $?
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 1
done

echo "Timed out waiting for health check: $HEALTH_URL" >&2
exit 1
