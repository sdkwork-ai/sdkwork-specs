#!/usr/bin/env bash
# ops-backup.sh — backup, verify, and restore for a deployed environment.
# Authority: sdkwork-specs/OPERATIONS_SPEC.md §5.
#
# Sourced by bin/lib/bootstrap.sh after sdkwork-common.sh. The backup set is
# created **on the target host** (never streamed through the control machine),
# so a long dump cannot be lost to a broken SSH session.
#
# Module contract (bin/lib/module.sh):
#   sdkwork_module_backup_db_env_prefix   optional; env key prefix for the
#                                         database connection (default
#                                         SDKWORK_DATABASE)
#   sdkwork_module_backup_volume_filter   optional; docker volume name filter
#                                         (default: <module-id>-<environment>)

# Guard: this library must be sourced, not executed.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "ops-backup.sh is a library; source it from bin/backup.sh" >&2
  exit 64
fi

sdkwork_backup_root() {
  printf '/opt/deploy/%s/backups' "${SDKWORK_MODULE_ID}"
}

sdkwork_backup_db_prefix() {
  if declare -F sdkwork_module_backup_db_env_prefix >/dev/null 2>&1; then
    sdkwork_module_backup_db_env_prefix
    return
  fi
  printf 'SDKWORK_DATABASE'
}

# Suffix that carries the database NAME under the module's key prefix
# (`SDKWORK_DATABASE_NAME` vs `GATEWAY_POSTGRES_DB`).
sdkwork_backup_db_name_suffix() {
  if declare -F sdkwork_module_backup_db_name_suffix >/dev/null 2>&1; then
    sdkwork_module_backup_db_name_suffix
    return
  fi
  printf '_NAME'
}

# Generates the target-side script that loads the environment file and runs
# the pg client. pg_dump/pg_restore run on the host, so the Docker-only host
# name is mapped onto the host loopback first.
# Usage: sdkwork_backup_db_script <dump|restore> <env-file> <dump-file>
sdkwork_backup_db_script() {
  local action="$1" env_file="$2" file="$3"
  local prefix name_suffix
  prefix="$(sdkwork_backup_db_prefix)"
  name_suffix="$(sdkwork_backup_db_name_suffix)"
  cat <<EOF
if ! command -v pg_dump >/dev/null 2>&1 && ! command -v pg_restore >/dev/null 2>&1; then
  echo 'SKIP: no PostgreSQL client (pg_dump/pg_restore) on this host'
  exit 1
fi
set -a; . $(printf '%q' "${env_file}"); set +a
case "\${${prefix}_HOST:-}" in host.docker.internal|gateway|"") ${prefix}_HOST=127.0.0.1 ;; esac
DB_HOST="\${${prefix}_HOST:-127.0.0.1}"
DB_PORT="\${${prefix}_PORT:-5432}"
DB_USER="\${${prefix}_USERNAME:-\${${prefix}_USER:-postgres}}"
DB_PASS="\${${prefix}_PASSWORD:-}"
DB_NAME="\${${prefix}${name_suffix}:-postgres}"
EOF
  case "${action}" in
    dump)
      printf 'PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Fc -f %q\n' "${file}" ;;
    restore)
      printf 'PGPASSWORD="$DB_PASS" pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --clean --if-exists %q\n' "${file}" ;;
  esac
}

sdkwork_backup_volume_filter() {
  if declare -F sdkwork_module_backup_volume_filter >/dev/null 2>&1; then
    sdkwork_module_backup_volume_filter "$1"
    return
  fi
  printf '%s-%s' "${SDKWORK_MODULE_ID}" "$1"
}

sdkwork_backup_checksum() {
  local set_dir="$1" file="$2"
  # PORTABILITY:target-linux — executes on the deployed target, not the
  # operator machine (targets are Linux per DEPLOYMENT_SPEC.md §2).
  sdkwork_remote "${SDKWORK_BIN_HOST}" bash -lc \
    "cd $(printf '%q' "${set_dir}") && sha256sum $(printf '%q' "${file}") > $(printf '%q' "${file}").sha256" # PORTABILITY:target-linux
}

# -----------------------------------------------------------------------------
# create
# -----------------------------------------------------------------------------
# $1 environment, $2 include database, $3 include volumes
sdkwork_backup_create() {
  local environment="$1" with_db="${2:-1}" with_volumes="${3:-1}"
  local root set_name set_dir bundle_dir env_file
  root="$(sdkwork_backup_root)"
  set_name="${SDKWORK_MODULE_ID}-${environment}-$(sdkwork_utc_stamp)"
  set_dir="${root}/${set_name}"
  bundle_dir="$(sdkwork_remote_bundle_dir)"
  env_file="$(sdkwork_config_env_dir)/${environment}.env"

  sdkwork_log "backup set: ${SDKWORK_BIN_HOST}:${set_dir}"
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: would create config${with_db:+ +database}${with_volumes:+ +volumes} + manifest in ${set_dir}"
    return 0
  fi

  # The set carries configuration copies and a database dump (secrets and
  # user data); it is created target-private (0700) so non-root local users
  # can never read a restore point.
  sdkwork_remote "${SDKWORK_BIN_HOST}" bash -lc \
    "mkdir -p $(printf '%q' "${set_dir}") && chmod 700 $(printf '%q' "${set_dir}")"

  # 1. configuration ---------------------------------------------------------
  sdkwork_remote "${SDKWORK_BIN_HOST}" bash -lc \
    "tar -czf $(printf '%q' "${set_dir}/config.tar.gz") -C $(printf '%q' "${bundle_dir}") env"
  sdkwork_backup_checksum "${set_dir}" "config.tar.gz"

  # 2. database --------------------------------------------------------------
  if [[ "${with_db}" == "1" ]]; then
    local script
    script="$(sdkwork_backup_db_script dump "${env_file}" "${set_dir}/database.dump")"
    if sdkwork_remote "${SDKWORK_BIN_HOST}" bash -lc "${script}"; then
      sdkwork_backup_checksum "${set_dir}" "database.dump"
    else
      sdkwork_warn "database dump failed or was skipped; the set stays usable for configuration and volumes"
    fi
  fi

  # 3. volumes ---------------------------------------------------------------
  if [[ "${with_volumes}" == "1" ]]; then
    local filter volumes volume
    filter="$(sdkwork_backup_volume_filter "${environment}")"
    volumes="$(sdkwork_remote_capture "${SDKWORK_BIN_HOST}" docker volume ls -q --filter "name=${filter}" 2>/dev/null || true)"
    if [[ -z "${volumes}" ]]; then
      sdkwork_warn "no docker volume matches '${filter}'; nothing to capture"
    fi
    while IFS= read -r volume; do
      [[ -n "${volume}" ]] || continue
      if sdkwork_remote "${SDKWORK_BIN_HOST}" docker run --rm \
           -v "${volume}:/src:ro" -v "${set_dir}:/out" alpine:3.20 \
           tar czf "/out/${volume}.tar.gz" -C /src . ; then
        sdkwork_backup_checksum "${set_dir}" "${volume}.tar.gz"
      else
        sdkwork_warn "volume '${volume}' was not captured (is alpine:3.20 available offline?)"
      fi
    done <<< "${volumes}"
  fi

  # 4. manifest --------------------------------------------------------------
  sdkwork_backup_manifest "${set_dir}" "${environment}"
  sdkwork_log "backup complete: ${set_dir}"
}

sdkwork_backup_manifest() {
  local set_dir="$1" environment="$2"
  local script
  script="cd $(printf '%q' "${set_dir}") || exit 1
printf '{\n' > manifest.json
printf '  \"module\": \"%s\",\n' '${SDKWORK_MODULE_ID}' >> manifest.json
printf '  \"environment\": \"%s\",\n' '${environment}' >> manifest.json
printf '  \"set\": \"%s\",\n' \"\$(basename \"\$(pwd)\")\" >> manifest.json
printf '  \"createdAt\": \"%s\",\n' \"\$(date -u '+%Y-%m-%dT%H:%M:%SZ')\" >> manifest.json
printf '  \"host\": \"%s\",\n' \"\$(hostname)\" >> manifest.json
printf '  \"components\": [\n' >> manifest.json
first=1
for f in *.tar.gz *.dump; do
  [ -f \"\$f\" ] || continue
  if [ \"\$first\" = 1 ]; then first=0; else printf ',\n' >> manifest.json; fi
  # PORTABILITY:target-linux — stat -c / sha256sum run on the deployed target.
  printf '    {\"name\": \"%s\", \"bytes\": %s, \"sha256\": \"%s\"}\n' \"\$f\" \"\$(stat -c '%s' \"\$f\")\" \"\$(cut -d' ' -f1 < \"\$f.sha256\" 2>/dev/null)\" >> manifest.json
done
printf '  ]\n}\n' >> manifest.json
cat manifest.json"
  sdkwork_remote "${SDKWORK_BIN_HOST}" bash -lc "${script}"
}

# -----------------------------------------------------------------------------
# list / verify / restore
# -----------------------------------------------------------------------------
sdkwork_backup_list() {
  local environment="$1" root
  root="$(sdkwork_backup_root)"
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: would list ${SDKWORK_BIN_HOST}:${root} (filter '${environment}')"
    return 0
  fi
  local out
  out="$(sdkwork_remote_capture "${SDKWORK_BIN_HOST}" bash -lc \
    "ls -1 $(printf '%q' "${root}") 2>/dev/null | grep -- '-${environment}-' || true" 2>/dev/null || true)"
  if [[ -z "${out}" ]]; then
    sdkwork_log "no backup set for '${environment}' in ${SDKWORK_BIN_HOST}:${root}"
    return 0
  fi
  sdkwork_log "backup sets for '${environment}' on ${SDKWORK_BIN_HOST}:"
  printf '%s\n' "${out}" | sed 's/^/  /'
}

sdkwork_backup_verify() {
  local environment="$1" set_name="${2:-}" root out
  root="$(sdkwork_backup_root)"
  if [[ -z "${set_name}" ]]; then
    out="$(sdkwork_backup_latest "${environment}")"
    [[ -n "${out}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
      "no backup set for '${environment}' on ${SDKWORK_BIN_HOST} (create one first)"
    set_name="${out}"
  fi
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: would verify checksums in ${root}/${set_name}"
    return 0
  fi
  if sdkwork_remote "${SDKWORK_BIN_HOST}" bash -lc \
       "cd $(printf '%q' "${root}/${set_name}") && sha256sum -c --quiet *.sha256"; then  # PORTABILITY:target-linux
    sdkwork_log "checksums OK: ${root}/${set_name}"
  else
    sdkwork_die "${SDKWORK_BIN_E_FAILED}" "checksum verification failed for ${root}/${set_name}"
  fi
}

sdkwork_backup_latest() {
  local environment="$1" root out
  root="$(sdkwork_backup_root)"
  out="$(sdkwork_remote_capture "${SDKWORK_BIN_HOST}" bash -lc \
    "ls -1 $(printf '%q' "${root}") 2>/dev/null | grep -- '-${environment}-' | tail -1 || true" 2>/dev/null || true)"
  printf '%s' "${out}"
}

# $1 environment, $2 set name, $3 component (all|config|database|volumes)
sdkwork_backup_restore() {
  local environment="$1" set_name="$2" component="${3:-all}"
  local root set_dir bundle_dir env_file
  root="$(sdkwork_backup_root)"
  bundle_dir="$(sdkwork_remote_bundle_dir)"
  env_file="$(sdkwork_config_env_dir)/${environment}.env"

  [[ -n "${set_name}" ]] || set_name="$(sdkwork_backup_latest "${environment}")"
  [[ -n "${set_name}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
    "no backup set for '${environment}' on ${SDKWORK_BIN_HOST}; pass --set <name>"
  set_dir="${root}/${set_name}"

  sdkwork_confirm_destructive "restore of ${set_name} into '${environment}' (overwrites live configuration, data, and volumes)"
  if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
    sdkwork_log "dry-run: would stop the stack, restore ${component} from ${set_dir}, then wait for 'bin/docker-deploy.sh install --environment ${environment}'"
    return 0
  fi
  sdkwork_backup_verify "${environment}" "${set_name}"

  # Stop the stack first: restoring underneath a running process corrupts it.
  if sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" "${bundle_dir}/deploy.sh"; then
    sdkwork_remote_in_dir "${SDKWORK_BIN_HOST}" "${bundle_dir}" \
      bash deploy.sh --environment "${environment}" --down
  fi

  case "${component}" in
    all|config)
      sdkwork_remote "${SDKWORK_BIN_HOST}" bash -lc \
        "tar -xzf $(printf '%q' "${set_dir}/config.tar.gz") -C $(printf '%q' "${bundle_dir}")"
      sdkwork_log "configuration restored from ${set_dir}/config.tar.gz" ;;
  esac
  case "${component}" in
    all|database)
      if sdkwork_remote_capture "${SDKWORK_BIN_HOST}" test -f "${set_dir}/database.dump" >/dev/null 2>&1; then
        local script
        script="$(sdkwork_backup_db_script restore "${env_file}" "${set_dir}/database.dump")"
        sdkwork_remote "${SDKWORK_BIN_HOST}" bash -lc "${script}" \
          && sdkwork_log "database restored from ${set_dir}/database.dump" \
          || sdkwork_warn "database restore failed; resolve it before starting the stack"
      else
        sdkwork_warn "no database.dump in ${set_dir}; skipping the data component"
      fi ;;
  esac
  case "${component}" in
    all|volumes)
      local volumes volume
      volumes="$(sdkwork_remote_capture "${SDKWORK_BIN_HOST}" bash -lc \
        "cd $(printf '%q' "${set_dir}") && ls -1 *.tar.gz 2>/dev/null | grep -v '^config.tar.gz$' || true" 2>/dev/null || true)"
      while IFS= read -r volume; do
        [[ -n "${volume}" ]] || continue
        local name="${volume%.tar.gz}"
        sdkwork_remote "${SDKWORK_BIN_HOST}" docker run --rm \
          -v "${name}:/dst" -v "${set_dir}:/in" alpine:3.20 \
          sh -c "rm -rf /dst/* /dst/.[!.]*; tar xzf /in/$(printf '%q' "${volume}") -C /dst" \
          || sdkwork_warn "volume '${name}' was not restored"
      done <<< "${volumes}" ;;
  esac

  sdkwork_log "restore finished; start the stack again with:"
  sdkwork_log "  bin/docker-deploy.sh install --environment ${environment}"
}
