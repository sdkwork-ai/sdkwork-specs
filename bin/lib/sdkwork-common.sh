#!/usr/bin/env bash
# sdkwork-common.sh — shared library for every SDKWork module bin/ entrypoint.
# Authority: sdkwork-specs/MODULE_BIN_SPEC.md §3.
#
# Module bin scripts source this file, then their bin/lib/module.sh wiring,
# then this repo's bin/lib/entrypoints.sh, and delegate. Generic concerns live
# here; module values and repo-command delegation live in module.sh.
#
# Design rule: a primitive that two modules need MUST live here, not in a
# module wrapper. Module wrappers contain only identity constants and the
# mapping app-type -> repo command.

# Guard: this library must be sourced, not executed.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "sdkwork-common.sh is a library; source it from bin/*.sh" >&2
  exit 64
fi

# -----------------------------------------------------------------------------
# Stable error codes (MODULE_BIN_SPEC.md §3)
# Assigned with '${var:=default}' so re-sourcing is idempotent.
# -----------------------------------------------------------------------------
: "${SDKWORK_BIN_E_USAGE:=64}"      # bad CLI usage
: "${SDKWORK_BIN_E_SPECS:=65}"      # sdkwork-specs checkout not resolved
: "${SDKWORK_BIN_E_ENV:=66}"        # unknown environment/profile/app-type
: "${SDKWORK_BIN_E_STATE:=67}"      # missing artifact / not installed / not materialized
: "${SDKWORK_BIN_E_REFUSED:=68}"    # refused (missing --yes, unsafe target)
: "${SDKWORK_BIN_E_FAILED:=70}"     # delegated command failed

# -----------------------------------------------------------------------------
# Global state (set by entrypoints before/while calling helpers)
# -----------------------------------------------------------------------------
: "${SDKWORK_BIN_DRY_RUN:=0}"
: "${SDKWORK_BIN_YES:=0}"
: "${SDKWORK_BIN_ENVIRONMENT:=development}"
: "${SDKWORK_BIN_HOST:=wsl}"
: "${SDKWORK_BIN_PROFILE:=standalone}"
: "${SDKWORK_BIN_IMAGE_TAG:=}"
: "${SDKWORK_BIN_IMAGE_REF:=}"
: "${SDKWORK_BIN_EVIDENCE_MSG:=}"
: "${SDKWORK_SPECS_ROOT:=}"
: "${SDKWORK_MODULE_ROOT:=}"
: "${SDKWORK_WSL_BIN:=}"

# -----------------------------------------------------------------------------
# Logging and failures
# -----------------------------------------------------------------------------
sdkwork_log()  { printf '[sdkwork-bin] %s\n' "$*"; }
sdkwork_warn() { printf '[sdkwork-bin] WARN: %s\n' "$*" >&2; }
sdkwork_die()  {
  local code="$1"; shift
  printf '[sdkwork-bin] ERROR(%s): %s\n' "${code}" "$*" >&2
  exit "${code}"
}

sdkwork_require_bash() {
  [[ -n "${BASH_VERSION:-}" ]] || {
    printf 'sdkwork-common.sh requires bash\n' >&2
    exit "${SDKWORK_BIN_E_FAILED}"
  }
  if ((BASH_VERSINFO[0] < 4)); then
    sdkwork_die "${SDKWORK_BIN_E_FAILED}" "bash >= 4 required (found ${BASH_VERSION})"
  fi
  set -euo pipefail
}

# -----------------------------------------------------------------------------
# Startup self-checks (fail fast, before any side effect)
# -----------------------------------------------------------------------------
sdkwork_specs_selfcheck() {
  [[ -n "${SDKWORK_SPECS_ROOT}" ]] || sdkwork_die "${SDKWORK_BIN_E_SPECS}" \
    "SDKWORK_SPECS_ROOT is not set (check out sdkwork-specs beside the module root, or export it)"
  [[ -f "${SDKWORK_SPECS_ROOT}/bin/lib/sdkwork-common.sh" ]] || sdkwork_die "${SDKWORK_BIN_E_SPECS}" \
    "resolved specs root has no bin/lib/sdkwork-common.sh: ${SDKWORK_SPECS_ROOT}"
  [[ -f "${SDKWORK_SPECS_ROOT}/MODULE_BIN_SPEC.md" ]] || sdkwork_warn \
    "specs root is missing MODULE_BIN_SPEC.md: ${SDKWORK_SPECS_ROOT}"
}

sdkwork_module_selfcheck() {
  [[ -n "${SDKWORK_MODULE_ROOT}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
    "bootstrap must export SDKWORK_MODULE_ROOT"
  [[ -n "${SDKWORK_MODULE_ID:-}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
    "bin/lib/module.sh must set SDKWORK_MODULE_ID"
  [[ -n "${SDKWORK_IMAGE_NAME:-}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
    "bin/lib/module.sh must set SDKWORK_IMAGE_NAME"
  [[ -n "${SDKWORK_APP_TYPES:-}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
    "bin/lib/module.sh must set SDKWORK_APP_TYPES"
  local hook
  for hook in sdkwork_image_build sdkwork_build_app sdkwork_package_app sdkwork_deploy_app sdkwork_installer_app; do
    declare -F "${hook}" >/dev/null 2>&1 || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
      "bin/lib/module.sh must implement ${hook}"
  done
}

# Canonical default image tag: module override -> app manifest release version.
sdkwork_default_image_tag() {
  [[ -n "${SDKWORK_IMAGE_TAG_DEFAULT:-}" ]] && { printf '%s' "${SDKWORK_IMAGE_TAG_DEFAULT}"; return 0; }
  local manifest="${SDKWORK_MODULE_ROOT}/sdkwork.app.config.json" version=""
  if [[ -f "${manifest}" ]]; then
    if command -v node >/dev/null 2>&1; then
      version="$(node -e 'const fs=require("fs");try{const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=c&&c.release&&c.release.currentVersion;if(typeof v==="string"&&v.trim())process.stdout.write(v.trim())}catch(e){}' "${manifest}" 2>/dev/null || true)"
    fi
    if [[ -z "${version}" ]]; then
      version="$(grep -m1 '"currentVersion"' "${manifest}" 2>/dev/null \
        | sed -E 's/.*"currentVersion"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
    fi
  fi
  printf '%s' "${version:-0.1.0}"
}

# One-shot startup: guards, defaults, evidence trap.
sdkwork_init() {
  sdkwork_require_bash
  sdkwork_specs_selfcheck
  sdkwork_module_selfcheck
  SDKWORK_IMAGE_TAG_DEFAULT="${SDKWORK_IMAGE_TAG_DEFAULT:-$(sdkwork_default_image_tag)}"
  # The manifest-derived default feeds artifact globs and image refs; a
  # corrupt release.currentVersion must fail here, not later inside a glob.
  case "${SDKWORK_IMAGE_TAG_DEFAULT}" in
    ''|*[!A-Za-z0-9._-]*) sdkwork_die "${SDKWORK_BIN_E_STATE}" \
      "sdkwork.app.config.json release.currentVersion is not a valid image tag: '${SDKWORK_IMAGE_TAG_DEFAULT}'" ;;
  esac
  trap sdkwork_evidence_flush EXIT
}

sdkwork_bin_doctor() {
  sdkwork_log "doctor:"
  sdkwork_log "  specs root     : ${SDKWORK_SPECS_ROOT:-<unset>}"
  sdkwork_log "  module         : ${SDKWORK_MODULE_ID:-<unset>} (root: ${SDKWORK_MODULE_ROOT:-<unset>})"
  sdkwork_log "  app types      : ${SDKWORK_APP_TYPES:-<unset>}"
  sdkwork_log "  image          : ${SDKWORK_IMAGE_NAME:-<unset>}:${SDKWORK_IMAGE_TAG_DEFAULT:-<unset>}"
  sdkwork_log "  bash           : ${BASH_VERSION}"
  sdkwork_log "  exec context   : $(sdkwork_exec_context)"
  if command -v docker >/dev/null 2>&1; then
    sdkwork_log "  docker         : $(docker --version 2>/dev/null | head -1)"
  else
    sdkwork_warn "docker not found on PATH (image commands will fail)"
  fi
  if command -v ssh >/dev/null 2>&1; then
    sdkwork_log "  ssh            : $(ssh -V 2>&1 | head -1)"
  else
    sdkwork_warn "ssh not found on PATH (remote targets will fail)"
  fi
}

# -----------------------------------------------------------------------------
# Execution context: native POSIX (WSL/Linux) or Windows shell bridged to WSL
#
# The bin/ suite drives POSIX-only repo commands (cargo, docker compose, tar,
# sha256sum) and POSIX target paths (/opt/deploy/...). When it is invoked from
# a Windows shell (Git Bash / MSYS2) those commands must be bridged into WSL
# Ubuntu instead of silently running against the Windows toolchain.
# -----------------------------------------------------------------------------
sdkwork_in_wsl_guest() {
  [[ -r /proc/version ]] && grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null
}

sdkwork_is_windows_shell() {
  case "${OSTYPE:-}" in msys*|cygwin*|mingw*) return 0 ;; esac
  [[ -n "${MSYSTEM:-}" ]] && return 0
  return 1
}

sdkwork_needs_wsl_bridge() {
  sdkwork_in_wsl_guest && return 1
  sdkwork_is_windows_shell || return 1
  return 0
}

sdkwork_wsl_resolve() {
  [[ -n "${SDKWORK_WSL_BIN}" ]] && return 0
  if command -v wsl.exe >/dev/null 2>&1; then
    SDKWORK_WSL_BIN="wsl.exe"
  elif command -v wsl >/dev/null 2>&1; then
    SDKWORK_WSL_BIN="wsl"
  else
    sdkwork_die "${SDKWORK_BIN_E_STATE}" \
      "this command needs a POSIX shell; run bin/*.sh from inside WSL Ubuntu (no 'wsl' launcher found on this Windows shell)"
  fi
}

sdkwork_exec_context() {
  if sdkwork_in_wsl_guest; then printf 'wsl-guest (native posix)'; return 0; fi
  if sdkwork_is_windows_shell; then
    if command -v wsl.exe >/dev/null 2>&1 || command -v wsl >/dev/null 2>&1; then
      printf 'windows-shell (bridged to wsl)'
    else
      printf 'windows-shell (NO wsl bridge available)'
    fi
    return 0
  fi
  printf 'posix (native)'
}

# Translate a host path into its WSL form; identity outside the bridge.
sdkwork_wsl_path() {
  local path="${1:-}" out
  [[ -n "${path}" ]] || { printf '%s' "${path}"; return 0; }
  if [[ "${path}" =~ ^([A-Za-z]):[\\/](.*)$ ]]; then
    out="/mnt/${BASH_REMATCH[1],}/${BASH_REMATCH[2]//\\//}"
  elif [[ "${path}" =~ ^/([A-Za-z])/(.*)$ ]]; then
    out="/mnt/${BASH_REMATCH[1],}/${BASH_REMATCH[2]}"
  else
    printf '%s' "${path}"; return 0
  fi
  # Collapse duplicate separators produced by escaped input.
  while [[ "${out}" == *'//'* ]]; do out="${out//\/\///}"; done
  printf '%s' "${out}"
}

# Path as seen by whichever shell will execute the command.
sdkwork_local_path() {
  if sdkwork_needs_wsl_bridge; then sdkwork_wsl_path "${1:-}"; else printf '%s' "${1:-}"; fi
}

# Anchor a user-supplied relative path against the directory the entry script
# was invoked from (captured by bootstrap as SDKWORK_BIN_INVOCATION_DIR), so
# output/input arguments (--out, -o, -i, --export) behave the same no matter
# which module root the shared library operates in. Absolute POSIX paths and
# Windows drive-letter paths pass through unchanged.
sdkwork_anchor_invocation_path() {
  local path="${1:-}"
  [[ -n "${path}" ]] || { printf '%s' "${path}"; return 0; }
  case "${path}" in
    /*) printf '%s' "${path}"; return 0 ;;
    [A-Za-z]:[\\/]*|[A-Za-z]:) printf '%s' "${path}"; return 0 ;;
  esac
  local base="${SDKWORK_BIN_INVOCATION_DIR:-${PWD}}"
  printf '%s/%s' "${base%/}" "${path}"
}

sdkwork_shell_quote() {
  local out="" arg
  for arg in "$@"; do out+=" $(printf '%q' "${arg}")"; done
  printf '%s' "${out# }"
}

# Run a repository command in the module root, in the correct POSIX context.
# Path arguments are translated automatically, so hooks pass native paths.
sdkwork_local_run() {
  local args=() arg
  for arg in "$@"; do args+=("$(sdkwork_local_path "${arg}")"); done

  if sdkwork_needs_wsl_bridge; then
    sdkwork_wsl_resolve
    local dir inner
    dir="$(sdkwork_wsl_path "${SDKWORK_MODULE_ROOT}")"
    inner="cd -- $(printf '%q' "${dir}") && $(sdkwork_shell_quote "${args[@]}")"
    sdkwork_run env MSYS_NO_PATHCONV=1 "${SDKWORK_WSL_BIN}" -e bash -lc "${inner}"
    return $?
  fi
  ( cd "${SDKWORK_MODULE_ROOT}" && sdkwork_run "${args[@]}" )
}

# -----------------------------------------------------------------------------
# Environment / profile / app-type validation
# -----------------------------------------------------------------------------
sdkwork_validate_environment() {
  local raw="${1:-}" canonical
  case "${raw}" in
    dev)          canonical="development" ;;
    development|test|staging|demo) canonical="${raw}" ;;
    prod|production) canonical="production" ;;
    "") sdkwork_die "${SDKWORK_BIN_E_ENV}" "environment is required (--environment <development|test|staging|demo|production>)" ;;
    *)   sdkwork_die "${SDKWORK_BIN_E_ENV}" "unknown environment '${raw}' (use development|test|staging|demo|production)" ;;
  esac
  SDKWORK_BIN_ENVIRONMENT="${canonical}"
  printf '%s' "${canonical}"
}

# Sets SDKWORK_BIN_PROFILE (assigned by the caller), so validation failures
# exit with the canonical code instead of being masked by command substitution.
sdkwork_validate_profile() {
  case "${1:-}" in
    ""|standalone) SDKWORK_BIN_PROFILE="standalone" ;;
    cloud)         SDKWORK_BIN_PROFILE="cloud" ;;
    *) sdkwork_die "${SDKWORK_BIN_E_ENV}" "unknown profile '${1:-}' (use standalone|cloud)" ;;
  esac
}

# Canonical native-installer platform set (MODULE_BIN_SPEC.md §4.9).
# Sets SDKWORK_BIN_INSTALLER_PLATFORM (caller-assign pattern) and prints the
# canonical value.
sdkwork_validate_installer_platform() {
  case "${1:-}" in
    windows) SDKWORK_BIN_INSTALLER_PLATFORM="windows"; printf '%s' "windows" ;;
    linux)   SDKWORK_BIN_INSTALLER_PLATFORM="linux";   printf '%s' "linux" ;;
    macos)   SDKWORK_BIN_INSTALLER_PLATFORM="macos";   printf '%s' "macos" ;;
    android) SDKWORK_BIN_INSTALLER_PLATFORM="android"; printf '%s' "android" ;;
    ios)     SDKWORK_BIN_INSTALLER_PLATFORM="ios";     printf '%s' "ios" ;;
    "") sdkwork_die "${SDKWORK_BIN_E_ENV}" \
          "installer platform is required (windows|linux|macos|android|ios)" ;;
    *) sdkwork_die "${SDKWORK_BIN_E_ENV}" \
         "unknown installer platform '${1:-}' (use windows|linux|macos|android|ios)" ;;
  esac
}

# Canonical installer CPU architecture (MODULE_BIN_SPEC.md §4.9).
sdkwork_validate_arch() {
  case "${1:-}" in
    x64|arm64) printf '%s' "${1}" ;;
    *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" \
         "unknown architecture '${1:-}' (use x64|arm64)" ;;
  esac
}

# Canonical domain-registry alias for an environment (PNPM_SCRIPT_SPEC.md §4.2).
sdkwork_environment_alias() {
  case "${1:-}" in
    development) printf 'dev' ;;
    test)        printf 'test' ;;
    staging)     printf 'staging' ;;
    demo)        printf 'demo' ;;
    production)  printf 'prod' ;;
    *) sdkwork_die "${SDKWORK_BIN_E_ENV}" "unknown environment '${1:-}'" ;;
  esac
}

sdkwork_require_app_type() {
  local app_type="$1"
  local -a declared=()
  local type
  [[ -n "${SDKWORK_APP_TYPES:-}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
    "bin/lib/module.sh did not declare SDKWORK_APP_TYPES"
  IFS=',' read -ra declared <<< "${SDKWORK_APP_TYPES}"
  for type in "${declared[@]}"; do
    type="$(printf '%s' "${type}" | xargs)"
    [[ "${type}" == "${app_type}" ]] && return 0
  done
  sdkwork_die "${SDKWORK_BIN_E_ENV}" \
    "app type '${app_type}' not declared by ${SDKWORK_MODULE_ID:-this module} (declared: ${SDKWORK_APP_TYPES})"
}

# -----------------------------------------------------------------------------
# Image reference canon (DOCKER_SPEC.md §2.1)
# -----------------------------------------------------------------------------
sdkwork_validate_image_tag() {
  local tag="${1:-}"
  [[ -n "${tag}" ]] || sdkwork_die "${SDKWORK_BIN_E_USAGE}" "image tag is required"
  # Charset whitelist: a tag flows into docker refs, compose interpolation,
  # artifact globs, and ledger JSON, so anything outside the OCI-safe set is
  # rejected before it can fragment an argv or a glob.
  case "${tag}" in
    *[!A-Za-z0-9._-]*)
      sdkwork_die "${SDKWORK_BIN_E_USAGE}" "image tag '${tag}' must match [A-Za-z0-9._-] only (DOCKER_SPEC.md §2.1)" ;;
  esac
  (( ${#tag} <= 128 )) || sdkwork_die "${SDKWORK_BIN_E_USAGE}" "image tag '${tag}' exceeds the 128-character OCI limit"
  case "${tag}" in
    *-development|*-test|*-staging|*-demo|*-production|*-dev|*-prod)
      sdkwork_die "${SDKWORK_BIN_E_USAGE}" "image tag '${tag}' must not contain an environment segment (DOCKER_SPEC.md §2.1)" ;;
    latest)
      sdkwork_die "${SDKWORK_BIN_E_USAGE}" "'latest' tags are forbidden (DOCKER_SPEC.md §2.1)" ;;
  esac
}

sdkwork_image_ref() {
  local docker_name="$1" tag="${2:-}"
  [[ -n "${docker_name}" ]] || sdkwork_die "${SDKWORK_BIN_E_USAGE}" "image name is required"
  sdkwork_validate_image_tag "${tag}"
  printf 'registry.sdkwork.com/apps/%s:%s' "${docker_name}" "${tag}"
}

# Assert the canonical ref exists locally after a build (dry-run aware).
sdkwork_assert_image_present() {
  local ref="$1"
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: docker image inspect ${ref}"
    return 0
  fi
  sdkwork_local_run docker image inspect "${ref}" >/dev/null 2>&1 \
    || sdkwork_die "${SDKWORK_BIN_E_STATE}" "image build did not produce ${ref} (check the repo container build output)"
  sdkwork_log "image present: ${ref}"
}

# -----------------------------------------------------------------------------
# Dry-run aware executor and production gate
# -----------------------------------------------------------------------------
sdkwork_run() {
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: $*"
    return 0
  fi
  sdkwork_log "$*"
  "$@"
}

sdkwork_confirm_production() {
  if [[ "${SDKWORK_BIN_ENVIRONMENT}" == "production" && "${SDKWORK_BIN_YES}" != "1" ]]; then
    sdkwork_die "${SDKWORK_BIN_E_REFUSED}" \
      "production mutation refused; re-run with --yes to confirm"
  fi
  return 0
}

# Destructive-option gate: independent of environment (e.g. --purge).
sdkwork_confirm_destructive() {
  if [[ "${SDKWORK_BIN_YES}" != "1" ]]; then
    sdkwork_die "${SDKWORK_BIN_E_REFUSED}" "${1:-this action} is destructive; re-run with --yes to confirm"
  fi
  return 0
}

# Option value guard: <option> <value> — rejects a missing or flag-like value.
sdkwork_need_value() {
  local option="$1" value="${2-}"
  if [[ -z "${value}" || "${value}" == -* ]]; then
    sdkwork_die "${SDKWORK_BIN_E_USAGE}" "${option} requires a value"
  fi
  printf '%s' "${value}"
}

# -----------------------------------------------------------------------------
# Unified target execution: wsl (local/bridged) or ssh://[user@]host[:port]
# -----------------------------------------------------------------------------
sdkwork_remote_parse() {
  local target="${1:-}"
  case "${target}" in
    wsl|local)
      SDKWORK_REMOTE_KIND="wsl" ;;
    ssh://*)
      SDKWORK_REMOTE_KIND="ssh"
      local rest="${target#ssh://}" user="" host="" port="22"
      rest="${rest%%/}"
      if [[ "${rest}" == *@* ]]; then user="${rest%%@*}"; rest="${rest#*@}"; fi
      if [[ "${rest}" == *:* ]]; then port="${rest##*:}"; host="${rest%%:*}"; else host="${rest}"; fi
      [[ -n "${host}" ]] || sdkwork_die "${SDKWORK_BIN_E_USAGE}" "invalid ssh target '${target}'"
      case "${port}" in
        ''|*[!0-9]*) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "invalid port in ssh target '${target}' (use ssh://[user@]host[:port])" ;;
      esac
      (( port >= 1 && port <= 65535 )) || sdkwork_die "${SDKWORK_BIN_E_USAGE}" \
        "port out of range in ssh target '${target}'"
      SDKWORK_SSH_USER="${user}"; SDKWORK_SSH_HOST="${host}"; SDKWORK_SSH_PORT="${port}" ;;
    "")
      sdkwork_die "${SDKWORK_BIN_E_USAGE}" "--host is required (use wsl or ssh://[user@]host[:port])" ;;
    *)
      sdkwork_die "${SDKWORK_BIN_E_USAGE}" "invalid --host '${target}' (use wsl or ssh://[user@]host[:port])" ;;
  esac
}

# Run argv on the target inside <dir>; every bundle entrypoint is reached
# through this so the working directory is never left to the target's default.
sdkwork_remote_in_dir() {
  local target="$1" dir="$2"; shift 2
  local inner="cd -- $(printf '%q' "${dir}") && $(sdkwork_shell_quote "$@")"
  sdkwork_remote "${target}" bash -lc "${inner}"
}

sdkwork_remote_in_dir_capture() {
  local target="$1" dir="$2"; shift 2
  local inner="cd -- $(printf '%q' "${dir}") && $(sdkwork_shell_quote "$@")"
  sdkwork_remote_capture "${target}" bash -lc "${inner}"
}

sdkwork_remote() {
  local target="$1"; shift
  sdkwork_remote_parse "${target}"

  if [[ "${SDKWORK_REMOTE_KIND}" == "wsl" ]]; then
    if sdkwork_needs_wsl_bridge; then
      sdkwork_wsl_resolve
      sdkwork_run env MSYS_NO_PATHCONV=1 "${SDKWORK_WSL_BIN}" -e bash -lc "$(sdkwork_shell_quote "$@")"
      return $?
    fi
    sdkwork_run "$@"
    return $?
  fi

  local login=()
  [[ -n "${SDKWORK_SSH_USER}" ]] && login=(-l "${SDKWORK_SSH_USER}")
  sdkwork_run ssh -p "${SDKWORK_SSH_PORT}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    ${login[@]+"${login[@]}"} "${SDKWORK_SSH_HOST}" -- "$@"
}

sdkwork_push_dir() {
  local target="$1" src="$2" dest="$3"; shift 3
  # Optional trailing arguments are tar exclude patterns relative to <src>
  # (e.g. ./image.tar.gz when the target already runs this version).
  local excludes=() e
  for e in "$@"; do excludes+=(--exclude="${e}"); done
  if [[ ! -e "${src}" ]]; then
    if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
      sdkwork_warn "dry-run: source path missing: ${src}"
      return 0
    fi
    sdkwork_die "${SDKWORK_BIN_E_STATE}" "source path missing: ${src}"
  fi
  sdkwork_remote_parse "${target}"

  if [[ "${SDKWORK_REMOTE_KIND}" == "wsl" ]]; then
    if sdkwork_needs_wsl_bridge; then
      sdkwork_wsl_resolve
      sdkwork_run env MSYS_NO_PATHCONV=1 "${SDKWORK_WSL_BIN}" -e bash -lc "mkdir -p $(printf '%q' "${dest}")"
      if [[ "${SDKWORK_BIN_DRY_RUN}" != "1" ]]; then
        MSYS_NO_PATHCONV=1 tar -C "${src}" ${excludes[@]+"${excludes[@]}"} -czf - . \
          | MSYS_NO_PATHCONV=1 "${SDKWORK_WSL_BIN}" -e bash -lc "tar --no-same-permissions -xzf - -C $(printf '%q' "${dest}")"
        # A tar produced on a Windows drive records 0777; normalize the landed
        # tree to umask-safe modes (755 dirs / 644 files, exec bits kept).
        MSYS_NO_PATHCONV=1 "${SDKWORK_WSL_BIN}" -e bash -lc \
          "chmod -R u+rwX,go+rX,go-w $(printf '%q' "${dest}")"
      fi
      return 0
    fi
    sdkwork_run mkdir -p "${dest}"
    if [[ "${SDKWORK_BIN_DRY_RUN}" != "1" ]]; then
      cp -a "${src}/." "${dest}/"
      chmod -R u+rwX,go+rX,go-w "${dest}"
    fi
    return 0
  fi

  local login=()
  [[ -n "${SDKWORK_SSH_USER}" ]] && login=(-l "${SDKWORK_SSH_USER}")
  sdkwork_run ssh -p "${SDKWORK_SSH_PORT}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    ${login[@]+"${login[@]}"} "${SDKWORK_SSH_HOST}" "mkdir -p $(printf '%q' "${dest}")"
  if [[ "${SDKWORK_BIN_DRY_RUN}" != "1" ]]; then
    tar -C "${src}" ${excludes[@]+"${excludes[@]}"} -czf - . \
      | ssh -p "${SDKWORK_SSH_PORT}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
          ${login[@]+"${login[@]}"} "${SDKWORK_SSH_HOST}" \
          "tar --no-same-permissions -xzf - -C $(printf '%q' "${dest}") && chmod -R u+rwX,go+rX,go-w $(printf '%q' "${dest}")"
  else
    sdkwork_log "dry-run: tar stream ${src} -> ${SDKWORK_SSH_HOST}:${dest}"
  fi
}

# Probe a file on the target without aborting the run (returns 0/1).
sdkwork_remote_file_exists() {
  local target="$1" path="$2" status=0
  [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]] && return 0
  sdkwork_remote_parse "${target}"
  set +e
  if [[ "${SDKWORK_REMOTE_KIND}" == "wsl" ]]; then
    if sdkwork_needs_wsl_bridge; then
      sdkwork_wsl_resolve
      env MSYS_NO_PATHCONV=1 "${SDKWORK_WSL_BIN}" -e bash -lc "test -f $(printf '%q' "${path}")" >/dev/null 2>&1
    else
      test -f "${path}"
    fi
  else
    local login=()
    [[ -n "${SDKWORK_SSH_USER}" ]] && login=(-l "${SDKWORK_SSH_USER}")
    ssh -p "${SDKWORK_SSH_PORT}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
      ${login[@]+"${login[@]}"} "${SDKWORK_SSH_HOST}" "test -f $(printf '%q' "${path}")" >/dev/null 2>&1
  fi
  status=$?
  set -e
  return "${status}"
}

# -----------------------------------------------------------------------------
# Packaging primitives (MODULE_BIN_SPEC.md §4.4): every artifact carries a
# sidecar .sha256 and lands in --out.
# -----------------------------------------------------------------------------
sdkwork_write_checksum() {
  local file="$1" digest
  [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]] && return 0
  digest="$(sdkwork_sha256_file "${file}")"
  # Two-space separator keeps the sidecar compatible with both
  # `sha256sum -c` (GNU) and `shasum -a 256 -c` (macOS).
  printf '%s  %s\n' "${digest}" "$(basename "${file}")" > "$(dirname "${file}")/$(basename "${file}").sha256"
}

sdkwork_tar_artifact() {
  local src="$1" artifact="$2"
  sdkwork_require_dir "${src}" "build it before packaging"
  mkdir -p "$(dirname "${artifact}")"
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: tar -C ${src} -czf ${artifact} (+ ${artifact}.sha256)"
    return 0
  fi
  [[ -d "${src}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" "artifact source missing: ${src}"
  sdkwork_run tar -C "${src}" -czf "${artifact}" .
  sdkwork_write_checksum "${artifact}"
  sdkwork_log "packaged ${artifact}"
}

# Newest file in <dir> matching <pattern> (empty when nothing matches).
# Deliberately avoids `shopt nullglob`: `shopt -p` exits 1 for an unset option,
# which would abort every caller under `set -e`. The `[[ -f ]]` guard filters
# the unexpanded pattern instead.
sdkwork_latest_match() {
  local dir="$1" pattern="$2" best="" best_ts=-1 file ts
  [[ -d "${dir}" ]] || return 0
  for file in "${dir}"/${pattern}; do
    [[ -f "${file}" ]] || continue
    ts="$(sdkwork_file_mtime "${file}")"
    if (( ts >= best_ts )); then best_ts="${ts}"; best="${file}"; fi
  done
  printf '%s' "${best}"
}

# Path/artifact guards that dry-run reports instead of enforcing.
sdkwork_require_dir() {
  local dir="$1" hint="${2:-}"
  if [[ -d "${dir}" ]]; then return 0; fi
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_warn "dry-run: ${dir} does not exist yet${hint:+ (${hint})}"
    return 0
  fi
  sdkwork_die "${SDKWORK_BIN_E_STATE}" "missing: ${dir}${hint:+ (${hint})}"
}

# Newest artifact in <dir> matching <pattern>; dry-run returns a placeholder so
# the plan still prints before the packager has ever run.
sdkwork_require_artifact() {
  local dir="$1" pattern="$2" hint="${3:-}"
  local found
  found="$(sdkwork_latest_match "${dir}" "${pattern}")"
  if [[ -n "${found}" ]]; then printf '%s' "${found}"; return 0; fi
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_warn "dry-run: no ${pattern} in ${dir} yet${hint:+ (${hint})}"
    printf '%s' "${dir}/<${pattern}>"
    return 0
  fi
  sdkwork_die "${SDKWORK_BIN_E_STATE}" "no artifact matching '${pattern}' in ${dir}${hint:+ (${hint})}"
}

# Copy the newest artifact produced by a repo packager into --out (+ .sha256).
# Usage: sdkwork_collect_artifact <src-dir> <out-dir> <pattern> [<fallback-pattern>…]
sdkwork_collect_artifact() {
  local src_dir="$1" out="$2"; shift 2
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: would collect [$*] from ${src_dir} into ${out}"
    return 0
  fi
  local pattern found="" base
  for pattern in "$@"; do
    found="$(sdkwork_latest_match "${src_dir}" "${pattern}")"
    if [[ -n "${found}" ]]; then break; fi
  done
  [[ -n "${found}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
    "no packaged artifact matching any of [$*] in ${src_dir} (did the repo packager run?)"
  base="$(basename "${found}")"
  mkdir -p "${out}"
  sdkwork_run cp -f "${found}" "${out}/${base}"
  if [[ -f "${found}.sha256" ]]; then
    sdkwork_run cp -f "${found}.sha256" "${out}/${base}.sha256"
  else
    sdkwork_write_checksum "${out}/${base}"
  fi
  sdkwork_log "collected ${out}/${base}"
}

# Fail the run when --out received no artifact, or one without its checksum.
sdkwork_assert_out_artifacts() {
  local out="$1" file count=0
  [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]] && return 0
  # Installer formats (MODULE_BIN_SPEC.md §4.9): msi/exe (Windows), pkg/dmg
  # (macOS), AppImage (Linux), ipa (iOS) — apk/aab/deb/rpm/zip/tar.gz above.
  for file in "${out}"/*.tar.gz "${out}"/*.deb "${out}"/*.rpm "${out}"/*.zip \
              "${out}"/*.apk "${out}"/*.aab "${out}"/*.msi "${out}"/*.exe \
              "${out}"/*.pkg "${out}"/*.dmg "${out}"/*.AppImage "${out}"/*.ipa; do
    [[ -f "${file}" ]] || continue
    count=$((count + 1))
    [[ -f "${file}.sha256" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
      "artifact without checksum: ${file} (packaging must emit a sidecar .sha256)"
  done
  (( count > 0 )) || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
    "packaging produced no artifact in ${out} (MODULE_BIN_SPEC.md §4.4)"
  sdkwork_log "artifacts in ${out}: ${count}"
}

# -----------------------------------------------------------------------------
# systemd + health primitives shared by every host-native app deployment
# (MODULE_BIN_SPEC.md §4.5)
# -----------------------------------------------------------------------------
sdkwork_service_enable_now() {
  local target="$1" unit="$2"
  sdkwork_remote "${target}" systemctl daemon-reload
  sdkwork_remote "${target}" systemctl enable --now "${unit}"
  sdkwork_remote "${target}" systemctl is-active "${unit}"
}

sdkwork_service_status() {
  local target="$1" unit="$2"
  sdkwork_remote "${target}" systemctl is-active "${unit}"
}

sdkwork_health_probe() {
  local target="$1" url="$2"
  sdkwork_remote "${target}" curl -fsS --max-time 5 "${url}"
}

# -----------------------------------------------------------------------------
# Remote stdout capture and file transfer (OPERATIONS_SPEC.md §3)
#
# `sdkwork_remote` echoes and executes; the config/doctor/backup flows need the
# *output* of a remote command. These helpers are the only place a remote
# command's stdout is captured, so dry-run handling stays in one spot.
# -----------------------------------------------------------------------------
sdkwork_utc_stamp() { date -u '+%Y%m%dT%H%M%SZ'; }

# -----------------------------------------------------------------------------
# Portability shims (PORTABILITY_SPEC.md): operator-side scripts must run on
# any Linux distribution and on macOS, where GNU coreutils (sha256sum, GNU
# stat) may be absent. Every shim picks the first available implementation.
# -----------------------------------------------------------------------------

# SHA-256 digest (hex) of one file: sha256sum → shasum → openssl.
# PORTABILITY:allow — shim probes tool availability before each use.
sdkwork_sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then        # PORTABILITY:allow
    sha256sum "${file}" | awk '{print $1}'              # PORTABILITY:allow
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file}" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "${file}" | awk '{print $NF}'
  else
    sdkwork_die "${SDKWORK_BIN_E_STATE}" "no sha256 tool found (install coreutils or perl shasum)"
  fi
}

# mtime epoch seconds of one file: GNU stat → BSD/macOS stat → 0.
# PORTABILITY:allow — shim probes stat variants before each use.
sdkwork_file_mtime() {
  local file="$1"
  if stat -c '%Y' "${file}" >/dev/null 2>&1; then      # PORTABILITY:allow
    stat -c '%Y' "${file}"                              # PORTABILITY:allow
  elif stat -f '%m' "${file}" >/dev/null 2>&1; then
    stat -f '%m' "${file}"
  else
    printf '0'
  fi
}

sdkwork_remote_capture() {
  local target="$1"; shift
  sdkwork_remote_parse "${target}"
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: capture ${*}" >&2
    return 0
  fi
  if [[ "${SDKWORK_REMOTE_KIND}" == "wsl" ]]; then
    if sdkwork_needs_wsl_bridge; then
      sdkwork_wsl_resolve
      env MSYS_NO_PATHCONV=1 "${SDKWORK_WSL_BIN}" -e bash -lc "$(sdkwork_shell_quote "$@")"
      return $?
    fi
    "$@"
    return $?
  fi
  local login=()
  [[ -n "${SDKWORK_SSH_USER}" ]] && login=(-l "${SDKWORK_SSH_USER}")
  ssh -p "${SDKWORK_SSH_PORT}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    ${login[@]+"${login[@]}"} "${SDKWORK_SSH_HOST}" -- "$@"
}

# Print a remote file on stdout (empty under --dry-run).
sdkwork_remote_read_file() {
  local target="$1" path="$2"
  sdkwork_remote_capture "${target}" cat -- "${path}" 2>/dev/null
}

sdkwork_remote_dir_exists() {
  local target="$1" path="$2" status=0
  [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]] && return 0
  sdkwork_remote_capture "${target}" test -d "${path}" >/dev/null 2>&1 || status=$?
  return "${status}"
}

# 0 when the target already holds this image reference.
sdkwork_remote_image_exists() {
  local target="$1" ref="$2" status=0
  [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]] && return 0
  sdkwork_remote_capture "${target}" docker image inspect -- "${ref}" >/dev/null 2>&1 || status=$?
  return "${status}"
}

# Write <local-file> to <path> on the target, keeping a timestamped backup
# (OPERATIONS_SPEC §3.3). The base64 payload travels on STDIN, never in argv:
# a multi-KB env file busts the Windows CreateProcess argument limit, and an
# argv-embedded payload would leak its (secret-bearing) content into every
# command echo and process listing. Configuration files land at 0600 — both
# freshly created and overwritten — so secrets are never group/world readable
# on the target (an ext4 target; drvfs mounts cannot represent the mode).
sdkwork_remote_write_file() {
  local target="$1" path="$2" local_file="$3" backup="${4:-1}"
  [[ -f "${local_file}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" "no local file to write: ${local_file}"
  sdkwork_remote_parse "${target}"
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: write ${local_file} -> ${target}:${path} (backup=${backup})"
    return 0
  fi
  local payload stamp qpath script
  # PORTABILITY:allow — GNU -w0 probed with an explicit non-GNU fallback.
  payload="$(base64 -w0 < "${local_file}" 2>/dev/null || base64 < "${local_file}" | tr -d '\r\n')"
  stamp="$(sdkwork_utc_stamp)"
  qpath="$(printf '%q' "${path}")"
  script="set -e; mkdir -p $(printf '%q' "$(dirname "${path}")")"
  if [[ "${backup}" == "1" ]]; then
    script+="; if [ -f ${qpath} ]; then cp -a ${qpath} ${qpath}.bak.${stamp}; fi"
  fi
  script+="; base64 -d > ${qpath}.tmp"
  script+="; if [ -f ${qpath} ]; then cat ${qpath}.tmp > ${qpath}; rm -f ${qpath}.tmp; else mv -f ${qpath}.tmp ${qpath}; fi"
  script+="; chmod 600 ${qpath}"
  sdkwork_log "write ${local_file} -> ${target}:${path} (backup=${backup})"
  if [[ "${SDKWORK_REMOTE_KIND}" == "wsl" ]]; then
    if sdkwork_needs_wsl_bridge; then
      sdkwork_wsl_resolve
      printf '%s' "${payload}" | env MSYS_NO_PATHCONV=1 "${SDKWORK_WSL_BIN}" -e bash -lc "${script}"
      return $?
    fi
    printf '%s' "${payload}" | bash -lc "${script}"
    return $?
  fi
  local login=()
  [[ -n "${SDKWORK_SSH_USER}" ]] && login=(-l "${SDKWORK_SSH_USER}")
  printf '%s' "${payload}" \
    | ssh -p "${SDKWORK_SSH_PORT}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
        ${login[@]+"${login[@]}"} "${SDKWORK_SSH_HOST}" "bash -lc $(printf '%q' "${script}")"
}

# -----------------------------------------------------------------------------
# Secret classification and redaction (OPERATIONS_SPEC.md §3.4)
# Declared once here; module wrappers MUST NOT re-declare these patterns.
# -----------------------------------------------------------------------------
# NOTE: inside a double-quoted `${var:=default}` expansion single quotes are
# LITERAL characters, so these defaults must not be quoted or the regex
# constants would start with a literal apostrophe and never match.
: "${SDKWORK_SECRET_NAME_PATTERN:=(SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|CREDENTIAL|APIKEY|API_KEY|ACCESS_KEY|DSN)}"
: "${SDKWORK_SECRET_NAME_ALLOW:=(PUBLIC_KEY|JWKS|PRIMARY_DOMAIN|TLS_|LOG_LEVEL|NODE_ID|CERT_EMAIL|ACME_)}"
: "${SDKWORK_SECRET_VALUE_PATTERN:=^[A-Za-z][A-Za-z0-9+.-]*://[^/@[:space:]]*:[^@/[:space:]]+@}"
: "${SDKWORK_REDACTED:=***REDACTED***}"
: "${SDKWORK_PLACEHOLDER_PATTERN:=^<CHANGE_ME>$}"

# 0 when <key> is a secret, 1 otherwise (name pattern OR embedded credentials).
sdkwork_is_secret_key() {
  local key="${1:-}" value="${2:-}"
  if [[ "${key}" =~ ${SDKWORK_SECRET_NAME_ALLOW} ]]; then
    [[ "${value}" =~ ${SDKWORK_SECRET_VALUE_PATTERN} ]] && return 0
    return 1
  fi
  [[ "${key}" =~ ${SDKWORK_SECRET_NAME_PATTERN} ]] && return 0
  [[ "${value}" =~ ${SDKWORK_SECRET_VALUE_PATTERN} ]] && return 0
  return 1
}

sdkwork_redact_value() {
  local key="$1" value="$2" reveal="${3:-0}"
  [[ "${reveal}" == "1" ]] && { printf '%s' "${value}"; return 0; }
  if sdkwork_is_secret_key "${key}" "${value}"; then printf '%s' "${SDKWORK_REDACTED}"; else printf '%s' "${value}"; fi
}

# 0 when the value is an unfilled placeholder (blocking outside dev/test).
sdkwork_is_placeholder_value() {
  local value="${1:-}"
  [[ -z "${value}" || "${value}" =~ ${SDKWORK_PLACEHOLDER_PATTERN} ]]
}

# Local scratch root for pulled configuration and exported diagnostics.
sdkwork_scratch_dir() {
  printf '%s/target/bin-ops' "${SDKWORK_MODULE_ROOT}"
}

# Pulled configuration files carry secrets; the cache directory is created
# operator-private (0700) regardless of the caller's umask.
sdkwork_prepare_private_dir() {
  mkdir -p "$1"
  chmod 700 "$1" 2>/dev/null || true
}

# -----------------------------------------------------------------------------
# Evidence — records the plan at start and the exit status at exit
# (MODULE_BIN_SPEC.md §3).
# -----------------------------------------------------------------------------
sdkwork_evidence() {
  SDKWORK_BIN_EVIDENCE_MSG="$*"
}

sdkwork_evidence_flush() {
  local status=$?
  trap - EXIT
  if [[ -n "${SDKWORK_BIN_EVIDENCE_MSG}" && "${SDKWORK_BIN_DRY_RUN}" != "1" && -n "${SDKWORK_MODULE_ROOT}" ]]; then
    local dir="${SDKWORK_MODULE_ROOT}/target/bin-evidence"
    mkdir -p "${dir}" 2>/dev/null || { exit "${status}"; }
    printf '%s | env=%s profile=%s host=%s | status=%s | %s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
      "${SDKWORK_BIN_ENVIRONMENT}" "${SDKWORK_BIN_PROFILE}" "${SDKWORK_BIN_HOST}" \
      "${status}" "${SDKWORK_BIN_EVIDENCE_MSG}" \
      >> "${dir}/evidence.log" 2>/dev/null || true
  fi
  exit "${status}"
}
