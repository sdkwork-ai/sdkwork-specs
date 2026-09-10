#!/usr/bin/env bash
# entrypoints.sh — generic flows for the module bin/ entrypoints.
# Authority: sdkwork-specs/MODULE_BIN_SPEC.md §4.
#
# Sourced by each module's bin/lib/bootstrap.sh AFTER sdkwork-common.sh and
# bin/lib/module.sh. Generic flow lives here (parse → validate → gate →
# delegate → evidence); module-specific wiring lives in module.sh hooks.
# Requires: SDKWORK_MODULE_ROOT, sdkwork-common.sh sourced, module.sh sourced.

sdkwork_entry_usage() {
  cat <<EOF
[sdkwork-bin] ${SDKWORK_MODULE_ID:-module} — MODULE_BIN_SPEC.md entrypoints

  docker-image.sh  <build|push|save|load|update|inspect|doctor> [--image-tag <v>] [-o <file>] [-i <file>]
  docker-deploy.sh <install|upgrade|rollback|status|logs|down|start|stop|restart|check-config|doctor> --environment <env>
                   [--replicas N] [--host wsl|ssh://[user@]host[:port]]
                   [--image-tag <v>] [--deps external|embedded] [--to <version>]
                   [--host-port <BASE>] [--edge-http <P>] [--edge-https <P>] [--domain <HOST>]
                   [--purge] [--skip-backup] [--yes] [--dry-run]
                   logs only: [--instance N] [--service <name>] [--tail N|all]
                              [--since <duration|RFC3339>] [--follow] [--export <dir>]

  --host-port <BASE>      override the instance-1 host port base (management/app
                          port); instances stride +1 upward. Overrides the
                          environment env-file default for this deploy only.
  --edge-http/--edge-https <P>  override the edge HTTP/HTTPS host port of a
                          webserver (instance 1) publishing :80/:443.
  --domain <HOST>         override the primary/application host the deploy binds.
  These map 1:1 to the bundle deploy.sh (MODULE_BIN_SPEC §4.2 runtime flags);
  a module whose deploy.sh does not accept them fails fast instead of silently
  ignoring the override.
  config.sh        <list|show|get|set|diff|validate|edit> --environment <env>
                   [--instance N] [--key <K>] [--value <V>] [--reveal]
                   [--host wsl|ssh://[user@]host[:port]] [--yes] [--dry-run]
  doctor.sh        --environment <env> [--instance N] [--json] [--export <dir>]
                   [--host wsl|ssh://[user@]host[:port]] [--dry-run]
  backup.sh        <create|list|verify|restore> --environment <env>
                   [--set <name>] [--component all|config|database|volumes]
                   [--no-db] [--no-volumes] [--host wsl|ssh://[user@]host[:port]]
                   [--yes] [--dry-run]
  apps-build.sh    <app-type> <environment>[:<profile>] [--dry-run] | doctor
  apps-package.sh  <app-type> <environment>[:<profile>] [--out <dir>] [--dry-run] | doctor
  apps-deploy.sh   <app-type> <install|upgrade|rollback|status> <environment>[:<profile>]
                   [--host wsl|ssh://[user@]host[:port]] [--yes] [--dry-run] | doctor
  apps-pkg-installer.sh <app-type> <platform> <environment>[:<profile>]
                   [--arch x64|arm64] [--format <fmt>] [--out <dir>] [--dry-run] | doctor

Environments : development|test|staging|demo|production (aliases dev|prod)
Profiles     : standalone (default) | cloud
Platforms    : windows|linux|macos|android|ios (installer packaging)
App types    : ${SDKWORK_APP_TYPES:-<unset>}
Default host : ${SDKWORK_BIN_HOST}
EOF
}

# ----------------------------------------------------------------------------
# Shared flag/argument helpers
# ----------------------------------------------------------------------------
# `-h|--help` is part of the common flag grammar (§4): it must print the usage
# card even when it is the only argument, i.e. before any action parsing.
sdkwork_entry_wants_help() {
  [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]
}

sdkwork_split_env_profile() {
  # "$1" = <environment>[:<profile>] → sets SDKWORK_BIN_ENVIRONMENT/_PROFILE
  local spec="${1:-}"
  [[ -n "${spec}" ]] || sdkwork_die "${SDKWORK_BIN_E_USAGE}" "environment argument is required"
  if [[ "${spec}" == *:* ]]; then
    sdkwork_validate_environment "${spec%%:*}" >/dev/null
    sdkwork_validate_profile "${spec##*:}"
  else
    sdkwork_validate_environment "${spec}" >/dev/null
    sdkwork_validate_profile "standalone"
  fi
}

sdkwork_bundle_dir() {
  # The install path consumes a packaged stage-2 artifact (OPERATIONS_SPEC.md
  # §1.1): the module hook resolves the newest self-contained install bundle.
  if declare -F sdkwork_module_install_bundle_dir >/dev/null 2>&1; then
    sdkwork_module_install_bundle_dir
    return
  fi
  printf '%s/deployments/docker/bundle' "${SDKWORK_MODULE_ROOT}"
}

# Newest self-contained install bundle under <base> (own deploy.sh + env/);
# empty when nothing has been packaged yet.
sdkwork_newest_install_bundle() {
  local base="$1" best="" best_ts=-1 f ts
  [[ -d "${base}" ]] || return 0
  for f in "${base}"/*; do
    [[ -d "${f}" && -f "${f}/deploy.sh" && -d "${f}/env" ]] || continue
    ts="$(sdkwork_file_mtime "${f}")"
    if (( ts >= best_ts )); then best_ts="${ts}"; best="${f}"; fi
  done
  printf '%s' "${best}"
}

# Canonical on-target bundle path (APPLICATION_DEPLOY_LAYOUT_SPEC).
sdkwork_remote_bundle_dir() {
  printf '/opt/deploy/%s/bundle' "${SDKWORK_MODULE_ID}"
}

# ----------------------------------------------------------------------------
# bin/docker-image.sh — image packaging and update (§4.1)
# ----------------------------------------------------------------------------
sdkwork_entry_docker_image() {
  sdkwork_entry_wants_help "$@" && { sdkwork_entry_usage; return 0; }
  [[ $# -ge 1 ]] || { sdkwork_entry_usage; return "${SDKWORK_BIN_E_USAGE}"; }
  local action="$1"; shift
  local tag="${SDKWORK_IMAGE_TAG_DEFAULT:-0.1.0}" file="" out_file=""
  while (($#)); do
    case "$1" in
      --image-tag) tag="$(sdkwork_need_value --image-tag "${2-}")"; shift 2 ;;
      -o|--out)    out_file="$(sdkwork_anchor_invocation_path "$(sdkwork_need_value --out "${2-}")")"; shift 2 ;;
      -i|--in)     file="$(sdkwork_anchor_invocation_path "$(sdkwork_need_value --in "${2-}")")"; shift 2 ;;
      --dry-run)   SDKWORK_BIN_DRY_RUN=1; shift ;;
      -h|--help)   sdkwork_entry_usage; return 0 ;;
      *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown option '$1' for docker-image.sh" ;;
    esac
  done
  local ref
  ref="$(sdkwork_image_ref "${SDKWORK_IMAGE_NAME}" "${tag}")"

  case "${action}" in
    doctor)
      sdkwork_bin_doctor ;;
    build)
      sdkwork_validate_image_tag "${tag}"
      sdkwork_evidence "docker-image build ${ref}"
      sdkwork_image_build "${ref}" "${tag}"
      sdkwork_assert_image_present "${ref}" ;;
    push)
      sdkwork_evidence "docker-image push ${ref}"
      sdkwork_local_run docker push "${ref}"
      if [[ "${SDKWORK_BIN_DRY_RUN}" != "1" ]]; then
        # Immutable release identity: the registry digest is the release
        # locator of record (RELEASE_SPEC.md §4.1); mutable tags are labels.
        # Routed through sdkwork_local_run like every docker CLI call (§4.1);
        # the grep drops the executor's own [sdkwork-bin] log lines so the
        # capture holds only the digest.
        local pushed_digest
        pushed_digest="$(sdkwork_local_run docker image inspect "${ref}" \
          --format '{{index .RepoDigests 0}}' 2>/dev/null \
          | grep -v '^\[sdkwork-bin\]' | head -1 || true)"
        if [[ -n "${pushed_digest}" ]]; then
          sdkwork_evidence "docker-image digest ${pushed_digest} (immutable release identity, RELEASE_SPEC.md §4.1)"
        fi
      fi ;;
    save)
      local archive="${out_file}"
      [[ -n "${archive}" ]] || archive="${SDKWORK_MODULE_ROOT}/target/bin-packages/${SDKWORK_IMAGE_NAME}-${tag}.tar.gz"
      mkdir -p "$(dirname "${archive}")"
      sdkwork_evidence "docker-image save ${ref} -> ${archive}"
      sdkwork_local_run docker save "${ref}" -o "${archive%.gz}"
      if [[ "${SDKWORK_BIN_DRY_RUN}" != "1" ]]; then
        gzip -f "${archive%.gz}"
        sdkwork_write_checksum "${archive}"
      fi
      sdkwork_log "saved ${archive}" ;;
    load)
      [[ -n "${file}" ]] || sdkwork_die "${SDKWORK_BIN_E_USAGE}" "load requires -i <file>"
      sdkwork_evidence "docker-image load ${file}"
      sdkwork_local_run docker load -i "${file}" ;;
    update)
      sdkwork_evidence "docker-image update ${ref}"
      if [[ -n "${file}" ]]; then
        sdkwork_run docker load -i "${file}"
      else
        sdkwork_local_run docker pull "${ref}"
      fi
      if [[ "${SDKWORK_BIN_DRY_RUN}" != "1" ]]; then
        sdkwork_local_run docker image prune -f >/dev/null 2>&1 || true
      fi ;;
    inspect)
      sdkwork_evidence "docker-image inspect ${ref}"
      if [[ "${SDKWORK_BIN_DRY_RUN}" == "1" ]]; then
        sdkwork_log "dry-run: docker image inspect ${ref}"
      else
        sdkwork_local_run docker image inspect "${ref}" \
          --format 'ref={{index .RepoTags 0}} digest={{index .RepoDigests 0}} created={{.Created}}'
      fi ;;
    *)
      sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown action '${action}' (build|push|save|load|update|inspect|doctor)" ;;
  esac
}

# ----------------------------------------------------------------------------
# bin/docker-deploy.sh — image deployment (§4.2)
# ----------------------------------------------------------------------------
sdkwork_entry_docker_deploy() {
  sdkwork_entry_wants_help "$@" && { sdkwork_entry_usage; return 0; }
  [[ $# -ge 1 ]] || { sdkwork_entry_usage; return "${SDKWORK_BIN_E_USAGE}"; }
  local action="$1"; shift
  local replicas="${SDKWORK_REPLICAS_DEFAULT:-1}" purge=0 deps="" to_version="" skip_backup=0
  # Runtime port/domain overrides (MODULE_BIN_SPEC §4.2): forwarded verbatim to
  # the bundle deploy.sh, which applies them above the env-file defaults. Empty
  # when not requested, so the bundle keeps its env-file fallbacks unchanged.
  local host_port="" edge_http="" edge_https="" domain=""
  local log_instance="1" log_service="" log_tail="" log_since="" log_follow=0 log_export=""
  while (($#)); do
    case "$1" in
      --environment) SDKWORK_BIN_ENVIRONMENT="$(sdkwork_need_value --environment "${2-}")"; shift 2 ;;
      --replicas)    replicas="$(sdkwork_need_value --replicas "${2-}")"; shift 2 ;;
      --host)        SDKWORK_BIN_HOST="$(sdkwork_need_value --host "${2-}")"; shift 2 ;;
      --image-tag)   SDKWORK_BIN_IMAGE_TAG="$(sdkwork_need_value --image-tag "${2-}")"; shift 2 ;;
      --deps)        deps="$(sdkwork_need_value --deps "${2-}")"; shift 2 ;;
      --host-port)   host_port="$(sdkwork_need_value --host-port "${2-}")"; shift 2 ;;
      --edge-http)   edge_http="$(sdkwork_need_value --edge-http "${2-}")"; shift 2 ;;
      --edge-https)  edge_https="$(sdkwork_need_value --edge-https "${2-}")"; shift 2 ;;
      --domain)      domain="$(sdkwork_need_value --domain "${2-}")"; shift 2 ;;
      --to)          to_version="$(sdkwork_need_value --to "${2-}")"; shift 2 ;;
      --instance)    log_instance="$(sdkwork_need_value --instance "${2-}")"; shift 2 ;;
      --service)     log_service="$(sdkwork_need_value --service "${2-}")"; shift 2 ;;
      --tail)        log_tail="$(sdkwork_need_value --tail "${2-}")"; shift 2 ;;
      --since)       log_since="$(sdkwork_need_value --since "${2-}")"; shift 2 ;;
      --follow)      log_follow=1; shift ;;
      --export)      log_export="$(sdkwork_anchor_invocation_path "$(sdkwork_need_value --export "${2-}")")"; shift 2 ;;
      --purge)       purge=1; shift ;;
      --skip-backup) skip_backup=1; shift ;;
      --yes)         SDKWORK_BIN_YES=1; shift ;;
      --dry-run)     SDKWORK_BIN_DRY_RUN=1; shift ;;
      -h|--help)     sdkwork_entry_usage; return 0 ;;
      *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown option '$1' for docker-deploy.sh" ;;
    esac
  done

  if [[ "${action}" == "doctor" ]]; then
    sdkwork_bin_doctor
    sdkwork_log "  bundle          : $(sdkwork_bundle_dir)"
    sdkwork_log "  target bundle   : $(sdkwork_remote_bundle_dir) (on ${SDKWORK_BIN_HOST})"
    return 0
  fi

  sdkwork_validate_environment "${SDKWORK_BIN_ENVIRONMENT}" >/dev/null
  # A forwarded --image-tag reaches docker refs, compose interpolation, and the
  # bundle deploy.sh argv; validate it with the shared DOCKER_SPEC.md §2.1 rule
  # before anything is pushed or executed.
  if [[ -n "${SDKWORK_BIN_IMAGE_TAG}" ]]; then
    sdkwork_validate_image_tag "${SDKWORK_BIN_IMAGE_TAG}"
  fi
  case "${deps}" in
    ""|external|embedded) ;;
    *) sdkwork_die "${SDKWORK_BIN_E_ENV}" "--deps must be external or embedded (got '${deps}')" ;;
  esac
  # Runtime port/domain overrides validate before any push or execution
  # (MODULE_BIN_SPEC §4.2). Only instance-1's edge host ports are meaningful on
  # a webserver; every value must be a 1..65535 integer when supplied.
  local ov_label ov_val
  for ov_label in host_port edge_http edge_https; do
    ov_val="$(eval "printf '%s' \"\${${ov_label}}\"")"
    if [[ -n "${ov_val}" ]] && ! [[ "${ov_val}" =~ ^[0-9]+$ ]]; then
      sdkwork_die "${SDKWORK_BIN_E_USAGE}" "--${ov_label//_/-} must be a positive integer port (got '${ov_val}')"
    fi
    if [[ -n "${ov_val}" ]] && (( 10#$ov_val < 1 || 10#$ov_val > 65535 )); then
      sdkwork_die "${SDKWORK_BIN_E_USAGE}" "--${ov_label//_/-} port out of range (1..65535, got '${ov_val}')"
    fi
  done
  if [[ -n "${domain}" && "${domain}" =~ [[:space:]/] ]]; then
    sdkwork_die "${SDKWORK_BIN_E_USAGE}" "--domain must be a bare host name without scheme/path/space (got '${domain}')"
  fi

  local bundle remote_dir
  bundle="$(sdkwork_bundle_dir)"
  remote_dir="$(sdkwork_remote_bundle_dir)"

  # Bundle deploy.sh arguments — assembled once, forwarded verbatim.
  local deploy_args=(bash deploy.sh --environment "${SDKWORK_BIN_ENVIRONMENT}")
  if [[ "${replicas}" != "1" ]]; then deploy_args+=(--replicas "${replicas}"); fi
  if [[ -n "${SDKWORK_BIN_IMAGE_TAG}" ]]; then deploy_args+=(--image-tag "${SDKWORK_BIN_IMAGE_TAG}"); fi
  if [[ -n "${deps}" ]]; then deploy_args+=("--${deps}"); fi
  if [[ -n "${host_port}" ]]; then deploy_args+=(--host-port "${host_port}"); fi
  if [[ -n "${edge_http}" ]]; then deploy_args+=(--edge-http "${edge_http}"); fi
  if [[ -n "${edge_https}" ]]; then deploy_args+=(--edge-https "${edge_https}"); fi
  if [[ -n "${domain}" ]]; then deploy_args+=(--domain "${domain}"); fi
  if [[ "${purge}" == "1" ]]; then deploy_args+=(--purge); fi

  case "${action}" in
    install|upgrade)
      sdkwork_confirm_production
      # Pre-change backup gate (OPERATIONS_SPEC.md §5.2): upgrade and first
      # install on staging/demo/production capture a backup set first. A
      # --skip-backup run is allowed but writes an evidence line. The gate
      # applies only when the target already runs a deployed bundle (a first
      # install has nothing to protect yet).
      case "${SDKWORK_BIN_ENVIRONMENT}" in
        staging|demo|production)
          if sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" "${remote_dir:-}/deploy.sh"; then
            if [[ "${skip_backup}" == "1" ]]; then
              sdkwork_warn "pre-change backup skipped by --skip-backup (evidence recorded)"
              sdkwork_evidence "docker-deploy ${action} pre-change backup SKIPPED env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST}"
            else
              sdkwork_evidence "docker-deploy ${action} pre-change backup env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST}"
              sdkwork_backup_create "${SDKWORK_BIN_ENVIRONMENT}" 1 1
            fi
          else
            sdkwork_log "first deploy to '${SDKWORK_BIN_ENVIRONMENT}': no deployed bundle, pre-change backup not required"
          fi ;;
      esac
      sdkwork_evidence "docker-deploy ${action} env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST} tag=${SDKWORK_BIN_IMAGE_TAG:-<env-default>} replicas=${replicas} host-port=${host_port:-<env-default>} edge-http=${edge_http:-<env-default>} edge-https=${edge_https:-<env-default>} domain=${domain:-<env-default>}"
      [[ -d "${bundle}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" \
        "install bundle missing: ${bundle} (build it with the module's container:install script first)"
      # 1. sync the bundle (including env/) to the canonical target path;
      #    skip the multi-GB image archive when the target already runs this
      #    version (the bundle deploy.sh then finds the image already loaded)
      local -a push_excludes=()
      local default_ref
      default_ref="$(sdkwork_image_ref "${SDKWORK_IMAGE_NAME}" "${SDKWORK_IMAGE_TAG_DEFAULT}" 2>/dev/null || true)"
      if [[ -n "${default_ref}" ]] && sdkwork_remote_image_exists "${SDKWORK_BIN_HOST}" "${default_ref}"; then
        push_excludes+=("./image.tar.gz")
        sdkwork_log "target already has ${default_ref}; excluding image.tar.gz from the bundle push"
      fi
      sdkwork_push_dir "${SDKWORK_BIN_HOST}" "${bundle}" "${remote_dir}" \
        ${push_excludes[@]+"${push_excludes[@]}"}
      # 2. for remote targets, make sure the image is present (a local/WSL target
      #    relies on the image built or loaded there; DOCKER_SPEC.md §2.1)
      if [[ "${SDKWORK_BIN_HOST}" != wsl && "${SDKWORK_BIN_HOST}" != local && -n "${SDKWORK_BIN_IMAGE_TAG}" ]]; then
        sdkwork_remote "${SDKWORK_BIN_HOST}" docker pull \
          "$(sdkwork_image_ref "${SDKWORK_IMAGE_NAME}" "${SDKWORK_BIN_IMAGE_TAG}")"
      fi
      # 3. run the bundle entrypoint inside the deployed bundle directory
      sdkwork_remote_in_dir "${SDKWORK_BIN_HOST}" "${remote_dir}" "${deploy_args[@]}" ;;
    rollback)
      sdkwork_confirm_production
      sdkwork_evidence "docker-deploy rollback env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST} to=${to_version:-<previous>}"
      local rollback_args=(bash release.sh rollback --environment "${SDKWORK_BIN_ENVIRONMENT}")
      if [[ -n "${to_version}" ]]; then rollback_args+=(--to "${to_version}"); fi
      if sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" "${remote_dir}/release.sh"; then
        sdkwork_remote_in_dir "${SDKWORK_BIN_HOST}" "${remote_dir}" "${rollback_args[@]}"
      else
        sdkwork_warn "no release.sh in the deployed bundle (bundle-owned release channel unavailable)"
        sdkwork_warn "falling back to an idempotent re-install of the current bundle"
        [[ -d "${bundle}" ]] || sdkwork_die "${SDKWORK_BIN_E_STATE}" "install bundle missing: ${bundle}"
        sdkwork_push_dir "${SDKWORK_BIN_HOST}" "${bundle}" "${remote_dir}"
        sdkwork_remote_in_dir "${SDKWORK_BIN_HOST}" "${remote_dir}" "${deploy_args[@]}"
      fi ;;
    status)
      sdkwork_evidence "docker-deploy status env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST}"
      local inspect_args=(bash deploy.sh --environment "${SDKWORK_BIN_ENVIRONMENT}" --ps)
      if sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" "${remote_dir}/deploy.sh"; then
        sdkwork_remote_in_dir "${SDKWORK_BIN_HOST}" "${remote_dir}" "${inspect_args[@]}"
      else
        sdkwork_warn "no deployed bundle at ${SDKWORK_BIN_HOST}:${remote_dir}; run 'bin/docker-deploy.sh install --environment ${SDKWORK_BIN_ENVIRONMENT}' first"
      fi ;;
    logs)
      case "${log_instance}" in ''|*[!0-9]*) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "--instance must be a positive integer" ;; esac
      case "${log_tail}" in ""|all) ;; ''|*[!0-9]*) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "--tail must be a positive integer or 'all'" ;; esac
      if [[ -n "${log_export}" && "${log_follow}" == "1" ]]; then
        sdkwork_die "${SDKWORK_BIN_E_USAGE}" "--export and --follow are mutually exclusive (an export is a bounded capture)"
      fi
      sdkwork_evidence "docker-deploy logs env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST} instance=${log_instance} service=${log_service:-<primary>} tail=${log_tail:-<default>} since=${log_since:-<all>} follow=${log_follow} export=${log_export:-<stdout>}"
      sdkwork_observe_logs "${SDKWORK_BIN_ENVIRONMENT}" "${log_instance}" "${log_service}" \
        "${log_tail}" "${log_since}" "${log_follow}" "${log_export}" ;;
    down)
      # down is a production mutation too (it removes the containers of a live
      # environment): --yes required, same as install/stop/restart. --purge is
      # additionally destructive in EVERY environment.
      sdkwork_confirm_production
      if [[ "${purge}" == "1" ]]; then sdkwork_confirm_destructive "--purge (removes volumes)"; fi
      sdkwork_evidence "docker-deploy down env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST} purge=${purge}"
      if sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" "${remote_dir}/deploy.sh"; then
        local down_args=(bash deploy.sh --environment "${SDKWORK_BIN_ENVIRONMENT}" --down)
        if [[ "${purge}" == "1" ]]; then down_args+=(--purge); fi
        sdkwork_remote_in_dir "${SDKWORK_BIN_HOST}" "${remote_dir}" "${down_args[@]}"
      else
        sdkwork_warn "no deployed bundle at ${SDKWORK_BIN_HOST}:${remote_dir}; nothing to bring down"
      fi ;;
    start|stop|restart)
      # Runtime lifecycle on an ALREADY-INSTALLED bundle (MODULE_BIN_SPEC.md
      # §4.2): compose-level start/stop/restart of the deployed stack — no
      # image pull, no repackaging, no config change. Fail-closed when the
      # bundle was never deployed (nothing to start/stop), and production is
      # gated behind --yes like every other mutating action.
      sdkwork_confirm_production
      sdkwork_evidence "docker-deploy ${action} env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST}"
      if sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" "${remote_dir}/deploy.sh"; then
        sdkwork_remote_in_dir "${SDKWORK_BIN_HOST}" "${remote_dir}" \
          bash deploy.sh --environment "${SDKWORK_BIN_ENVIRONMENT}" "--${action}"
      else
        sdkwork_die "${SDKWORK_BIN_E_STATE}" \
          "no deployed bundle at ${SDKWORK_BIN_HOST}:${remote_dir}; run 'bin/docker-deploy.sh install --environment ${SDKWORK_BIN_ENVIRONMENT}' first"
      fi ;;
    check-config)
      # Read-only env preflight on the DEPLOYED bundle (fail-closed required-key
      # check + live external PostgreSQL/Redis probes); deploys nothing.
      sdkwork_evidence "docker-deploy check-config env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST}"
      if sdkwork_remote_file_exists "${SDKWORK_BIN_HOST}" "${remote_dir}/deploy.sh"; then
        sdkwork_remote_in_dir "${SDKWORK_BIN_HOST}" "${remote_dir}" \
          bash deploy.sh --environment "${SDKWORK_BIN_ENVIRONMENT}" --check-config
      else
        sdkwork_warn "no deployed bundle at ${SDKWORK_BIN_HOST}:${remote_dir}; run 'bin/docker-deploy.sh install --environment ${SDKWORK_BIN_ENVIRONMENT}' first"
      fi ;;
    *)
      sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown action '${action}' (install|upgrade|rollback|status|logs|down|start|stop|restart|check-config|doctor)" ;;
  esac
}

# ----------------------------------------------------------------------------
# bin/config.sh — configuration inspection and mutation (OPERATIONS_SPEC §3)
# ----------------------------------------------------------------------------
sdkwork_entry_config() {
  sdkwork_entry_wants_help "$@" && { sdkwork_entry_usage; return 0; }
  [[ $# -ge 1 ]] || { sdkwork_entry_usage; return "${SDKWORK_BIN_E_USAGE}"; }
  local action="$1"; shift
  local instance="1" key="" value="" reveal=0
  while (($#)); do
    case "$1" in
      --environment) SDKWORK_BIN_ENVIRONMENT="$(sdkwork_need_value --environment "${2-}")"; shift 2 ;;
      --instance)    instance="$(sdkwork_need_value --instance "${2-}")"; shift 2 ;;
      --key)         key="$(sdkwork_need_value --key "${2-}")"; shift 2 ;;
      --value)       value="$(sdkwork_need_value --value "${2-}")"; shift 2 ;;
      --reveal)      reveal=1; shift ;;
      --host)        SDKWORK_BIN_HOST="$(sdkwork_need_value --host "${2-}")"; shift 2 ;;
      --yes)         SDKWORK_BIN_YES=1; shift ;;
      --dry-run)     SDKWORK_BIN_DRY_RUN=1; shift ;;
      -h|--help)     sdkwork_entry_usage; return 0 ;;
      *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown option '$1' for config.sh" ;;
    esac
  done
  sdkwork_validate_environment "${SDKWORK_BIN_ENVIRONMENT}" >/dev/null
  case "${instance}" in ''|*[!0-9]*) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "--instance must be a positive integer" ;; esac

  case "${action}" in
    list)
      sdkwork_evidence "config list env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST}"
      sdkwork_config_list "${SDKWORK_BIN_ENVIRONMENT}" "${instance}" ;;
    show)
      sdkwork_evidence "config show env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST} reveal=${reveal}"
      sdkwork_config_pull "${SDKWORK_BIN_ENVIRONMENT}" "${instance}"
      sdkwork_config_load
      sdkwork_config_show "${reveal}" ;;
    get)
      [[ -n "${key}" ]] || sdkwork_die "${SDKWORK_BIN_E_USAGE}" "get requires --key <KEY>"
      sdkwork_evidence "config get env=${SDKWORK_BIN_ENVIRONMENT} key=${key} reveal=${reveal}"
      sdkwork_config_pull "${SDKWORK_BIN_ENVIRONMENT}" "${instance}"
      sdkwork_config_load
      sdkwork_config_get "${key}" "${reveal}" ;;
    set)
      [[ -n "${key}" ]] || sdkwork_die "${SDKWORK_BIN_E_USAGE}" "set requires --key <KEY> --value <VALUE>"
      [[ -n "${value}" ]] || sdkwork_die "${SDKWORK_BIN_E_USAGE}" "set requires --value <VALUE>"
      sdkwork_confirm_production
      sdkwork_evidence "config set env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST} key=${key} (value redacted from evidence)"
      sdkwork_config_set "${key}" "${value}" "${instance}" ;;
    diff)
      sdkwork_evidence "config diff env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST}"
      sdkwork_config_pull "${SDKWORK_BIN_ENVIRONMENT}" "${instance}"
      sdkwork_config_diff "${SDKWORK_BIN_ENVIRONMENT}" "${instance}" ;;
    validate)
      sdkwork_evidence "config validate env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST}"
      sdkwork_config_validate "${SDKWORK_BIN_ENVIRONMENT}" "${instance}" ;;
    edit)
      sdkwork_confirm_production
      sdkwork_evidence "config edit env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST}"
      sdkwork_config_edit "${instance}" ;;
    doctor)
      sdkwork_bin_doctor
      sdkwork_log "  config env dir  : $(sdkwork_config_env_dir) (on ${SDKWORK_BIN_HOST})"
      sdkwork_log "  source env dir  : $(sdkwork_config_local_dir)" ;;
    *)
      sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown action '${action}' (list|show|get|set|diff|validate|edit|doctor)" ;;
  esac
}

# ----------------------------------------------------------------------------
# bin/doctor.sh — environment diagnostics (OPERATIONS_SPEC §4)
# ----------------------------------------------------------------------------
sdkwork_entry_doctor() {
  local instance="1" as_json=0 export_dir=""
  while (($#)); do
    case "$1" in
      --environment) SDKWORK_BIN_ENVIRONMENT="$(sdkwork_need_value --environment "${2-}")"; shift 2 ;;
      --instance)    instance="$(sdkwork_need_value --instance "${2-}")"; shift 2 ;;
      --json)        as_json=1; shift ;;
      --export)      export_dir="$(sdkwork_anchor_invocation_path "$(sdkwork_need_value --export "${2-}")")"; shift 2 ;;
      --host)        SDKWORK_BIN_HOST="$(sdkwork_need_value --host "${2-}")"; shift 2 ;;
      --dry-run)     SDKWORK_BIN_DRY_RUN=1; shift ;;
      -h|--help)     sdkwork_entry_usage; return 0 ;;
      *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown option '$1' for doctor.sh" ;;
    esac
  done
  [[ -n "${SDKWORK_BIN_ENVIRONMENT}" ]] || sdkwork_die "${SDKWORK_BIN_E_USAGE}" \
    "doctor.sh requires --environment <env> (use 'bin/docker-deploy.sh doctor' for the local self-check)"
  sdkwork_validate_environment "${SDKWORK_BIN_ENVIRONMENT}" >/dev/null
  sdkwork_evidence "doctor env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST} json=${as_json} export=${export_dir:-<none>}"
  local rc=0
  sdkwork_doctor "${SDKWORK_BIN_ENVIRONMENT}" "${instance}" "${as_json}" "${export_dir}" || rc=$?
  if (( rc != 0 )); then
    sdkwork_die "${SDKWORK_BIN_E_FAILED}" "one or more doctor checks failed (see the report above)"
  fi
}

# ----------------------------------------------------------------------------
# bin/backup.sh — backup and restore (OPERATIONS_SPEC §5)
# ----------------------------------------------------------------------------
sdkwork_entry_backup() {
  sdkwork_entry_wants_help "$@" && { sdkwork_entry_usage; return 0; }
  [[ $# -ge 1 ]] || { sdkwork_entry_usage; return "${SDKWORK_BIN_E_USAGE}"; }
  local action="$1"; shift
  local set_name="" component="all" with_db=1 with_volumes=1
  while (($#)); do
    case "$1" in
      --environment) SDKWORK_BIN_ENVIRONMENT="$(sdkwork_need_value --environment "${2-}")"; shift 2 ;;
      --set)         set_name="$(sdkwork_need_value --set "${2-}")"; shift 2 ;;
      --component)   component="$(sdkwork_need_value --component "${2-}")"; shift 2 ;;
      --no-db)       with_db=0; shift ;;
      --no-volumes)  with_volumes=0; shift ;;
      --host)        SDKWORK_BIN_HOST="$(sdkwork_need_value --host "${2-}")"; shift 2 ;;
      --yes)         SDKWORK_BIN_YES=1; shift ;;
      --dry-run)     SDKWORK_BIN_DRY_RUN=1; shift ;;
      -h|--help)     sdkwork_entry_usage; return 0 ;;
      *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown option '$1' for backup.sh" ;;
    esac
  done
  sdkwork_validate_environment "${SDKWORK_BIN_ENVIRONMENT}" >/dev/null
  case "${component}" in all|config|database|volumes) ;; *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "--component must be all|config|database|volumes" ;; esac

  case "${action}" in
    create)
      sdkwork_evidence "backup create env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST} db=${with_db} volumes=${with_volumes}"
      sdkwork_backup_create "${SDKWORK_BIN_ENVIRONMENT}" "${with_db}" "${with_volumes}" ;;
    list)
      sdkwork_evidence "backup list env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST}"
      sdkwork_backup_list "${SDKWORK_BIN_ENVIRONMENT}" ;;
    verify)
      sdkwork_evidence "backup verify env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST} set=${set_name:-<latest>}"
      sdkwork_backup_verify "${SDKWORK_BIN_ENVIRONMENT}" "${set_name}" ;;
    restore)
      sdkwork_evidence "backup restore env=${SDKWORK_BIN_ENVIRONMENT} host=${SDKWORK_BIN_HOST} set=${set_name:-<latest>} component=${component}"
      sdkwork_backup_restore "${SDKWORK_BIN_ENVIRONMENT}" "${set_name}" "${component}" ;;
    doctor)
      sdkwork_bin_doctor
      sdkwork_log "  backup root     : $(sdkwork_backup_root) (on ${SDKWORK_BIN_HOST})" ;;
    *)
      sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown action '${action}' (create|list|verify|restore|doctor)" ;;
  esac
}

# ----------------------------------------------------------------------------
# bin/apps-build.sh — application build (§4.3)
# ----------------------------------------------------------------------------
sdkwork_entry_apps_build() {
  sdkwork_entry_wants_help "$@" && { sdkwork_entry_usage; return 0; }
  if [[ $# -ge 1 && "$1" == "doctor" ]]; then sdkwork_bin_doctor; return 0; fi
  [[ $# -ge 2 ]] || { sdkwork_entry_usage; return "${SDKWORK_BIN_E_USAGE}"; }
  local app_type="$1" spec="$2"; shift 2
  sdkwork_require_app_type "${app_type}"
  sdkwork_split_env_profile "${spec}"
  while (($#)); do
    case "$1" in
      --dry-run) SDKWORK_BIN_DRY_RUN=1; shift ;;
      -h|--help) sdkwork_entry_usage; return 0 ;;
      *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown option '$1' for apps-build.sh" ;;
    esac
  done
  sdkwork_evidence "apps-build ${app_type} ${SDKWORK_BIN_ENVIRONMENT}:${SDKWORK_BIN_PROFILE}"
  sdkwork_build_app "${app_type}" "${SDKWORK_BIN_ENVIRONMENT}" "${SDKWORK_BIN_PROFILE}"
}

# ----------------------------------------------------------------------------
# bin/apps-package.sh — application packaging (§4.4)
# ----------------------------------------------------------------------------
sdkwork_entry_apps_package() {
  sdkwork_entry_wants_help "$@" && { sdkwork_entry_usage; return 0; }
  if [[ $# -ge 1 && "$1" == "doctor" ]]; then sdkwork_bin_doctor; return 0; fi
  [[ $# -ge 2 ]] || { sdkwork_entry_usage; return "${SDKWORK_BIN_E_USAGE}"; }
  local app_type="$1" spec="$2"; shift 2
  sdkwork_require_app_type "${app_type}"
  sdkwork_split_env_profile "${spec}"
  local out="${SDKWORK_MODULE_ROOT}/target/bin-packages"
  while (($#)); do
    case "$1" in
      --out) out="$(sdkwork_anchor_invocation_path "$(sdkwork_need_value --out "${2-}")")"; shift 2 ;;
      --dry-run) SDKWORK_BIN_DRY_RUN=1; shift ;;
      -h|--help) sdkwork_entry_usage; return 0 ;;
      *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown option '$1' for apps-package.sh" ;;
    esac
  done
  mkdir -p "${out}"
  sdkwork_evidence "apps-package ${app_type} ${SDKWORK_BIN_ENVIRONMENT}:${SDKWORK_BIN_PROFILE} -> ${out}"
  sdkwork_package_app "${app_type}" "${SDKWORK_BIN_ENVIRONMENT}" "${SDKWORK_BIN_PROFILE}" "${out}"
  sdkwork_assert_out_artifacts "${out}"
}

# ----------------------------------------------------------------------------
# bin/apps-pkg-installer.sh — native OS installer packaging (§4.9)
# ----------------------------------------------------------------------------
sdkwork_entry_apps_pkg_installer() {
  sdkwork_entry_wants_help "$@" && { sdkwork_entry_usage; return 0; }
  if [[ $# -ge 1 && "$1" == "doctor" ]]; then sdkwork_bin_doctor; return 0; fi
  [[ $# -ge 3 ]] || { sdkwork_entry_usage; return "${SDKWORK_BIN_E_USAGE}"; }
  local app_type="$1" platform="$2" spec="$3"; shift 3
  local arch="x64" format="" out="${SDKWORK_MODULE_ROOT}/target/bin-installers"
  sdkwork_require_app_type "${app_type}"
  sdkwork_validate_installer_platform "${platform}" >/dev/null
  sdkwork_split_env_profile "${spec}"
  while (($#)); do
    case "$1" in
      --arch)   arch="$(sdkwork_need_value --arch "${2-}")"; shift 2 ;;
      --format) format="$(sdkwork_need_value --format "${2-}")"; shift 2 ;;
      --out)    out="$(sdkwork_anchor_invocation_path "$(sdkwork_need_value --out "${2-}")")"; shift 2 ;;
      --dry-run) SDKWORK_BIN_DRY_RUN=1; shift ;;
      -h|--help) sdkwork_entry_usage; return 0 ;;
      *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown option '$1' for apps-pkg-installer.sh" ;;
    esac
  done
  sdkwork_validate_arch "${arch}" >/dev/null
  if ! declare -F sdkwork_installer_app >/dev/null 2>&1; then
    sdkwork_die "${SDKWORK_BIN_E_STATE}" \
      "bin/lib/module.sh does not implement sdkwork_installer_app (MODULE_BIN_SPEC.md §4.9)"
  fi
  mkdir -p "${out}"
  sdkwork_evidence "apps-pkg-installer ${app_type} ${platform} ${SDKWORK_BIN_ENVIRONMENT}:${SDKWORK_BIN_PROFILE} arch=${arch} format=${format:-<module-default>} -> ${out}"
  sdkwork_installer_app "${app_type}" "${platform}" "${SDKWORK_BIN_ENVIRONMENT}" \
    "${SDKWORK_BIN_PROFILE}" "${out}" "${arch}" "${format}"
  sdkwork_assert_out_artifacts "${out}"
}

# ----------------------------------------------------------------------------
# bin/apps-deploy.sh — application deployment (§4.5)
# ----------------------------------------------------------------------------
sdkwork_entry_apps_deploy() {
  sdkwork_entry_wants_help "$@" && { sdkwork_entry_usage; return 0; }
  if [[ $# -ge 1 && "$1" == "doctor" ]]; then sdkwork_bin_doctor; return 0; fi
  [[ $# -ge 3 ]] || { sdkwork_entry_usage; return "${SDKWORK_BIN_E_USAGE}"; }
  local app_type="$1" action="$2" spec="$3"; shift 3
  case "${action}" in
    install|upgrade|rollback|status) ;;
    *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown action '${action}' (install|upgrade|rollback|status)" ;;
  esac
  sdkwork_require_app_type "${app_type}"
  sdkwork_split_env_profile "${spec}"
  while (($#)); do
    case "$1" in
      --host) SDKWORK_BIN_HOST="$(sdkwork_need_value --host "${2-}")"; shift 2 ;;
      --yes) SDKWORK_BIN_YES=1; shift ;;
      --dry-run) SDKWORK_BIN_DRY_RUN=1; shift ;;
      -h|--help) sdkwork_entry_usage; return 0 ;;
      *) sdkwork_die "${SDKWORK_BIN_E_USAGE}" "unknown option '$1' for apps-deploy.sh" ;;
    esac
  done
  if [[ "${action}" != "status" ]]; then sdkwork_confirm_production; fi
  sdkwork_evidence "apps-deploy ${app_type} ${action} env=${SDKWORK_BIN_ENVIRONMENT}:${SDKWORK_BIN_PROFILE} host=${SDKWORK_BIN_HOST}"
  sdkwork_deploy_app "${app_type}" "${action}" "${SDKWORK_BIN_ENVIRONMENT}" "${SDKWORK_BIN_PROFILE}" "${SDKWORK_BIN_HOST}"
}
