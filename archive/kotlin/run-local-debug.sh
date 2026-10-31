#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$PROJECT_DIR/scripts/load-local-properties.sh"
priestess_load_local_credentials "$PROJECT_DIR"
: "${DEEPSEEK_API_KEY:?Set DEEPSEEK_API_KEY in the environment or local.properties}"
: "${TELEGRAM_TEST_TOKEN:?Set TELEGRAM_TEST_TOKEN in the environment or local.properties}"
export PRIESTESS_CONFIG_PATH="$PROJECT_DIR/config.local-debug.json"
cd "$PROJECT_DIR"
exec "$PROJECT_DIR/run-server.sh"
