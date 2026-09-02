#!/usr/bin/env bash
# Runs `cargo fmt -- --check` over selected SDKWork application repositories
# under /mnt/e/sdkwork-space.
#
# Deliberately NOT `cargo fmt --all`: SDKWork application workspaces declare
# optional foundation paths that resolve sibling application workspaces outside
# the repository's own authority, so `--all` walks into neighbouring
# repositories and reports their formatting as this repository's failure
# (see AGENTS.md, "Do not use `cargo fmt --all`").
#
# Usage: wsl-cargo-fmt-repos.sh <repo-list-file> [per-repo-timeout-seconds]
set -u

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi
export PATH="$HOME/.cargo/bin:$PATH"

LIST="$1"
REPO_TIMEOUT="${2:-300}"
ROOT=/mnt/e/sdkwork-space
OUT_DIR=/mnt/e/sdkwork-space/sdkwork-specs/.wm-cargo-check
SUMMARY="$OUT_DIR/fmt-summary.log"
mkdir -p "$OUT_DIR"
: > "$SUMMARY"

run_one() {
  repo="$1"
  dir="$ROOT/$repo"
  [ -f "$dir/Cargo.toml" ] || return 0
  [ -d "$dir/crates" ] || return 0
  log="$OUT_DIR/fmt-$repo.log"
  ( cd "$dir" && timeout --signal=KILL "$REPO_TIMEOUT" cargo fmt -- --check >"$log" 2>&1 )
  status=$?
  case $status in
    0) echo "CLEAN    $repo" >> "$SUMMARY" ;;
    137) echo "TIMEOUT  $repo" >> "$SUMMARY" ;;
    *) echo "UNFORMATTED $repo" >> "$SUMMARY" ;;
  esac
}
export -f run_one
# Every variable `run_one` reads must be exported: it is invoked through
# `bash -c`, so script-local variables do not reach it.
export ROOT OUT_DIR SUMMARY REPO_TIMEOUT

grep -v '^[[:space:]]*$' "$LIST" | xargs -P 3 -I{} bash -c 'run_one "$@"' _ {}

echo "DONE" >> "$SUMMARY"
sort "$SUMMARY"
