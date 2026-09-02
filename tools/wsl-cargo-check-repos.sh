#!/usr/bin/env bash
# Compiles selected SDKWork application repositories under /mnt/e/sdkwork-space.
#
# The naive serial sweep stalled: `cargo check` on some repos blocks on /mnt/e
# (9p) I/O without consuming CPU, so a wall-clock timeout is required. Each repo
# gets its own timeout and its own log; a stalled repo is reported as TIMEOUT
# instead of blocking the whole run.
#
# Usage: wsl-cargo-check-repos.sh <repo-list-file> [parallelism] [per-repo-timeout-seconds]
#
# Repositories that pull heavy C dependencies (for example `audiopus_sys` in
# sdkwork-aiot) legitimately need more than the 1500s default, so the timeout is
# a parameter rather than a constant.
set -u

# A non-login WSL shell does not load ~/.cargo/env, so `cargo` is missing from
# PATH. Make the script self-contained instead of relying on the caller.
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi
export PATH="$HOME/.cargo/bin:$PATH"

LIST="$1"
PARALLEL="${2:-3}"
REPO_TIMEOUT="${3:-1500}"
ROOT=/mnt/e/sdkwork-space
OUT_DIR=/mnt/e/sdkwork-space/sdkwork-specs/.wm-cargo-check
SUMMARY="$OUT_DIR/summary.log"
mkdir -p "$OUT_DIR"
: > "$SUMMARY"

run_one() {
  repo="$1"
  dir="$ROOT/$repo"
  [ -f "$dir/Cargo.toml" ] || return 0
  [ -d "$dir/crates" ] || return 0
  start=$(date +%s)
  log="$OUT_DIR/$repo.log"
  ( cd "$dir" && timeout --signal=KILL "$REPO_TIMEOUT" cargo check --workspace --message-format short >"$log" 2>&1 )
  status=$?
  end=$(date +%s)
  case $status in
    0) echo "PASS    $repo ($((end-start))s)" >> "$SUMMARY" ;;
    137) echo "TIMEOUT $repo ($((end-start))s)" >> "$SUMMARY" ;;
    *) echo "FAIL    $repo ($((end-start))s)" >> "$SUMMARY" ;;
  esac
}
export -f run_one
# Every variable `run_one` reads must be exported: it is invoked through
# `bash -c`, so script-local variables do not reach it.
export ROOT OUT_DIR SUMMARY REPO_TIMEOUT

grep -v '^[[:space:]]*$' "$LIST" | xargs -P "$PARALLEL" -I{} bash -c 'run_one "$@"' _ {}

echo "DONE" >> "$SUMMARY"
sort "$SUMMARY"
