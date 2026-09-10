#!/usr/bin/env bash
# ops-config.sh — deployed-configuration inspection and mutation.
# Authority: sdkwork-specs/OPERATIONS_SPEC.md §3.
#
# Sourced by bin/lib/bootstrap.sh after sdkwork-common.sh. Every operation
# reads the live configuration from the deployed bundle on the target host
# (default wsl), renders the exact precedence chain, redacts secrets, and
# backs up before it mutates.
#
# Module contract (bin/lib/module.sh):
#   SDKWORK_CONFIG_ENV_SUBDIR        env dir relative to the deployed bundle
#                                    (default: env)
#   sdkwork_module_local_env_dir     optional; local source tree env dir used
#                                    for --dry-run rendering
#   sdkwork_module_config_validate   optional; validate one local env file

# Guard: this library must be sourced, not executed.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "ops-config.sh is a library; source it from bin/config.sh" >&2
  exit 64
fi

# Global state. Portability note (PORTABILITY_SPEC.md): macOS ships bash 3.2,
# which has no associative arrays and no `declare -g`, so key/value stores use
# PARALLEL INDEXED arrays (keys aligned with values/layers by subscript) and
# every function re-assigns them instead of `declare -g`.
SDKWORK_CONFIG_FILES=()
SDKWORK_CONFIG_KEYS=()
SDKWORK_CONFIG_VALUES=()
SDKWORK_CONFIG_LAYERS=()
# Result slot for sdkwork_config_index_of — the lookup returns through this
# global instead of printf + command substitution so that hot paths (load,
# show, diff scan every key) do not fork one subshell per key. That fork cost
# is negligible on Linux but minutes on Windows/MSYS hosts.
SDKWORK_CONFIG_INDEX=-1

# Sets SDKWORK_CONFIG_INDEX to the first subscript of <key> inside
# SDKWORK_CONFIG_KEYS, or -1 when absent.
sdkwork_config_index_of() {
  local key="$1" n i
  n=${#SDKWORK_CONFIG_KEYS[@]}
  for ((i = 0; i < n; i++)); do
    if [[ "${SDKWORK_CONFIG_KEYS[i]}" == "${key}" ]]; then
      SDKWORK_CONFIG_INDEX="${i}"
      return 0
    fi
  done
  SDKWORK_CONFIG_INDEX=-1
  return 0
}

# -----------------------------------------------------------------------------
# Resolution chain (OPERATIONS_SPEC.md §3.1)
# -----------------------------------------------------------------------------
sdkwork_config_env_dir() {
  printf '%s/%s' "$(sdkwork_remote_bundle_dir)" "${SDKWORK_CONFIG_ENV_SUBDIR:-env}"
}

sdkwork_config_chain() {
  local environment="$1" instance="${2:-1}" dir
  dir="$(sdkwork_config_env_dir)"
  printf '%s/%s.env\n' "${dir}" "${environment}"
  printf '%s/%s.i%s.env\n' "${dir}" "${environment}" "${instance}"
}

sdkwork_config_local_dir() {
  if declare -F sdkwork_module_local_env_dir >/dev/null 2>&1; then
    sdkwork_module_local_env_dir
    return
  fi
  printf '%s/deployments/docker/env' "${SDKWORK_MODULE_ROOT}"
}

sdkwork_config_cache_dir() {
  printf '%s/config/%s/%s' "$(sdkwork_scratch_dir)" \
    "${SDKWORK_BIN_HOST//[^A-Za-z0-9_.-]/_}" "${SDKWORK_BIN_ENVIRONMENT}"
}

# Pulls every existing chain file into a local scratch dir. Populates
# SDKWORK_CONFIG_FILES (base layer first).
sdkwork_config_pull() {
  local environment="$1" instance="${2:-1}"
  local remote base local_file local_dir
  SDKWORK_CONFIG_FILES=()
  local_dir="$(sdkwork_config_local_dir)"
  SDKWORK_CONFIG_CACHE_DIR="$(sdkwork_config_cache_dir)"
  sdkwork_prepare_private_dir "${SDKWORK_CONFIG_CACHE_DIR}"

  while IFS= read -r remote; do
    [[ -n "${remote}" ]] || continue
    base="$(basename "${remote}")"
    local_file="${SDKWORK_CONFIG_CACHE_DIR}/${base}"
    if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
      # Nothing is deployed under a dry-run; render the source-tree copy so the
      # plan still shows the keys an operator would see. A module that has not
      # committed a live <env>.env yet falls back to its committed
      # <env>.env.example so pre-deploy inspection still works (the rendered
      # placeholders surface through diff/validate as blocking items, which is
      # exactly the pre-deploy signal an operator needs).
      if [[ -f "${local_dir}/${base}" ]]; then
        cp -f "${local_dir}/${base}" "${local_file}"
        SDKWORK_CONFIG_FILES+=("${local_file}")
      elif [[ -f "${local_dir}/${base}.example" ]]; then
        cp -f "${local_dir}/${base}.example" "${local_file}"
        sdkwork_warn "dry-run: ${remote} not deployed yet; rendering the committed ${base}.example"
        SDKWORK_CONFIG_FILES+=("${local_file}")
      else
        sdkwork_warn "dry-run: ${remote} not deployed yet (no source-tree copy either)"
      fi
      continue
    fi
    if sdkwork_remote_capture "${SDKWORK_BIN_HOST}" test -f "${remote}" >/dev/null 2>&1; then
      sdkwork_remote_read_file "${SDKWORK_BIN_HOST}" "${remote}" > "${local_file}" 2>/dev/null || true
      SDKWORK_CONFIG_FILES+=("${local_file}")
    fi
  done < <(sdkwork_config_chain "${environment}" "${instance}")

  if [[ ${#SDKWORK_CONFIG_FILES[@]} -eq 0 ]]; then
    sdkwork_die "${SDKWORK_BIN_E_STATE}" \
      "no configuration for '${environment}' on ${SDKWORK_BIN_HOST}:$(sdkwork_config_env_dir) (deploy first: bin/docker-deploy.sh install --environment ${environment})"
  fi
}

# Pulls exactly one remote config file; prints its local cache path.
sdkwork_config_pull_one() {
  local remote="$1" base local_file local_dir
  base="$(basename "${remote}")"
  local_dir="$(sdkwork_config_local_dir)"
  SDKWORK_CONFIG_CACHE_DIR="$(sdkwork_config_cache_dir)"
  sdkwork_prepare_private_dir "${SDKWORK_CONFIG_CACHE_DIR}"
  local_file="${SDKWORK_CONFIG_CACHE_DIR}/${base}"
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    [[ -f "${local_dir}/${base}" ]] && cp -f "${local_dir}/${base}" "${local_file}"
    printf '%s' "${local_file}"
    return 0
  fi
  sdkwork_remote_capture "${SDKWORK_BIN_HOST}" test -f "${remote}" >/dev/null 2>&1 \
    || sdkwork_die "${SDKWORK_BIN_E_STATE}" "configuration file not found on ${SDKWORK_BIN_HOST}: ${remote}"
  sdkwork_remote_read_file "${SDKWORK_BIN_HOST}" "${remote}" > "${local_file}" 2>/dev/null || true
  printf '%s' "${local_file}"
}

# -----------------------------------------------------------------------------
# Parsing (local, on the pulled copy)
# -----------------------------------------------------------------------------
# Flattens the chain into SDKWORK_CONFIG_KEYS plus the parallel arrays
# SDKWORK_CONFIG_VALUES / SDKWORK_CONFIG_LAYERS (last layer wins).
sdkwork_config_load() {
  local file line key value layer idx
  SDKWORK_CONFIG_KEYS=()
  SDKWORK_CONFIG_VALUES=()
  SDKWORK_CONFIG_LAYERS=()
  for file in "${SDKWORK_CONFIG_FILES[@]}"; do
    layer="$(basename "${file}")"
    while IFS= read -r line || [[ -n "${line}" ]]; do
      line="${line%$'\r'}"
      [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
      [[ "${line}" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
      key="${BASH_REMATCH[2]}"
      value="${BASH_REMATCH[3]}"
      sdkwork_config_index_of "${key}"
      idx="${SDKWORK_CONFIG_INDEX}"
      if (( idx < 0 )); then
        SDKWORK_CONFIG_KEYS+=("${key}")
        SDKWORK_CONFIG_VALUES+=("${value}")
        SDKWORK_CONFIG_LAYERS+=("${layer}")
      else
        SDKWORK_CONFIG_VALUES[idx]="${value}"
        SDKWORK_CONFIG_LAYERS[idx]="${layer}"
      fi
    done < "${file}"
  done
}

# Parses KEY=VALUE lines of one file into SDKWORK_CFG_PARSE_KEYS /
# SDKWORK_CFG_PARSE_VALUES (parallel indexed arrays; later occurrences win).
sdkwork_config_parse_pairs() {
  local file="$1" line key value n i idx
  SDKWORK_CFG_PARSE_KEYS=()
  SDKWORK_CFG_PARSE_VALUES=()
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ "${line}" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[2]}"
    value="${BASH_REMATCH[3]}"
    idx="-1"
    n=${#SDKWORK_CFG_PARSE_KEYS[@]}
    for ((i = 0; i < n; i++)); do
      if [[ "${SDKWORK_CFG_PARSE_KEYS[i]}" == "${key}" ]]; then idx="${i}"; break; fi
    done
    if (( idx < 0 )); then
      SDKWORK_CFG_PARSE_KEYS+=("${key}")
      SDKWORK_CFG_PARSE_VALUES+=("${value}")
    else
      SDKWORK_CFG_PARSE_VALUES[idx]="${value}"
    fi
  done < "${file}"
}

sdkwork_config_sorted_keys() {
  if ((${#SDKWORK_CONFIG_KEYS[@]})); then printf '%s\n' "${SDKWORK_CONFIG_KEYS[@]}" | sort; fi
}

# -----------------------------------------------------------------------------
# Actions (OPERATIONS_SPEC.md §3.2)
# -----------------------------------------------------------------------------
sdkwork_config_list() {
  local environment="$1" instance="${2:-1}" remote
  sdkwork_log "configuration chain for '${environment}' on ${SDKWORK_BIN_HOST} (later wins):"
  while IFS= read -r remote; do
    [[ -n "${remote}" ]] || continue
    if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
      sdkwork_log "  ${remote}"
      continue
    fi
    if sdkwork_remote_capture "${SDKWORK_BIN_HOST}" test -f "${remote}" >/dev/null 2>&1; then
      sdkwork_log "  [present] ${remote}"
    else
      sdkwork_log "  [absent ] ${remote}"
    fi
  done < <(sdkwork_config_chain "${environment}" "${instance}")
}

sdkwork_config_show() {
  local reveal="${1:-0}" key value layer idx
  # Same gate as `get --reveal` (OPERATIONS_SPEC.md §3.4): production values
  # are never printed unredacted, including through the show listing.
  if [[ "${reveal}" == "1" && "${SDKWORK_BIN_ENVIRONMENT}" == "production" ]]; then
    sdkwork_die "${SDKWORK_BIN_E_REFUSED}" "--reveal is not allowed in production (OPERATIONS_SPEC.md §3.4)"
  fi
  local -a sorted=()
  while IFS= read -r key; do
    [[ -n "${key}" ]] && sorted+=("${key}")
  done < <(sdkwork_config_sorted_keys)
  sdkwork_log "effective configuration '${SDKWORK_BIN_ENVIRONMENT}' (${#sorted[@]} keys, secrets redacted):"
  for key in "${sorted[@]}"; do
    sdkwork_config_index_of "${key}"
    idx="${SDKWORK_CONFIG_INDEX}"
    value="${SDKWORK_CONFIG_VALUES[idx]}"
    layer="${SDKWORK_CONFIG_LAYERS[idx]}"
    printf '  %-50s %-30s [%s]\n' "${key}" "$(sdkwork_redact_value "${key}" "${value}" "${reveal}")" "${layer}"
  done
}

sdkwork_config_get() {
  local key="$1" reveal="${2:-0}" idx
  sdkwork_config_index_of "${key}"
  idx="${SDKWORK_CONFIG_INDEX}"
  if (( idx < 0 )); then
    sdkwork_die "${SDKWORK_BIN_E_STATE}" \
      "key '${key}' is not defined in the ${SDKWORK_BIN_ENVIRONMENT} configuration chain"
  fi
  if [[ "${reveal}" == "1" && "${SDKWORK_BIN_ENVIRONMENT}" == "production" ]]; then
    sdkwork_die "${SDKWORK_BIN_E_REFUSED}" "--reveal is not allowed in production (OPERATIONS_SPEC.md §3.4)"
  fi
  if [[ "${reveal}" == "1" ]]; then
    sdkwork_evidence "config get --reveal key=${key} (value never written to evidence)"
  fi
  printf '%s\n' "$(sdkwork_redact_value "${key}" "${SDKWORK_CONFIG_VALUES[idx]}" "${reveal}")"
}

sdkwork_config_set() {
  local key="$1" value="$2" instance="${3:-1}"
  local target_file local_file tmp
  # The key is interpolated into grep/awk regexes below, so it must be a bare
  # identifier (same rule as the bundle deploy.sh --set guard).
  case "${key}" in
    ''|*[!A-Za-z0-9_]*) sdkwork_die "${SDKWORK_BIN_E_USAGE}" \
      "config key must be a bare identifier (letters, digits, _): '${key}'" ;;
  esac
  target_file="$(sdkwork_config_env_dir)/${SDKWORK_BIN_ENVIRONMENT}.env"
  local_file="$(sdkwork_config_pull_one "${target_file}")"
  tmp="${local_file}.new"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "${local_file}" 2>/dev/null; then
    # Replace in place; values can contain '&', '|' and backslashes, so awk
    # prints the whole line instead of running a substitution.
    awk -v k="${key}" -v v="${value}" '
      $0 ~ "^[[:space:]]*(export[[:space:]]+)?"k"=" { print k"="v; next }
      { print }
    ' "${local_file}" > "${tmp}"
  else
    cp -f "${local_file}" "${tmp}"
    printf '%s=%s\n' "${key}" "${value}" >> "${tmp}"
  fi
  mv -f "${tmp}" "${local_file}"
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: would write ${key}=$(sdkwork_redact_value "${key}" "${value}") into ${target_file} (backup + validate)"
    return 0
  fi
  sdkwork_remote_write_file "${SDKWORK_BIN_HOST}" "${target_file}" "${local_file}" 1
  sdkwork_log "set ${key} in ${target_file}; previous copy kept as ${target_file}.bak.<timestamp>"
  # Capture the validator status BEFORE branching: a bare `if cmd; then …; fi`
  # leaves $? at 0 when the condition is false, so the old `local status=$?`
  # after the if reported success even when validation had failed.
  local status=0
  sdkwork_config_validate "${SDKWORK_BIN_ENVIRONMENT}" "${instance}" || status=$?
  if (( status == 0 )); then
    sdkwork_log "validation passed"
  else
    sdkwork_warn "validation failed; restore the previous copy from ${target_file}.bak.<timestamp> on ${SDKWORK_BIN_HOST}"
  fi
  return "${status}"
}

# Compares the live env file against its example: missing keys, undeclared
# keys, and unfilled placeholders (OPERATIONS_SPEC.md §3.3/§3.4).
sdkwork_config_diff() {
  local environment="$1" instance="${2:-1}"
  local example_remote example_local
  example_remote="$(sdkwork_config_env_dir)/${environment}.env.example"
  example_local="$(sdkwork_config_pull_one "${example_remote}")"
  [[ -s "${example_local}" ]] || sdkwork_warn "example file unavailable: ${example_remote}"

  # The live chain (actual) and the example (expected) both parse into
  # parallel indexed arrays — associative arrays are not portable (macOS
  # bash 3.2), see PORTABILITY_SPEC.md.
  sdkwork_config_load
  sdkwork_config_parse_pairs "${example_local}"

  local missing=0 extra=0 placeholder=0 key idx n i j
  local -a sorted=()
  sdkwork_log "configuration drift for '${environment}':"
  # MISSING: declared by the example, absent from the live chain.
  n=${#SDKWORK_CFG_PARSE_KEYS[@]}
  for ((i = 0; i < n; i++)); do
    key="${SDKWORK_CFG_PARSE_KEYS[i]}"
    sdkwork_config_index_of "${key}"
    idx="${SDKWORK_CONFIG_INDEX}"
    if (( idx < 0 )); then
      sdkwork_log "  MISSING      ${key} (declared by the example)"
      missing=$((missing + 1))
    fi
  done
  # UNDECLARED / PLACEHOLDER over the live chain, sorted by key.
  while IFS= read -r key; do
    [[ -n "${key}" ]] && sorted+=("${key}")
  done < <(sdkwork_config_sorted_keys)
  for key in "${sorted[@]}"; do
    sdkwork_config_index_of "${key}"
    idx="${SDKWORK_CONFIG_INDEX}"
    i="-1"
    n=${#SDKWORK_CFG_PARSE_KEYS[@]}
    for ((j = 0; j < n; j++)); do
      if [[ "${SDKWORK_CFG_PARSE_KEYS[j]}" == "${key}" ]]; then i="${j}"; break; fi
    done
    if (( i < 0 )); then
      sdkwork_warn "  UNDECLARED   ${key} (not in the example — forward-compatible, review it)"
      extra=$((extra + 1))
      continue
    fi
    if sdkwork_is_placeholder_value "${SDKWORK_CONFIG_VALUES[idx]}"; then
      sdkwork_log "  PLACEHOLDER  ${key} (value still '${SDKWORK_CONFIG_VALUES[idx]:-<empty>}')"
      placeholder=$((placeholder + 1))
    fi
  done
  sdkwork_log "summary: ${missing} missing, ${extra} undeclared, ${placeholder} placeholder"
  case "${environment}" in
    staging|demo|production)
      if (( placeholder > 0 )); then
        sdkwork_warn "'${environment}' has ${placeholder} unfilled placeholder(s): bin/config.sh set <KEY> <VALUE> --environment ${environment}"
        return 1
      fi ;;
  esac
  return 0
}

# Module validator when declared, otherwise the drift/placeholder scan.
sdkwork_config_validate() {
  local environment="$1" instance="${2:-1}"
  local target_file local_file
  target_file="$(sdkwork_config_env_dir)/${environment}.env"
  local_file="$(sdkwork_config_pull_one "${target_file}")"
  if declare -F sdkwork_module_config_validate >/dev/null 2>&1; then
    sdkwork_log "validating '${environment}' with the module validator"
    sdkwork_module_config_validate "${local_file}"
    return $?
  fi
  sdkwork_warn "no module validator declared; falling back to the drift/placeholder scan"
  sdkwork_config_pull "${environment}" "${instance}"
  sdkwork_config_diff "${environment}" "${instance}"
}

# Pulls the live file, opens $EDITOR, and pushes it back with a backup.
sdkwork_config_edit() {
  local instance="${1:-1}" editor target_file local_file
  editor="${EDITOR:-}"
  [[ -n "${editor}" ]] || sdkwork_die "${SDKWORK_BIN_E_USAGE}" \
    "set EDITOR first (e.g. EDITOR=vi bin/config.sh edit --environment ${SDKWORK_BIN_ENVIRONMENT})"
  target_file="$(sdkwork_config_env_dir)/${SDKWORK_BIN_ENVIRONMENT}.env"
  local_file="$(sdkwork_config_pull_one "${target_file}")"
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: would open ${editor} on ${target_file} (pulled to ${local_file}) and push it back with a backup"
    return 0
  fi
  cp -f "${local_file}" "${local_file}.orig"
  "${editor}" "${local_file}" </dev/tty >/dev/tty 2>&1 \
    || sdkwork_die "${SDKWORK_BIN_E_FAILED}" "editor exited non-zero; nothing was changed"
  if cmp -s "${local_file}" "${local_file}.orig"; then
    sdkwork_log "no change; ${target_file} untouched"
    return 0
  fi
  sdkwork_remote_write_file "${SDKWORK_BIN_HOST}" "${target_file}" "${local_file}" 1
  sdkwork_log "updated ${target_file}; previous copy kept as ${target_file}.bak.<timestamp>"
  sdkwork_config_validate "${SDKWORK_BIN_ENVIRONMENT}" "${instance}" \
    || sdkwork_warn "validation failed; restore the previous copy from ${target_file}.bak.<timestamp> on ${SDKWORK_BIN_HOST}"
}
