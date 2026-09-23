#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/priestess-properties-test.XXXXXX")"
trap 'rm -rf "$FIXTURE_DIR"' EXIT
source "$SCRIPT_DIR/load-local-properties.sh"

assert_equal() {
  if [[ "$1" != "$2" ]]; then
    printf 'FAIL: %s\n' "$3" >&2
    exit 1
  fi
}

# Only synthetic values and temporary fixture paths are used in this test.
unset DEEPSEEK_API_KEY TELEGRAM_TEST_TOKEN
printf '  # comment\r\n! comment\r\n \t\r\n DEEPSEEK_API_KEY = "fake-key-with=equals" \r\nTELEGRAM_TEST_TOKEN: 123:fake-token' > "$FIXTURE_DIR/local.properties"
printf 'DEEPSEEK_API_KEY=legacy-ignored\nTELEGRAM_TEST_TOKEN=legacy-ignored\n' > "$FIXTURE_DIR/.env.local-debug"
priestess_load_local_credentials "$FIXTURE_DIR"
assert_equal "$DEEPSEEK_API_KEY" 'fake-key-with=equals' 'CRLF and quoted assignment'
assert_equal "$TELEGRAM_TEST_TOKEN" '123:fake-token' 'colon separator and unterminated final line'

DEEPSEEK_API_KEY='environment-wins'
TELEGRAM_TEST_TOKEN=''
priestess_load_local_credentials "$FIXTURE_DIR"
assert_equal "$DEEPSEEK_API_KEY" 'environment-wins' 'environment precedence'
assert_equal "$TELEGRAM_TEST_TOKEN" '' 'explicit empty environment is preserved'

unset DEEPSEEK_API_KEY TELEGRAM_TEST_TOKEN
printf 'DEEPSEEK_API_KEY=local-wins\n' > "$FIXTURE_DIR/local.properties"
printf 'export DEEPSEEK_API_KEY="legacy-ignored"\n export TELEGRAM_TEST_TOKEN = '\''legacy-token'\''\n' > "$FIXTURE_DIR/.env.local-debug"
priestess_load_local_credentials "$FIXTURE_DIR"
assert_equal "$DEEPSEEK_API_KEY" 'local-wins' 'local.properties precedes legacy file'
assert_equal "$TELEGRAM_TEST_TOKEN" 'legacy-token' 'safe legacy export syntax'

unset DEEPSEEK_API_KEY TELEGRAM_TEST_TOKEN
TEST_MARKER="$FIXTURE_DIR/must-not-exist"
export TEST_MARKER
cat > "$FIXTURE_DIR/local.properties" <<'DATA'
PATH=/must-not-change
PRIESTESS_CONFIG_PATH=/must-not-change
UNAPPROVED_VARIABLE=must-not-exist
touch "$TEST_MARKER"
DEEPSEEK_API_KEY="$(touch "$TEST_MARKER")"
TELEGRAM_TEST_TOKEN='`touch "$TEST_MARKER"` $HOME # literal'
DATA
prior_path="$PATH"
prior_config="${PRIESTESS_CONFIG_PATH-}"
priestess_load_local_credentials "$FIXTURE_DIR"
assert_equal "$PATH" "$prior_path" 'PATH is not an allowed key'
assert_equal "${PRIESTESS_CONFIG_PATH-}" "$prior_config" 'configuration path cannot be overwritten'
assert_equal "${UNAPPROVED_VARIABLE-}" '' 'unknown key is ignored'
assert_equal "$DEEPSEEK_API_KEY" '$(touch "$TEST_MARKER")' 'command substitution is literal'
assert_equal "$TELEGRAM_TEST_TOKEN" '`touch "$TEST_MARKER"` $HOME # literal' 'backticks and environment expansion are literal'
[[ ! -e "$TEST_MARKER" ]] || { printf 'FAIL: credential data was executed\n' >&2; exit 1; }

unset DEEPSEEK_API_KEY TELEGRAM_TEST_TOKEN
printf 'DEEPSEEK_API_KEY=first\nDEEPSEEK_API_KEY=last\nTELEGRAM_TEST_TOKEN=synthetic-hidden-value\n' > "$FIXTURE_DIR/local.properties"
priestess_load_local_credentials "$FIXTURE_DIR"
assert_equal "$DEEPSEEK_API_KEY" 'last' 'last assignment in one file wins'
export SCRIPT_DIR FIXTURE_DIR
bash -c 'set -eu; unset DEEPSEEK_API_KEY TELEGRAM_TEST_TOKEN; source "$SCRIPT_DIR/load-local-properties.sh"; set -x; priestess_load_local_credentials "$FIXTURE_DIR"; case $- in *x*) exit 1;; esac; [[ "$TELEGRAM_TEST_TOKEN" == synthetic-hidden-value ]]' > "$FIXTURE_DIR/output" 2>&1
if grep -F 'synthetic-hidden-value' "$FIXTURE_DIR/output" >/dev/null; then
  printf 'FAIL: xtrace exposed a credential value\n' >&2
  exit 1
fi

unset DEEPSEEK_API_KEY TELEGRAM_TEST_TOKEN
rm "$FIXTURE_DIR/local.properties" "$FIXTURE_DIR/.env.local-debug"
priestess_load_local_credentials "$FIXTURE_DIR"
assert_equal "${DEEPSEEK_API_KEY+x}" '' 'missing files do not create credentials'
printf 'Local credential parser tests passed.\n'
