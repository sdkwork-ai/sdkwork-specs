#!/usr/bin/env bash
# Compiles every SDKWork application repository under <workspace-root> that
# carries a Cargo workspace, recording per-repo pass/fail into a summary file.
set -u

# Self-locating: this script lives in <workspace-root>/sdkwork-specs/tools, so the
# workspace root is two levels up. Never bake in an absolute checkout path
# (`DEPENDENCY_MANAGEMENT_SPEC.md` section 1).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"
OUT="${ROOT}/sdkwork-specs/.wm-cargo-check.log"
: > "$OUT"

for repo in $(ls -1 "$ROOT"); do
  dir="$ROOT/$repo"
  [ -f "$dir/Cargo.toml" ] || continue
  [ -d "$dir/crates" ] || continue
  start=$(date +%s)
  result=$(cd "$dir" && cargo check --workspace --message-format short 2>&1)
  status=$?
  end=$(date +%s)
  if [ $status -eq 0 ]; then
    echo "PASS $repo ($((end-start))s)" >> "$OUT"
  else
    echo "FAIL $repo ($((end-start))s)" >> "$OUT"
    {
      echo "----- $repo -----"
      echo "$result" | grep -E "^error|^warning: unused|error\[" | head -25
    } >> "$OUT"
  fi
done
echo "DONE" >> "$OUT"
