#!/usr/bin/env bash

# This file contains code; credential files contain data and are never sourced.
# Keep Bash 3 compatibility for the shell bundled with macOS.
_priestess_read_credential_file() {
  local credential_file="$1"
  [[ -f "$credential_file" ]] || return 0
  if [[ ! -r "$credential_file" ]]; then
    printf 'Cannot read local credential file: %s\n' "$credential_file" >&2
    return 1
  fi

  local preserve_deepseek="${DEEPSEEK_API_KEY+x}"
  local preserve_telegram="${TELEGRAM_TEST_TOKEN+x}"
  local line='' key='' value=''
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#$'\xEF\xBB\xBF'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in ''|\#*|\!*) continue ;; esac
    if [[ "$line" == export[[:space:]]* ]]; then
      line="${line#export}"
      line="${line#"${line%%[![:space:]]*}"}"
    fi
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*[:=][[:space:]]*(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
    else
      continue
    fi
    case "$key" in
      DEEPSEEK_API_KEY) [[ -z "$preserve_deepseek" ]] || continue ;;
      TELEGRAM_TEST_TOKEN) [[ -z "$preserve_telegram" ]] || continue ;;
      *) continue ;;
    esac
    value="${value%"${value##*[![:space:]]}"}"
    # Only remove matching outer quotes. No interpolation, escapes or inline commands.
    if [[ ${#value} -ge 2 ]]; then
      case "$value" in
        \"*\") value="${value:1:${#value}-2}" ;;
        \'*\') value="${value:1:${#value}-2}" ;;
      esac
    fi
    printf -v "$key" '%s' "$value"
    export "$key"
  done < "$credential_file"
}

priestess_load_local_credentials() {
  # Do not restore xtrace: subsequent launcher checks must not print expanded secrets.
  set +x
  local credential_root="$1"
  _priestess_read_credential_file "$credential_root/local.properties" || return $?
  _priestess_read_credential_file "$credential_root/.env.local-debug" || return $?
  if [[ "${DEEPSEEK_API_KEY+x}" == x ]]; then export DEEPSEEK_API_KEY; fi
  if [[ "${TELEGRAM_TEST_TOKEN+x}" == x ]]; then export TELEGRAM_TEST_TOKEN; fi
  return 0
}
