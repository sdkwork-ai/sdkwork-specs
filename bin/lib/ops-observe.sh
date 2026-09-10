#!/usr/bin/env bash
# ops-observe.sh — log access and environment diagnostics.
# Authority: sdkwork-specs/OPERATIONS_SPEC.md §2.4 (log CLI) and §4 (doctor).
#
# Sourced by bin/lib/bootstrap.sh after sdkwork-common.sh and ops-config.sh.
# Both flows run on the target host and never mutate anything: `logs` reads
# compose output, `doctor` aggregates a read-only health report.
#
# Module contract (bin/lib/module.sh):
#   SDKWORK_PRIMARY_SERVICE       compose service used by default (default: app)
#   SDKWORK_HEALTH_PATH           health path (default: /healthz)
#   sdkwork_module_health_port    optional; <env> <instance> -> host port for the
#                                 probe. Doctor pulls the deployed env first so a
#                                 module hook may resolve the real published port
#                                 (instance stride offset included) instead of a
#                                 hardcoded default; see module.sh contract.
#   sdkwork_module_extra_doctor   optional; emit extra doctor rows
#   sdkwork_module_expected_image_tag <env>
#                                 optional; print the image tag the deployed
#                                 bundle considers authoritative (e.g. the
#                                 bundle image.env), consulted before the env
#                                 chain by the doctor image-drift check

# Guard: this library must be sourced, not executed.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "ops-observe.sh is a library; source it from bin/doctor.sh" >&2
  exit 64
fi

: "${SDKWORK_PRIMARY_SERVICE:=app}"
: "${SDKWORK_HEALTH_PATH:=/healthz}"
: "${SDKWORK_LOG_TAIL_DEFAULT:=200}"

# Global doctor state (file-scope so functions can re-assign portably; macOS
# bash 3.2 has no `declare -g`, see PORTABILITY_SPEC.md).
SDKWORK_DOCTOR_ROWS=()
SDKWORK_DOCTOR_FAIL=0
SDKWORK_DOCTOR_WARN=0
SDKWORK_DOCTOR_PASS=0

# -----------------------------------------------------------------------------
# Log access (OPERATIONS_SPEC.md §2.4)
# -----------------------------------------------------------------------------
# Builds the bundle-side argv; the bundle deploy.sh owns the compose call.
sdkwork_logs_bundle_args() {
  local environment="$1" instance="$2" service="$3" tail="$4" since="$5" follow="$6"
  local args=(bash deploy.sh --environment "${environment}" --logs "${instance}")
  [[ -n "${service}" ]] && args+=(--service "${service}")
  [[ -n "${tail}" ]] && args+=(--tail "${tail}")
  [[ -n "${since}" ]] && args+=(--since "${since}")
  [[ "${follow}" == "1" ]] && args+=(--follow)
  printf '%s\n' "${args[@]}"
}

sdkwork_observe_logs() {
  local environment="$1" instance="$2" service="$3" tail="$4" since="$5" follow="$6" export_dir="$7"
  local remote_dir
  remote_dir="$(sdkwork_remote_bundle_dir)"
  local -a args=()
  local _line
  while IFS= read -r _line; do
    [[ -n "${_line}" ]] && args+=("${_line}")
  done < <(sdkwork_logs_bundle_args "${environment}" "${instance}" "${service}" "${tail}" "${since}" "${follow}")

  if [[ -z "${export_dir}" ]]; then
    if sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" "${remote_dir}/deploy.sh"; then
      sdkwork_remote_in_dir "${SDKWORK_BIN_HOST}" "${remote_dir}" "${args[@]}"
    else
      sdkwork_warn "no deployed bundle at ${SDKWORK_BIN_HOST}:${remote_dir}; run 'bin/docker-deploy.sh install --environment ${environment}' first"
    fi
    return 0
  fi

  # Export: force a bounded read (never stream into a file) and write a
  # checksummed gzip next to the operator's incident notes.
  mkdir -p "${export_dir}"
  local stamp file base
  stamp="$(sdkwork_utc_stamp)"
  base="${SDKWORK_MODULE_ID}-${environment}-i${instance}-${service:-${SDKWORK_PRIMARY_SERVICE}}-${stamp}.log"
  file="${export_dir}/${base}"
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: would export logs to ${file}.gz (+ ${file}.gz.sha256)"
    return 0
  fi
  local -a bounded=()
  local _line
  while IFS= read -r _line; do
    [[ -n "${_line}" ]] && bounded+=("${_line}")
  done < <(sdkwork_logs_bundle_args "${environment}" "${instance}" "${service}" \
    "${tail}" "${since}" 0)
  sdkwork_remote_in_dir_capture "${SDKWORK_BIN_HOST}" "${remote_dir}" "${bounded[@]}" > "${file}" 2>/dev/null || true
  if [[ ! -s "${file}" ]]; then
    sdkwork_warn "log capture is empty (is '${environment}' running on ${SDKWORK_BIN_HOST}?)"
    rm -f "${file}"
    return 0
  fi
  # Exported logs are secret-adjacent (the file's own summary line says so):
  # land them operator-private; gzip preserves the mode of its input.
  chmod 600 "${file}"
  gzip -f "${file}"
  sdkwork_write_checksum "${file}.gz"
  sdkwork_log "exported ${file}.gz (+ .sha256) — treat it as secret-adjacent material"
}

# -----------------------------------------------------------------------------
# Diagnostics (OPERATIONS_SPEC.md §4)
# -----------------------------------------------------------------------------
sdkwork_doctor_reset() {
  SDKWORK_DOCTOR_ROWS=()
  SDKWORK_DOCTOR_FAIL=0
  SDKWORK_DOCTOR_WARN=0
  SDKWORK_DOCTOR_PASS=0
}

sdkwork_doctor_row() {
  local status="$1" check="$2"; shift 2
  SDKWORK_DOCTOR_ROWS+=("${status}|${check}|$*")
  case "${status}" in
    PASS) SDKWORK_DOCTOR_PASS=$((SDKWORK_DOCTOR_PASS + 1)) ;;
    WARN) SDKWORK_DOCTOR_WARN=$((SDKWORK_DOCTOR_WARN + 1)) ;;
    FAIL) SDKWORK_DOCTOR_FAIL=$((SDKWORK_DOCTOR_FAIL + 1)) ;;
  esac
}

# Runs argv on the target; fills SDKWORK_DOCTOR_OUT / SDKWORK_DOCTOR_RC
# without letting `set -e` abort the report.
sdkwork_doctor_capture() {
  SDKWORK_DOCTOR_OUT=""
  SDKWORK_DOCTOR_RC=0
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    SDKWORK_DOCTOR_OUT="dry-run"
    return 0
  fi
  SDKWORK_DOCTOR_OUT="$(sdkwork_remote_capture "$@" 2>/dev/null)" || SDKWORK_DOCTOR_RC=$?
  return 0
}

sdkwork_doctor_ps_format() {
  printf '{{.Names}}\t{{.Status}}\t{{.Image}}'
}

sdkwork_doctor() {
  local environment="$1" instance="$2" as_json="${3:-0}" export_dir="${4:-}"
  local remote_dir remote_deploy
  remote_dir="$(sdkwork_remote_bundle_dir)"
  remote_deploy="${remote_dir}/deploy.sh"
  sdkwork_doctor_reset

  # 1. toolchain ------------------------------------------------------------
  sdkwork_doctor_capture "${SDKWORK_BIN_HOST}" bash -lc 'docker --version && docker compose version --short'
  if [[ "${SDKWORK_DOCTOR_RC}" == "0" ]]; then
    sdkwork_doctor_row PASS toolchain "${SDKWORK_DOCTOR_OUT//$'\n'/ }"
  else
    sdkwork_doctor_row FAIL toolchain "docker or the compose plugin is missing on ${SDKWORK_BIN_HOST}"
  fi

  # 2. bundle ---------------------------------------------------------------
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]] \
     || sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" "${remote_deploy}"; then
    sdkwork_doctor_row PASS bundle "${remote_dir}"
  else
    sdkwork_doctor_row FAIL bundle "no deployed bundle at ${SDKWORK_BIN_HOST}:${remote_dir} (run: bin/docker-deploy.sh install --environment ${environment})"
  fi

  # 3. compose stack --------------------------------------------------------
  local -a ps_args=(bash deploy.sh --environment "${environment}" --ps)
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_doctor_row PASS compose "dry-run: stack inspection skipped"
  elif sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" "${remote_deploy}"; then
    SDKWORK_DOCTOR_OUT=""
    SDKWORK_DOCTOR_RC=0
    SDKWORK_DOCTOR_OUT="$(sdkwork_remote_in_dir_capture "${SDKWORK_BIN_HOST}" "${remote_dir}" "${ps_args[@]}" 2>&1)" \
      || SDKWORK_DOCTOR_RC=$?
    if [[ "${SDKWORK_DOCTOR_RC}" == "0" ]]; then
      local rows
      rows="$(printf '%s\n' "${SDKWORK_DOCTOR_OUT}" | grep -cE '(webserver|gateway|postgres|redis|app)-|Up |Exit ' || true)"
      if [[ "${rows}" == "0" ]]; then
        sdkwork_doctor_row FAIL compose "no running containers for '${environment}' (deploy it first)"
      else
        sdkwork_doctor_row PASS compose "${rows} container line(s) reported by deploy.sh --ps"
      fi
    else
      sdkwork_doctor_row FAIL compose "deploy.sh --ps failed on ${SDKWORK_BIN_HOST}: $(printf '%s' "${SDKWORK_DOCTOR_OUT}" | tail -1)"
    fi
  else
    sdkwork_doctor_row FAIL compose "bundle deploy.sh unavailable; cannot inspect the stack"
  fi

  # 4. container health -----------------------------------------------------
  sdkwork_doctor_capture "${SDKWORK_BIN_HOST}" docker ps --filter "name=${SDKWORK_MODULE_ID}-${environment}" \
    --format "$(sdkwork_doctor_ps_format)"
  if [[ "${SDKWORK_DOCTOR_RC}" != "0" ]]; then
    sdkwork_doctor_row FAIL health "docker ps failed on ${SDKWORK_BIN_HOST}"
  elif [[ -z "${SDKWORK_DOCTOR_OUT}" ]]; then
    sdkwork_doctor_row FAIL health "no container matches '${SDKWORK_MODULE_ID}-${environment}'"
  else
    local unhealthy restarting line name status
    unhealthy=0; restarting=0
    while IFS=$'\t' read -r name status _; do
      [[ -n "${name}" ]] || continue
      case "${status}" in
        *unhealthy*) unhealthy=$((unhealthy + 1)) ;;
        *Restarting*) restarting=$((restarting + 1)) ;;
      esac
    done <<< "${SDKWORK_DOCTOR_OUT}"
    if (( unhealthy > 0 )); then
      sdkwork_doctor_row FAIL health "${unhealthy} container(s) unhealthy"
    elif (( restarting > 0 )); then
      sdkwork_doctor_row FAIL health "${restarting} container(s) in a restart loop"
    else
      sdkwork_doctor_row PASS health "$(printf '%s\n' "${SDKWORK_DOCTOR_OUT}" | wc -l | tr -d ' ') container(s) up"
    fi
  fi

  # 5. HTTP probe -----------------------------------------------------------
  # The probe host port must reflect the DEPLOYED instance, not just the
  # module's built-in default. Pull the live env file first (only when a module
  # hook can resolve its host-port key) so a runtime port override set through
  # bin/docker-deploy.sh --host-port / config.sh --set is honoured; then let the
  # module hook resolve <env> <instance> -> host port (falling back to the
  # module's built-in default when there is no deployment / no key).
  if declare -F sdkwork_module_health_port >/dev/null 2>&1; then
    if [[ "${SDKWORK_BIN_DRY_RUN}" != "1" ]] && ((${#SDKWORK_CONFIG_KEYS[@]} == 0)) \
       && sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" \
            "$(sdkwork_config_env_dir)/${environment}.env"; then
      sdkwork_config_pull "${environment}" "${instance}" || true
      sdkwork_config_load
    fi
    local port
    port="$(sdkwork_module_health_port "${environment}" "${instance}" 2>/dev/null || true)"
    if [[ -n "${port}" ]]; then
      SDKWORK_DOCTOR_OUT=""
      SDKWORK_DOCTOR_RC=0
      if [[ "${SDKWORK_BIN_DRY_RUN}" != "1" ]]; then
        SDKWORK_DOCTOR_OUT="$(sdkwork_remote_capture "${SDKWORK_BIN_HOST}" \
          curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${port}${SDKWORK_HEALTH_PATH}" 2>/dev/null)" \
          || SDKWORK_DOCTOR_RC=$?
      fi
      if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
        sdkwork_doctor_row PASS probe "dry-run: http://127.0.0.1:${port}${SDKWORK_HEALTH_PATH} probe skipped"
      elif [[ "${SDKWORK_DOCTOR_RC}" == "0" ]]; then
        sdkwork_doctor_row PASS probe "http://127.0.0.1:${port}${SDKWORK_HEALTH_PATH} -> ${SDKWORK_DOCTOR_OUT}"
      else
        sdkwork_doctor_row FAIL probe "http://127.0.0.1:${port}${SDKWORK_HEALTH_PATH} unreachable"
      fi
    fi
  fi

  # 6. image drift ----------------------------------------------------------
  # Expected tag sources, first hit wins: the module hook (the deployed
  # bundle's own authoritative tag, e.g. its image.env), the environment
  # chain (SDKWORK_WEBSERVER_IMAGE_TAG / IMAGE_TAG / GATEWAY_IMAGE, `:tag`
  # stripped from a full ref), then the --image-tag recorded by the
  # entrypoint. The pull is guarded so a not-yet-deployed environment skips
  # the check instead of aborting the report.
  if [[ "${SDKWORK_BIN_DRY_RUN}" != "1" ]] && ((${#SDKWORK_CONFIG_KEYS[@]} == 0)); then
    if sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" \
         "$(sdkwork_config_env_dir)/${environment}.env"; then
      sdkwork_config_pull "${environment}" "${instance}" || true
      sdkwork_config_load
    fi
  fi
  local expected_tag="" cfg_key cfg_value
  if declare -F sdkwork_module_expected_image_tag >/dev/null 2>&1; then
    expected_tag="$(sdkwork_module_expected_image_tag "${environment}" 2>/dev/null || true)"
  fi
  if [[ -z "${expected_tag}" ]] && ((${#SDKWORK_CONFIG_KEYS[@]} > 0)); then
    for cfg_key in SDKWORK_WEBSERVER_IMAGE_TAG IMAGE_TAG GATEWAY_IMAGE; do
      sdkwork_config_index_of "${cfg_key}"
      if ((SDKWORK_CONFIG_INDEX >= 0)); then
        cfg_value="${SDKWORK_CONFIG_VALUES[SDKWORK_CONFIG_INDEX]}"
        case "${cfg_value}" in
          *:*) expected_tag="${cfg_value##*:}" ;;
          *)   expected_tag="" ;;
        esac
        [[ -n "${expected_tag}" ]] && break
      fi
    done
  fi
  [[ -n "${expected_tag}" ]] || expected_tag="${SDKWORK_BIN_IMAGE_TAG:-}"
  if [[ -n "${expected_tag}" ]]; then
    local expected_ref
    expected_ref="$(sdkwork_image_ref "${SDKWORK_IMAGE_NAME}" "${expected_tag}" 2>/dev/null || true)"
    sdkwork_doctor_capture "${SDKWORK_BIN_HOST}" docker ps --filter "name=${SDKWORK_MODULE_ID}-${environment}" \
      --format '{{.Image}}'
    if [[ -n "${expected_ref}" && -n "${SDKWORK_DOCTOR_OUT}" ]]; then
      if printf '%s\n' "${SDKWORK_DOCTOR_OUT}" | grep -qF "${expected_tag}"; then
        sdkwork_doctor_row PASS image "running images match ${expected_tag}"
      else
        sdkwork_doctor_row WARN image "running image(s) '${SDKWORK_DOCTOR_OUT//$'\n'/,}' do not carry ${expected_tag}"
      fi
    fi
  fi

  # 7. configuration --------------------------------------------------------
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_doctor_row PASS config "dry-run: drift scan skipped"
  else
    SDKWORK_DOCTOR_RC=0
    local cfg_out=""
    cfg_out="$(sdkwork_config_pull "${environment}" "${instance}" 2>&1 && sdkwork_config_diff "${environment}" "${instance}" 2>&1)" \
      || SDKWORK_DOCTOR_RC=$?
    if [[ "${SDKWORK_DOCTOR_RC}" == "0" ]]; then
      sdkwork_doctor_row PASS config "no blocking drift in '${environment}'"
    else
      local first
      first="$(printf '%s\n' "${cfg_out}" | grep -E 'PLACEHOLDER|MISSING' | head -1 || true)"
      sdkwork_doctor_row FAIL config "configuration drift: ${first:-see bin/config.sh diff --environment ${environment}}"
    fi
  fi

  # 8. recent log errors ----------------------------------------------------
  if [[ "${SDKWORK_BIN_DRY_RUN}" != "1" ]] \
     && sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" "${remote_deploy}"; then
    local -a log_args=()
    local _line
    while IFS= read -r _line; do
      [[ -n "${_line}" ]] && log_args+=("${_line}")
    done < <(sdkwork_logs_bundle_args "${environment}" "${instance}" "" "${SDKWORK_LOG_TAIL_DEFAULT}" "" 0)
    local log_out=""
    log_out="$(sdkwork_remote_in_dir_capture "${SDKWORK_BIN_HOST}" "${remote_dir}" "${log_args[@]}" 2>/dev/null)" || true
    local errors
    errors="$(printf '%s\n' "${log_out}" | grep -ciE 'error|panic|fatal' || true)"
    if [[ "${errors:-0}" == "0" ]]; then
      sdkwork_doctor_row PASS logs "no ERROR/panic in the last ${SDKWORK_LOG_TAIL_DEFAULT} lines"
    else
      sdkwork_doctor_row WARN logs "${errors} ERROR/panic line(s) in the last ${SDKWORK_LOG_TAIL_DEFAULT} lines (run: bin/docker-deploy.sh logs --environment ${environment})"
    fi
  fi

  # 9. disk -----------------------------------------------------------------
  sdkwork_doctor_capture "${SDKWORK_BIN_HOST}" bash -lc "df -P /var/lib/docker 2>/dev/null | awk 'NR==2 {print \$5}' | tr -d '%'"
  if [[ "${SDKWORK_DOCTOR_RC}" == "0" && "${SDKWORK_DOCTOR_OUT}" =~ ^[0-9]+$ ]]; then
    local used="${SDKWORK_DOCTOR_OUT}"
    if (( used >= 90 )); then
      sdkwork_doctor_row FAIL disk "/var/lib/docker is ${used}% full"
    elif (( used >= 80 )); then
      sdkwork_doctor_row WARN disk "/var/lib/docker is ${used}% full"
    else
      sdkwork_doctor_row PASS disk "/var/lib/docker is ${used}% full"
    fi
  else
    sdkwork_doctor_row WARN disk "could not read /var/lib/docker usage on ${SDKWORK_BIN_HOST}"
  fi

  if declare -F sdkwork_module_extra_doctor >/dev/null 2>&1; then
    sdkwork_module_extra_doctor "${environment}" "${instance}"
  fi

  sdkwork_doctor_report "${environment}" "${as_json}" "${export_dir}"
}

sdkwork_doctor_report() {
  local environment="$1" as_json="${2:-0}" export_dir="${3:-}" row
  if [[ "${as_json}" == "1" ]]; then
    printf '{"module":"%s","environment":"%s","host":"%s","pass":%s,"warn":%s,"fail":%s,"checks":[' \
      "${SDKWORK_MODULE_ID}" "${environment}" "${SDKWORK_BIN_HOST}" \
      "${SDKWORK_DOCTOR_PASS}" "${SDKWORK_DOCTOR_WARN}" "${SDKWORK_DOCTOR_FAIL}"
    local first=1
    for row in "${SDKWORK_DOCTOR_ROWS[@]}"; do
      local status="${row%%|*}"; local rest="${row#*|}"
      local check="${rest%%|*}"; local detail="${rest#*|}"
      [[ "${first}" == "1" ]] || printf ','
      # Backslash first, then quote, then control characters — a detail with a
      # Windows path must stay parseable JSON (same order as release.sh).
      printf '{"status":"%s","check":"%s","detail":"%s"}' \
        "${status}" "${check}" \
        "$(printf '%s' "${detail}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\010\013\014\016-\037')"
      first=0
    done
    printf ']}\n'
  else
    sdkwork_log "doctor report — ${SDKWORK_MODULE_ID} / ${environment} / ${SDKWORK_BIN_HOST}"
    for row in "${SDKWORK_DOCTOR_ROWS[@]}"; do
      local status="${row%%|*}"; local rest="${row#*|}"
      printf '  %-4s %-10s %s\n' "${status}" "${rest%%|*}" "${rest#*|}"
    done
    sdkwork_log "summary: ${SDKWORK_DOCTOR_PASS} passed, ${SDKWORK_DOCTOR_WARN} warned, ${SDKWORK_DOCTOR_FAIL} failed"
    if (( SDKWORK_DOCTOR_FAIL > 0 )); then
      sdkwork_log "next: bin/docker-deploy.sh status --environment ${environment} ; bin/docker-deploy.sh logs --environment ${environment} --tail 200"
    fi
  fi

  if [[ -n "${export_dir}" && "${SDKWORK_BIN_DRY_RUN}" != "1" ]]; then
    mkdir -p "${export_dir}"
    local stamp file
    stamp="$(sdkwork_utc_stamp)"
    file="${export_dir}/${SDKWORK_MODULE_ID}-${environment}-doctor-${stamp}.log"
    {
      printf 'doctor report %s module=%s environment=%s host=%s\n' \
        "${stamp}" "${SDKWORK_MODULE_ID}" "${environment}" "${SDKWORK_BIN_HOST}"
      for row in "${SDKWORK_DOCTOR_ROWS[@]}"; do
        local status="${row%%|*}"; local rest="${row#*|}"
        printf '  %-4s %-10s %s\n' "${status}" "${rest%%|*}" "${rest#*|}"
      done
    } > "${file}"
    chmod 600 "${file}"
    sdkwork_write_checksum "${file}"
    sdkwork_log "report exported: ${file}"
    sdkwork_observe_logs "${environment}" "1" "" "${SDKWORK_LOG_TAIL_DEFAULT}" "" 0 "${export_dir}"
  fi

  (( SDKWORK_DOCTOR_FAIL == 0 ))
}
