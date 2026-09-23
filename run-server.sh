#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$PROJECT_DIR/scripts/load-local-properties.sh"
priestess_load_local_credentials "$PROJECT_DIR"
CONFIG_PATH="${PRIESTESS_CONFIG_PATH:-$PROJECT_DIR/config.json}"
DIST_BIN="$PROJECT_DIR/build/install/astrbot.kt/bin/astrbot.kt"

java_major() {
  local java_bin="$1"
  "$java_bin" -version 2>&1 | awk -F '[\".]' '/version/ { if ($2 == "1") print $3; else print $2; exit }'
}

JAVA_HOME_CANDIDATE="${PRIESTESS_JAVA_HOME:-${JAVA_HOME:-}}"
if [[ -z "$JAVA_HOME_CANDIDATE" ]] || [[ ! -x "$JAVA_HOME_CANDIDATE/bin/java" ]] || [[ "$(java_major "$JAVA_HOME_CANDIDATE/bin/java")" -lt 21 ]]; then
  if [[ "$(uname -s)" == "Darwin" ]] && JAVA_21_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null)"; then
    JAVA_HOME_CANDIDATE="$JAVA_21_HOME"
  else
    JAVA_BIN_CANDIDATE="$(command -v java || true)"
    if [[ -n "$JAVA_BIN_CANDIDATE" ]] && [[ "$(java_major "$JAVA_BIN_CANDIDATE")" -ge 21 ]]; then
      JAVA_HOME_CANDIDATE="$(cd "$(dirname "$JAVA_BIN_CANDIDATE")/.." && pwd)"
    fi
  fi
fi

if [[ -z "$JAVA_HOME_CANDIDATE" ]] || [[ ! -x "$JAVA_HOME_CANDIDATE/bin/java" ]] || [[ "$(java_major "$JAVA_HOME_CANDIDATE/bin/java")" -lt 21 ]]; then
  echo "Java 21 or newer is required. Set PRIESTESS_JAVA_HOME to a compatible JDK." >&2
  exit 1
fi
export JAVA_HOME="$JAVA_HOME_CANDIDATE"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Configuration file not found: $CONFIG_PATH" >&2
  exit 1
fi
if [[ ! -x "$DIST_BIN" ]]; then
  echo "Application distribution not found. Run './gradlew installDist' first." >&2
  exit 1
fi

echo "Using config: $CONFIG_PATH"
echo "Using Java: $JAVA_HOME"

exec "$DIST_BIN" --config "$CONFIG_PATH"
