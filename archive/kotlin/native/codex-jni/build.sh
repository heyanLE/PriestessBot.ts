#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
fork_root=$(CDPATH= cd -- "$project_root/../../../codex_for_astrbot" && pwd)
expected_revision=413f16a571a7a24557e70250c0284c5bebdd8c3f
actual_revision=$(git -C "$fork_root" rev-parse HEAD)

if [ "$actual_revision" != "$expected_revision" ]; then
    printf 'Codex fork revision mismatch: expected %s, found %s\n' "$expected_revision" "$actual_revision" >&2
    exit 1
fi

exec cargo build --locked --release --manifest-path "$project_root/native/codex-jni/Cargo.toml" "$@"
