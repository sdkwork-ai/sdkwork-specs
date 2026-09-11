# SDKWork Module `bin/` Entrypoint Standard

- Version: 1.1
- Scope: the standardized `bin/` script entrypoints every independent SDKWork module root `MUST` ship — Docker image packaging/update, Docker deployment (WSL + remote Ubuntu), application build, application packaging, application deployment, and native OS installer packaging (Windows / Linux / macOS / Android / iOS) — plus the shared library contract that keeps them thin, highly cohesive, and loosely coupled
- Related: `DOCKER_SPEC.md` (image naming/tagging, bundle layout, environment matrix), `DEPLOYMENT_SPEC.md` (§6 container install, §6.1 external dependencies), `SDKWORK_WEBSERVER_SPEC.md` (§17 import plane), `PACKAGING_SPEC.md` (artifact content), `ENVIRONMENT_SPEC.md` (§5.1 profile ids), `PNPM_SCRIPT_SPEC.md` (command grammar), `AGENTS_SPEC.md` (module AGENTS.md requirements), `APPLICATION_DEPLOY_LAYOUT_SPEC.md` (install paths)

## 1. Goals And Design Principles

- **One entrypoint family per module**: an operator or agent can build, package,
  deploy, and update any SDKWork module with the same five commands and the
  same flags, without reading module-specific scripts.
- **Thin wrappers + one shared library**: module `bin/` scripts contain only
  module-specific wiring (app types, image name, repo command delegation).
  Everything generic — logging, environment validation, image-reference
  resolution, remote execution, file sync, confirmation gates, evidence —
  lives in the shared library. High cohesion (one concern per layer), low
  coupling (modules depend on the library contract, not on each other).
- **Reuse over duplication**: where a repository already owns a canonical
  implementation (bundle `deploy.sh`, `webserver-release.mjs`,
  `build:container`, `build-browser-client.mjs`), the `bin/` entrypoint
  **delegates** to it; it `MUST NOT` reimplement packaging or deployment
  logic.
- **Same environment canon**: the five lifecycle environments of
  `DOCKER_SPEC.md` §3 / `ENVIRONMENT_SPEC.md` §5.1; same port keys, same
  domains, same external-dependency defaults.
- **Single operator channel (normative)**: `bin/` is the *only* operator
  surface of a module. Bundle executors (`deploy.sh`, `release.sh`) are
  private implementation invoked by `bin/docker-deploy.sh` on the target —
  operators never call them by hand. Modules `MUST NOT` ship `pnpm`
  `deploy:`/`release:` wrappers that invoke a bundle executor, a
  `remote-deploy` helper, or any other parallel deployment entrypoint, and
  documentation `MUST NOT` present direct invocation as an operator path
  (audited by `check-operations-conformance.mjs`). Host-provisioning
  infrastructure (PostgreSQL/Redis setup, hosts binding) and the repository
  release chain that `bin/` hooks delegate to are implementation, not
  operator channels, and stay out of operator documentation.

## 2. Layout Contract (Normative)

Every independent deployable module root (including every Rust
`sdkwork-*` service root) `MUST` ship:

```text
<module-root>/
  bin/
    docker-image.sh        # image build / push / save / load / update / inspect
    docker-deploy.sh       # image deployment to a target host (install/upgrade/rollback/status/logs/down/start/stop/restart/check-config)
    config.sh              # deployed-configuration inspection and mutation (OPERATIONS_SPEC.md §3)
    doctor.sh              # read-only environment diagnostics (OPERATIONS_SPEC.md §4)
    backup.sh              # backup / list / verify / restore (OPERATIONS_SPEC.md §5)
    apps-build.sh          # build declared application surfaces
    apps-package.sh        # package declared application surfaces
    apps-deploy.sh         # deploy packaged applications to a target host
    apps-pkg-installer.sh  # package native OS installers (windows|linux|macos|android|ios)
    apps-pkg-installer.ps1 # OPTIONAL Windows companion of apps-pkg-installer.sh (§4.9)
    lib/
      module.sh            # OPTIONAL module-specific wiring (image name, app-type map, repo commands)
    README.md              # short usage card (commands, flags, examples)
```

Rules:

- `bin/*.sh` are **thin dispatches**: each one sets `SDKWORK_ENTRY` and
  sources `bin/lib/bootstrap.sh` — two statements, no logic. A wrapper with
  more than 8 non-comment lines is a spec violation (enforced by
  `tools/check-module-bin.mjs`).
- `bin/lib/bootstrap.sh` resolves the specs root, sources
  `sdkwork-common.sh` → `bin/lib/module.sh` → `entrypoints.sh` →
  `ops-config.sh` / `ops-observe.sh` / `ops-backup.sh`, then calls
  `sdkwork_init` (guards, defaults, evidence trap) and dispatches to
  `sdkwork_entry_<entry>`. The three `ops-*.sh` libraries implement the
  operations lifecycle (`OPERATIONS_SPEC.md`) and load after `module.sh` so
  module constants (`SDKWORK_PRIMARY_SERVICE`, `SDKWORK_HEALTH_PATH`,
  `SDKWORK_CONFIG_ENV_SUBDIR`) win over library defaults.
- The optional `bin/lib/module.sh` is the only place module values live
  (image name, supported app types, delegation commands). It `MUST` define
  only the §3 hooks; generic behavior stays in the shared library. It
  `MUST NOT` reimplement a shared concern — no raw `ssh`/`scp`, no
  `sha256sum`, no `tar -c`, no raw `docker save|push|load|pull`, and no
  hardcoded `SDKWORK_IMAGE_TAG_DEFAULT`.
- The default image tag comes from `sdkwork.app.config.json`
  `release.currentVersion` (`sdkwork_default_image_tag`), never from a
  literal in a wrapper.
- Scripts are executable (`chmod +x`), pass `bash -n`, and `MUST NOT` contain
  secrets, absolute machine-specific paths, or environment values baked in.

## 3. Shared Library Contract (Normative)

Location: `sdkwork-specs/bin/lib/sdkwork-common.sh`. Each `bin/*.sh` resolves
the specs root in this order and sources the library from it:

1. `SDKWORK_SPECS_ROOT` (explicit override),
2. sibling checkout `<module-root>/../sdkwork-specs`,
3. nested checkout `<module-root>/sdkwork-specs`.

If none resolves, the script fails with actionable guidance
(`SDKWORK-BIN-E-SPECS`).

The library `MUST` provide (stable function names, `sdkwork_` prefix):

| Function | Concern |
| --- | --- |
| `sdkwork_log` / `sdkwork_warn` / `sdkwork_die` | Leveled logging with a `[sdkwork-bin]` prefix; `sdkwork_die <code> <msg…>` exits with a stable error code |
| `sdkwork_require_bash` | Bash ≥ 4 + `set -euo pipefail` guard |
| `sdkwork_validate_environment <env>` | Accepts exactly `development\|test\|staging\|demo\|production` (+ aliases `dev`/`prod`), normalizes to the canonical value |
| `sdkwork_validate_profile <profile>` | `standalone\|cloud` import/deployment profile validation |
| `sdkwork_image_ref <docker-name> <tag>` | Canonical `registry.sdkwork.com/apps/<docker-name>:<tag>` (`DOCKER_SPEC.md` §2.1); rejects env-suffixed tags and `latest` |
| `sdkwork_run` | Dry-run aware executor: prints the command when `SDKWORK_BIN_DRY_RUN=1`, executes otherwise |
| `sdkwork_confirm_production <env>` | Refuses production mutations unless `SDKWORK_BIN_YES=1` (`--yes`) |
| `sdkwork_remote <target> <command…>` | Unified execution: `wsl` (local WSL/Ubuntu shell) or `ssh://[user@]host[:port]` (batch-mode ssh, `StrictHostKeyChecking=accept-new`) |
| `sdkwork_push_dir <target> <src> <dest>` | Bundle/directory sync to a target: `tar` over ssh for remote, plain path for `wsl` |
| `sdkwork_init` | One-shot startup: bash guard, specs self-check, module self-check, default image tag, evidence trap |
| `sdkwork_specs_selfcheck` / `sdkwork_module_selfcheck` | Fail fast on an unresolved specs checkout or incomplete `module.sh` wiring |
| `sdkwork_default_image_tag` | Default tag from `sdkwork.app.config.json release.currentVersion` |
| `sdkwork_validate_image_tag <tag>` | Rejects env-suffixed tags and `latest` (`DOCKER_SPEC.md` §2.1) |
| `sdkwork_assert_image_present <ref>` | Asserts a build produced the canonical ref before the entrypoint returns |
| `sdkwork_confirm_destructive <what>` | Independent destructive-option gate (e.g. `--purge`), requires `--yes` |
| `sdkwork_need_value <option> <value>` | Option-value guard: rejects a missing or flag-shaped value |
| `sdkwork_local_run <command…>` | Runs a repository command in the module root, in the correct POSIX context (see §3.1); path arguments are translated automatically |
| `sdkwork_wsl_path <path>` / `sdkwork_local_path <path>` | Host-path → WSL-path translation (identity outside the bridge) |
| `sdkwork_shell_quote <args…>` | POSIX-quotes argv for transport through a remote shell |
| `sdkwork_remote_in_dir <target> <dir> <command…>` | `cd <dir> && <command…>` on the target — the only sanctioned way to reach a bundle entrypoint |
| `sdkwork_remote_file_exists <target> <path>` | Non-fatal presence probe on the target (returns 0/1) |
| `sdkwork_service_enable_now <target> <unit>` | `daemon-reload` + `enable --now` + `is-active` for a systemd unit |
| `sdkwork_service_status <target> <unit>` / `sdkwork_health_probe <target> <url>` | Host-native service/health verification (§4.5) |
| `sdkwork_write_checksum <file>` | Writes the sidecar `<file>.sha256` |
| `sdkwork_tar_artifact <src> <artifact>` | `tar` + checksum for a directory artifact |
| `sdkwork_require_dir <dir> [hint]` / `sdkwork_require_artifact <dir> <pattern> [hint]` | Path/artifact guards that dry-run reports instead of enforcing |
| `sdkwork_latest_match <dir> <pattern>` | Newest matching file (empty when nothing matches) |
| `sdkwork_collect_artifact <src-dir> <out> <pattern> [fallback…]` | Copies a repo-producartifact into `--out` with its checksum |
| `sdkwork_assert_out_artifacts <dir>` | Fails the run when `--out` received no artifact or one without a checksum |
| `sdkwork_bin_doctor` | Self-check: library loaded, specs root resolved, docker/ssh availability, execution context, prints versions |
| `sdkwork_evidence <message…>` | Records the plan; the `EXIT` trap (`sdkwork_evidence_flush`) appends command, flags, and **exit status** to `<module>/target/bin-evidence/evidence.log` |

### 3.1 Execution Context (Normative)

`bin/` drives POSIX-only commands (`cargo`, `docker compose`, `tar`,
`sha256sum`, `systemctl`) and POSIX target paths (`/opt/deploy/...`). The
shared library therefore resolves one execution context:

| Where the operator runs | Context | Behavior |
| --- | --- | --- |
| WSL Ubuntu / Linux | native POSIX | commands run directly |
| Windows shell (Git Bash / MSYS2) | bridged | every local repository command and every `wsl` target command is run as `wsl -e bash -lc '<command>'`, with host paths translated to `/mnt/<drive>/…` |
| `ssh://[user@]host[:port]` | remote | batch-mode ssh, unchanged |

`bin/* doctor` prints the resolved context. A module wrapper `MUST NOT`
branch on the host OS — the bridge lives entirely in the shared library.

Module wiring (`bin/lib/module.sh`) `MUST` define only:

```sh
SDKWORK_MODULE_ID="sdkwork-api-cloud-gateway"     # module identity
SDKWORK_IMAGE_NAME="sdkwork-api-cloud-gateway"    # docker-name for §2.1 refs
SDKWORK_APP_TYPES="server"                        # supported app types (§5)
sdkwork_build_app()     { … }                     # app-type → repo build delegation
sdkwork_package_app()   { … }                     # app-type → repo packaging delegation
sdkwork_deploy_app()    { … }                     # app-type → repo deployment delegation
sdkwork_installer_app() { … }                     # app-type + platform → repo native-installer delegation (§4.9)
sdkwork_image_build()   { … }                     # → repo container image build command
sdkwork_module_bundle_dir() { … }                 # OPTIONAL: install bundle path (default deployments/docker/bundle)
```

Hooks receive positional arguments only; every generic concern they need is
already a library primitive. Delegated repository commands `MUST` use the
target script's real CLI — a wrapper `MUST NOT` pass an option the
repository command does not accept.

### 3.2 Startup Sequence (Normative)

```text
bin/<entry>.sh            # sets SDKWORK_ENTRY, sources lib/bootstrap.sh
  └─ lib/bootstrap.sh     # resolves SDKWORK_SPECS_ROOT (§3 order), sources
     │                    #   sdkwork-common.sh → lib/module.sh → entrypoints.sh
     └─ sdkwork_init      # bash guard, specs self-check, module self-check,
                          #   default image tag, EXIT evidence trap
        └─ sdkwork_entry_<entry> "$@"   # parse → validate → gate → delegate → evidence
```

## 4. Entrypoint Contracts (Normative)

Common flag grammar (all apps-* and lifecycle scripts):

```text
--environment <development|test|staging|demo|production>   # default: development
--profile <standalone|cloud>                               # import/deployment profile where meaningful
--host wsl | ssh://[user@]host[:port]                      # deployment target; default wsl
--dry-run                                                  # print the plan, execute nothing
--yes                                                      # required for production mutations
-h | --help
```

Every script `MUST` be idempotent (re-running converges), `MUST` fail fast on
unknown environments/options before side effects, and `MUST` record evidence.

### 4.1 `bin/docker-image.sh` — Image Packaging And Update

Every `docker` CLI invocation (build/push/save/load/update/inspect) runs
through `sdkwork_local_run`, so the execution-context bridge (§3.1) applies:
from a Windows shell the command is executed inside WSL Ubuntu against the
same daemon, never against a missing Windows docker.


```text
docker-image.sh build  [--image-tag <v>]            # build the canonical image ref (delegates to the repo container build)
docker-image.sh push   [--image-tag <v>]            # push to the registry
docker-image.sh save   [--image-tag <v>] [-o file]  # docker save → .tar.gz (+ sha256)
docker-image.sh load   -i file                      # docker load a saved image
docker-image.sh update [--image-tag <v>]            # pull (or load) + retag + prune dangling — the only sanctioned "update" path
docker-image.sh inspect [--image-tag <v>]           # print ref, digest, labels, size
```

Rules:

- The image reference is always `sdkwork_image_ref "$SDKWORK_IMAGE_NAME"
  "${tag}"`; `latest` and env-suffixed tags are rejected
  (`DOCKER_SPEC.md` §2.1).
- `build` `MUST` delegate to the repository's canonical container build
  (e.g. `pnpm build:container`, `scripts/webserver-release.mjs`), never to a
  hand-rolled `docker build` with a second Dockerfile path.
- `update` on a target host replaces the image and then re-applies the
  running deployment idempotently (see 4.2 `upgrade`).

### 4.2 `bin/docker-deploy.sh` — Image Deployment (WSL And Remote Ubuntu)

The bundle that `install`/`upgrade` push to `/opt/deploy/<module>/bundle` is
the **newest packaged install bundle** (`dist/docker-install/*install-*.bundle`,
resolved by the module hook `sdkwork_module_install_bundle_dir` with
`sdkwork_newest_install_bundle`) — a self-contained stage-2 artifact with its
own `deploy.sh`, `compose/`, and `env/`. Deploying straight from the source
bundle directory is only the fallback when nothing has been packaged yet.
The push skips `image.tar.gz` when the target already runs the default image
tag (`sdkwork_remote_image_exists`), so a same-version reinstall moves
kilobytes instead of gigabytes.


docker-deploy.sh install  --environment <env> [--replicas N] [--host <target>] [--image-tag <v>] [--deps external|embedded]
                           [--host-port <BASE>] [--edge-http <P>] [--edge-https <P>] [--domain <HOST>]
docker-deploy.sh upgrade  --environment <env> [--image-tag <v>] [--host <target>] [--deps external|embedded]
                           [--host-port <BASE>] [--edge-http <P>] [--edge-https <P>] [--domain <HOST>]
docker-deploy.sh rollback --environment <env> [--host <target>] [--to <version>]
docker-deploy.sh status   --environment <env> [--host <target>]
docker-deploy.sh logs     --environment <env> [--host <target>]
docker-deploy.sh down     --environment <env> [--host <target>] [--purge]
docker-deploy.sh start    --environment <env> [--host <target>]
docker-deploy.sh stop     --environment <env> [--host <target>]
docker-deploy.sh restart  --environment <env> [--host <target>]
docker-deploy.sh check-config --environment <env> [--host <target>]
```

The bundle is synced to the canonical target path
`/opt/deploy/<module-id>/bundle` (`APPLICATION_DEPLOY_LAYOUT_SPEC.md`); every
bundle command runs through `sdkwork_remote_in_dir`, so `deploy.sh` is always
reached with the bundle directory as its working directory.

Semantics:

- **install**: materialize/refresh the install bundle on the target host
  (`sdkwork_push_dir` for remote), ensure host-system PostgreSQL/Redis
  prerequisites (`DEPLOYMENT_SPEC.md` §6.1), ensure the image, then run the
  bundle `deploy.sh --environment <env> [--replicas N] [--image-tag <v>]
  [--external|--embedded]`.
- **upgrade**: pull/load the new image on the target, re-run the bundle
  `deploy.sh` (idempotent), verify `/healthz`/`/readyz`.
- **rollback**: bundle-owned `release.sh rollback --environment <env> [--to
  <version>]` when the deployed bundle ships it; otherwise re-install the
  current bundle (idempotent) and warn that no release history exists.
- **status / logs**: `deploy.sh --ps` / `deploy.sh --logs`; read-only, no
  bundle sync, and a missing deployed bundle is a warning, not a failure.
- **down**: `deploy.sh --down [--purge]`; a missing deployed bundle is a
  warning, not a failure.
- **start / stop / restart** (runtime lifecycle, `deploy.sh
  --start|--stop|--restart`): compose-level `start/stop/restart` of the
  **already-installed** stack — no image pull, no repackaging, no env change,
  containers and volumes are kept, so `start` restores the exact same
  deployment. `stop` also stops embedded deps (they are part of the stack);
  `start` brings embedded deps back first (database before app); `restart`
  cycles only the app instances — stateful deps and the sibling gateway keep
  running. A missing deployed bundle is a **fail-closed state error** with
  install guidance (nothing exists to start/stop), and every one of the three
  is a mutating action gated behind `--yes` on `production`
  (`sdkwork_confirm_production`).
- **check-config**: read-only env preflight on the deployed bundle
  (`deploy.sh --check-config`, `DEPLOYMENT_SPEC.md` §6 unified deployer
  capability matrix); deploys nothing, a missing deployed bundle is a
  warning, not a failure.

Rules:

- `--image-tag` is forwarded to the bundle `deploy.sh`, and for remote
  targets the canonical ref is pulled on the target before the bundle runs.
- `--deps external|embedded` maps onto the bundle's `--external/--embedded`;
  external (host PostgreSQL/Redis) is the default and `MUST NOT` be passed
  implicitly.
- Remote targets run Ubuntu; all remote mutations go through
  `sdkwork_remote` (no ad-hoc ssh calls in wrappers).
- Only one webserver instance publishes edge ports; multi-instance port
  strides follow `DOCKER_SPEC.md` §3.2.
- `install`/`upgrade`/`rollback`/`start`/`stop`/`restart` against `production`
  require `--yes` (`sdkwork_confirm_production`); `--purge` requires `--yes`
  in **every** environment (`sdkwork_confirm_destructive`).

**Runtime port/domain overrides** (`--host-port/--edge-http/--edge-https/
--domain`, webserver install/upgrade; §4.2 grammar above): these let an
operator bind an application at arbitrary host ports or domains at deploy time,
decoupled from the environment's port template. Precedence is
**CLI > env-file > built-in fallback**. The entrypoint forwards the four flags
verbatim to the bundle `deploy.sh`, which validates them, composes on the
override for the current run, and **persists them into the env file on apply**
so the deployed state stays the single source of truth (`doctor`/`config`/
`status` read the same published port on later runs). A bundle whose
`deploy.sh` does not accept a forwarded flag `MUST` fail fast rather than
silently ignore it. `doctor.sh`'s HTTP probe resolves the live host port from
the pulled deployment env via `sdkwork_module_health_port <env> <instance>`,
so an override is honoured (not a stale built-in default). Different
applications on the same environment are just deploys with different
`--host-port` bases / edge ports.

### 4.3 `bin/apps-build.sh` — Application Build

```text
apps-build.sh <app-type> <environment>[:<profile>] [--dry-run]
app-type ∈ module-declared SDKWORK_APP_TYPES, e.g.:
  pc | h5            # Adaptive Web browser surfaces (canonical runner)
  flutter            # Flutter mobile (dart-define env file)
  mini-program       # WeChat/Alipay/... mini program
  desktop            # Tauri/Electron host
  server             # Rust/cargo service build (Rust modules)
```

Rules:

- `<environment>` uses the canonical aliases (`dev`, `test`, `staging`,
  `demo`, `prod`); `[:<profile>]` selects `standalone` (default) or `cloud`.
- Browser builds delegate to the canonical runner
  (`tools/build-browser-client.mjs`) — the same authority as
  `PNPM_SCRIPT_SPEC.md` §4.2; output lands in
  `dist/<deploymentProfile>/<envAlias>/`.
- Builds are build-only: no dev servers, no database bootstrap, no
  deployment side effects.
- A module `MUST` declare its supported app types in `bin/lib/module.sh`
  (`SDKWORK_APP_TYPES`); requesting an undeclared type fails with guidance.

### 4.4 `bin/apps-package.sh` — Application Packaging

```text
apps-package.sh <app-type> <environment>[:<profile>] [--out <dir>]
```

- Delegates to the repository's canonical packaging (e.g.
  `webserver-release.mjs`, `package-server.mjs`, `flutter build appbundle`,
  mini-program dist zip) and emits one artifact + `.sha256` into `--out`
  (default `target/bin-packages/`).
- The repository packager keeps its own output location; when it has no
  `--out` option the wrapper collects the artifact with
  `sdkwork_collect_artifact`. After the hook returns, the entrypoint runs
  `sdkwork_assert_out_artifacts`, so a silent no-op packaging run fails with
  `SDKWORK-BIN-E-STATE` instead of "succeeding".
- `--dry-run` prints the plan even when the artifacts do not exist yet;
  missing inputs are warnings, not failures.
- Content rules follow `PACKAGING_SPEC.md` (forbidden/required content);
  artifacts carry no secrets and no environment-baked config.
- Container packaging routes through 4.1 (`docker-image.sh save`).
- A repository packager that only covers a subset of the lifecycle
  environments (for example a `test|production`-only `.deb` installer)
  `MUST` fail fast with guidance pointing at the container path instead of
  silently substituting another environment's artifact.

### 4.5 `bin/apps-deploy.sh` — Application Deployment (WSL And Remote Ubuntu)

```text
apps-deploy.sh <app-type> <install|upgrade|rollback|status> <environment>[:<profile>] [--host <target>]
```

- **server** (host-native install): push the package to
  `/opt/deploy/<module-id>/packages` on the target Ubuntu host, install it
  with the package's own installer (`apt-get install` for a `.deb`,
  `install/install-ubuntu.sh` for a server tarball), enable and start the
  systemd unit (`sdkwork_service_enable_now`), then verify
  `systemctl is-active` and the service health endpoint
  (`sdkwork_health_probe`). The remote account needs root privileges; the
  wrappers inject no `sudo` so the operator controls the identity through
  `--host root@…`.
- **rollback** on a host-native channel is not tracked by the package
  manager; the entrypoint `MUST` fail with guidance to package and install
  the previous version rather than pretending to roll back.
- **pc/h5/mini-program/desktop**: publish the packaged artifact to its
  delivery target — webserver static roots/CDN for browser bundles, store or
  MDM channel metadata for native packages; deploy commands never rebuild.
- Remote execution and file push go exclusively through the shared library
  primitives (§3); production mutations require `--yes`.

### 4.6 `bin/config.sh` — Deployed Configuration (Normative)

Authority for behavior: `OPERATIONS_SPEC.md` §3. The entrypoint is a parse →
validate → gate → delegate flow; the implementation lives in
`sdkwork-specs/bin/lib/ops-config.sh`.

```text
bin/config.sh <list|show|get|set|diff|validate|edit> --environment <env>
              [--instance N] [--key <K>] [--value <V>] [--reveal]
              [--host wsl|ssh://[user@]host[:port]] [--yes] [--dry-run]
```

- Reads the live configuration from the deployed bundle on the target; never
  from the source tree (except under `--dry-run`, which renders the
  source-tree copy so plans are still meaningful).
- Secrets are redacted with the shared `SDKWORK_SECRET_*` patterns; the
  patterns are declared once in `sdkwork-common.sh` and `MUST NOT` be
  re-declared per module.
- `set` and `edit` mutate, write a timestamped `.bak.<UTC>` on the target
  first, run the module validator afterwards, and require `--yes` in
  `production`.
- Module hooks: `SDKWORK_CONFIG_ENV_SUBDIR`, `sdkwork_module_local_env_dir`,
  `sdkwork_module_config_validate`.

### 4.7 `bin/doctor.sh` — Environment Diagnostics (Normative)

Authority: `OPERATIONS_SPEC.md` §4. Read-only, never requires `--yes`, exits
`70` when any check fails.

```text
bin/doctor.sh --environment <env> [--instance N] [--json] [--export <dir>]
              [--host wsl|ssh://[user@]host[:port]] [--dry-run]
```

Implements the §4.2 check set (toolchain, bundle, compose, container health,
HTTP probe, image drift, configuration drift, log errors, disk). Module
hooks: `SDKWORK_PRIMARY_SERVICE`, `SDKWORK_HEALTH_PATH`,
`sdkwork_module_health_port <env> <instance>` (optional; resolves the live host
port for the probe — doctor pulls the deployed env first so a module hook may
return the real published port including the instance-stride offset, instead of
a hardcoded default), `sdkwork_module_expected_image_tag` (optional;
the image tag the deployed bundle considers authoritative, consulted by the
image-drift check before the environment chain), `sdkwork_module_extra_doctor`.
`bin/docker-deploy.sh doctor` remains the *local* self-check; only
`bin/doctor.sh` inspects a deployed environment.

### 4.8 `bin/backup.sh` — Backup And Restore (Normative)

Authority: `OPERATIONS_SPEC.md` §5. Backup sets are created on the target
host (`/opt/deploy/<module>/backups/<module>-<env>-<UTC>/`) so a long dump
never dies with the control connection.

```text
bin/backup.sh <create|list|verify|restore> --environment <env>
              [--set <name>] [--component all|config|database|volumes]
              [--no-db] [--no-volumes] [--host wsl|ssh://… ] [--yes] [--dry-run]
```

- Every component carries a sidecar `.sha256`; `verify` recomputes them.
- `restore` is destructive: it stops the stack first, requires `--yes`, and
  prints the exact command to bring the stack back.
- Module hooks: `sdkwork_module_backup_db_env_prefix`,
  `sdkwork_module_backup_db_name_suffix`, `sdkwork_module_backup_volume_filter`.
- `docker-deploy.sh logs` supports `--instance`, `--service`, `--tail`,
  `--since`, `--follow`, `--export` (`OPERATIONS_SPEC.md` §2.4); `--follow` is
  opt-in so scripted and ticket-driven reads stay bounded.

### 4.9 `bin/apps-pkg-installer.sh` — Native Installer Packaging (Normative)

Authority for artifact content: `PACKAGING_SPEC.md` (§2 forbidden, §3
required, §5.2–§5.5 format rules). This entrypoint wraps the repository's
canonical **native installer builders** — the OS-installable channel of the
archive packaging in §4.4.

```text
apps-pkg-installer.sh <app-type> <platform> <environment>[:<profile>]
                      [--arch x64|arm64] [--format <fmt>] [--out <dir>] [--dry-run]
platform ∈ windows|linux|macos|android|ios
```

- `--arch` defaults to `x64` (`sdkwork_validate_arch`); `--format` selects
  the format within a platform when the repository ships more than one
  (e.g. linux: `deb|rpm`; windows desktop: `nsis|msi`; android: `apk|aab`);
  the module's declared primary format is the default.
- Every artifact lands in `--out` (default `target/bin-installers/`) with a
  sidecar `.sha256` (`sdkwork_assert_out_artifacts` knows installer
  extensions: msi/exe/pkg/dmg/AppImage/ipa in addition to the §4.4 set); a
  silent no-op run fails with `SDKWORK-BIN-E-STATE`.
- Module hook: `sdkwork_installer_app <app-type> <platform> <environment>
  <profile> <out> <arch> <format>` — delegate to the repository's canonical
  installer builder, never reimplement packaging in the hook.
- A platform the repository cannot build on the current host `MUST` fail
  fast with guidance (e.g. macOS `.pkg` on Linux, Windows `.msi` needing its
  Windows toolchain) instead of substituting another platform's artifact.
- Coverage limits follow the repository builder's own contract (e.g. a
  `test|production`-only `.deb` channel refuses other environments with the
  container path as guidance, same rule as §4.4).
- `--dry-run` prints the delegation plan (and the collect step) without
  executing; production packaging itself is not gated behind `--yes` (no
  target mutation), but the run is still evidenced.
- **Windows companion (normative when shipped)**: Windows shells do not run
  `.sh`. A module `MAY` ship `bin/apps-pkg-installer.ps1` as the Windows
  twin of this entrypoint. It `MUST` mirror the sh CLI 1:1 (positional
  `<app-type> <platform> <environment>[:<profile>]` plus `-Arch -Format -Out
  -DryRun -Help`), delegate to the same repository builders, enforce the
  same platform-set/architecture validation, fail fast with the same
  cross-OS guidance (host platform `windows` on a native Windows host),
  emit artifacts into `--out` with `Get-FileHash`-based `.sha256` sidecars
  formatted like `sha256sum`, and run on Windows PowerShell 5.1+ without
  bash in the wrapper. A module that ships the companion `MUST` document
  per-OS command execution in its `docs/guides/operator/pkg-installers.md`.

## 5. Rust Module Requirements (Normative)

Every Rust-implemented SDKWork independent module (`sdkwork-webserver`,
`sdkwork-api-cloud-gateway`, and every future Rust service root):

- `MUST` ship the full `bin/` family (§2) with `SDKWORK_APP_TYPES` at least
  declaring `server` plus every browser surface the module owns (`pc`, `h5`,
  …).
- `MUST` keep its Cargo/container build as the delegation target of
  `docker-image.sh build` / `apps-build.sh server` — no parallel build paths.
- `MUST` document the deployment standard in its `AGENTS.md` (§6).
- Image naming, bundle layout, environment matrix, and port keys follow
  `DOCKER_SPEC.md` unchanged.

## 6. `AGENTS.md` Deployment Section (Normative)

Every deployable module `AGENTS.md` `MUST` contain a top-level
`## Deployment Standard (bin/)` section declaring:

1. the five `bin/` entrypoints and what they delegate to in this repository;
2. `SDKWORK_APP_TYPES` and supported environments;
3. the canonical image reference and per-environment host ports (or a
   pointer into `DOCKER_SPEC.md` §3);
4. the target hosts this module supports (`wsl`, remote Ubuntu);
5. the authoritative specs: `MODULE_BIN_SPEC.md`, `DOCKER_SPEC.md`,
   `DEPLOYMENT_SPEC.md`.

The section is routing text only — module `AGENTS.md` files `MUST NOT` copy
normative bodies from the root specs (`AGENTS_SPEC.md`).

## 7. Validation And Acceptance Checklist

Validation tooling:

```sh
# per-module CI
node sdkwork-specs/tools/check-module-bin.mjs --root <module-root>
# fleet regression (same code path in child processes; the standard is binary,
# so there is no N/A: every module owns a bin/ family)
node sdkwork-specs/tools/check-module-bin.mjs --workspace <workspace-root>
node sdkwork-specs/tools/scaffold-module-bin.mjs --root <module-root>   # idempotent scaffold of a missing/incomplete family
bash -n <module-root>/bin/*.sh
sdkwork-bin-doctor   # via any bin script's hidden 'doctor' subcommand
```

Both modes apply the same fleet predicate used by the operations gate and by
the platform's own repo discovery: a *module* is a directory named `sdkwork-*`
carrying `sdkwork.app.config.json` at its root. Directories without a manifest
are reported as skipped; a manifest outside the `sdkwork-*` convention (a
product repo) is reported separately and audited only under
`--include-off-fleet`, because the fleet convention does not claim it. A child
process that cannot emit a report counts as a failure — never a silent pass.

- [ ] `bin/` contains exactly the nine entrypoints (`docker-image.sh`,
      `docker-deploy.sh`, `config.sh`, `doctor.sh`, `backup.sh`,
      `apps-build.sh`, `apps-package.sh`, `apps-deploy.sh`,
      `apps-pkg-installer.sh`; plus `lib/`, `README.md`);
      each is executable, passes `bash -n`, and stays inside the §2 thin
      wrapper budget.
- [ ] Every entrypoint delegates through `lib/bootstrap.sh` → `sdkwork_init`;
      module wiring lives only in `bin/lib/module.sh`.
- [ ] `bin/lib/module.sh` reimplements no shared concern (no raw ssh/scp,
      `sha256sum`, `tar -c`, or docker transport) and hardcodes no image tag.
- [ ] Every delegated repository command uses that command's real CLI —
      no option is passed that the target script does not accept.
- [ ] `--dry-run` on every mutating path prints the plan and executes
      nothing; production mutations refuse without `--yes`; `--purge` refuses
      without `--yes` in every environment.
- [ ] Environments are the canonical five; unknown values fail before side
      effects; evidence is recorded per run **with the exit status**.
- [ ] Image references use `registry.sdkwork.com/apps/<docker-name>:<version>`;
      no `latest`, no env-suffixed tags; a build asserts the ref exists.
- [ ] Every packaged artifact lands in `--out` with a sidecar `.sha256`, and
      a run that produces nothing fails instead of succeeding.
- [ ] Remote deployment works against WSL Ubuntu and a remote Ubuntu host
      with no module-specific ssh code in the wrappers; bundle commands run
      with the deployed bundle as the working directory.
- [ ] The repository's canonical build/package/deploy commands remain the
      single delegation targets (no duplicated logic in `bin/`).
- [ ] `bin/config.sh`, `bin/doctor.sh`, and `bin/backup.sh` behave per
      `OPERATIONS_SPEC.md` §3-§5: secrets redacted, mutation backed up and
      validated, doctor read-only with a non-zero exit on `FAIL`, backups
      checksummed and restore-gated behind `--yes`.
- [ ] `bin/lib/bootstrap.sh` sources the three `ops-*.sh` shared libraries.
- [ ] `AGENTS.md` carries the §6 deployment section.
- [ ] **Single operator channel**: no `package.json` script invokes a bundle
      executor (`bundle/deploy.sh`, `bundle/release.sh`) or a
      `remote-deploy` helper directly; no operator-facing documentation
      (README, runbooks, operator guides) presents direct executor
      invocation as an operator path; the only documented deploy surface is
      `bin/` (audited by `check-operations-conformance.mjs`).
