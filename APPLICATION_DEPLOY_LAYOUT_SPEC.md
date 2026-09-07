# Application Deploy Layout Standard

- Version: 1.0
- Scope: universal source vs installed layout, runtime config file naming, per-application path registry, cross-OS config roots
- Related: `SOURCE_CONFIG_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `SDKWORK_DEPLOY_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `SDKWORK_WEBSERVER_SPEC.md`, `APP_RUNTIME_TOPOLOGY_NAMING.md`

One-page authority for **where configuration lives** and **how deployable modules map to host paths**. Detailed rules stay in the linked specs; this document does not duplicate them.

## 1. Three Layers

| Layer | Location | Role |
| --- | --- | --- |
| Source | `<repo>/etc/`, `<repo>/deployments/` | Checked-in profiles, templates, orchestration; no live secrets |
| Installed | OS config root (below) | Operator-managed runtime files written by installer/container |
| Secrets | `<config-root>/secrets/` | Passwords, keys, tokens; referenced by path only |

Ownership sentence (`SOURCE_CONFIG_SPEC.md`):

> `sdkwork.app.config.json` declares identity; `specs/` declares contracts; `etc/` declares profile instances; `deployments/` declares install/orchestration; installed OS files are materialized runtime.

## 2. Deployable Root (Source)

Every independently deployable repository **MUST** contain:

```text
<repo>/
  sdkwork.app.config.json
  specs/topology.spec.json
  etc/                              # profile env files, examples, README
  deployments/
    deploy.yaml                     # SDKWORK_DEPLOY_SPEC.md
```

**MAY** contain when the module has a public web surface:

```text
    deployments/webserver/          # SDKWORK_WEBSERVER_SPEC.md layout v3
      server.common.toml
      server.development.toml
      server.test.toml
      server.staging.toml
      server.production.toml
      server.standalone.toml
      server.cloud.toml
```

Rules:

- One `deployments/deploy.yaml` per application repository; no workspace-wide deploy manifest.
- `deployments/webserver/` is **deploy-time** web data-plane source; it is not the process runtime config file.
- Development uses `{repoRoot}` paths; production packages use `RUNTIME_DIRECTORY_SPEC.md` host paths (`SDKWORK_DEPLOY_SPEC.md` `install.layout`).

## 3. Installed Layout (All Applications)

Replace `<code>` with `topology.applicationCode` (runtime code). Linux/container defaults:

| Purpose | Path |
| --- | --- |
| Config root | `/etc/sdkwork/<code>/` |
| **Runtime config** | `/etc/sdkwork/<code>/config.toml` |
| Secrets | `/etc/sdkwork/<code>/secrets/` |
| Binaries | `/usr/lib/sdkwork/<code>/` |
| Shared assets | `/usr/share/sdkwork/<code>/` |
| Adaptive Web PC SPA | `/usr/share/sdkwork/<code>/web/pc/` |
| Adaptive Web H5 SPA | `/usr/share/sdkwork/<code>/web/h5/` |
| Ordinary static fallback | `/usr/share/sdkwork/<code>/web/static/` |
| Durable data | `/var/lib/sdkwork/<code>/` |
| Logs | `/var/log/sdkwork/<code>/` |
| Runtime state | `/run/sdkwork/<code>/` |

Rules:

- `topology.applicationCode` `MUST` be lowercase kebab-case (`NAMING_SPEC.md` L2
  application code; for example `api-gateway`, `cloudrouter`, `webserver`).
  Underscore codes (`api_gateway`) `MUST NOT` appear in installers, container
  images, systemd units, or operator documentation. Snake_case applies only to
  derived database/schema identifiers per `DATABASE_SPEC.md` (for example the
  database `sdkwork_api_gateway_demo` is legal even though the application
  code is `api-gateway`).
- Legacy underscore installs (`/etc/sdkwork/api_gateway/`) remain readable as
  runtime fallbacks during migration but are never written by new tooling.

Source builds → install: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1.
Cross-OS share roots: `RUNTIME_DIRECTORY_SPEC.md` §4.1.1.

**Cross-OS config root** (same `<code>` segment):

| OS | Config root |
| --- | --- |
| Linux / container | `/etc/sdkwork/<code>/` |
| macOS service | `/Library/Application Support/sdkwork/<code>/` |
| Windows service | `%ProgramData%\sdkwork\<code>\` |

**Override:** `SDKWORK_<APPLICATION_CODE>_CONFIG_FILE` → runtime TOML path  
(`APPLICATION_CODE` = uppercase `topology.applicationCode`, e.g. `webserver` → `SDKWORK_WEBSERVER_CONFIG_FILE`).

Rules:

- New applications **MUST** use `config.toml` as the primary runtime config file name.
- Legacy `<process>.toml` or `<code>.toml` names **MAY** remain during migration; installers **SHOULD** emit `config.toml`.
- Secrets **MUST NOT** be embedded in `config.toml` or committed source files.
- Shared workspace PostgreSQL on multi-app hosts: `/etc/sdkwork/database/` (`ENVIRONMENT_SPEC.md` §7.3). Single-app hosts **MAY** keep database secret under `/etc/sdkwork/<code>/secrets/`.

### Process-specific secondary config

Some hosts add a second installed file for a specialized subsystem. Document it in the application `etc/README.md`; do not change the universal `config.toml` rule.

| Application | Secondary file (under config root) | Schema authority |
| --- | --- | --- |
| `webserver` | `sdkwork.webserver.config.json` | application `specs/sdkwork.webserver.config.schema.json` |

Retired secondary names (`chat.toml`, `cloudrouter.toml`, `<code>.toml` as the primary runtime file) `MUST NOT` appear in new installers, scripts, or docs. Override for secondary files: application-specific env in that application's `etc/README.md` (e.g. `SDKWORK_WEBSERVER_SERVER_CONFIG_FILE`).

## 4. Application Registry

`runtimeCode` = `topology.applicationCode`. Host paths use `runtimeCode`, not repository `appId` or `app.key`.

| Repository (`appId`) | `runtimeCode` | Linux config root | Public role host (production) |
| --- | --- | --- | --- |
| `sdkwork-im` | `im` | `/etc/sdkwork/im/` | `im.sdkwork.com` |
| LLM / Agent (`chat`) | `chat` | `/etc/sdkwork/chat/` | `chat.sdkwork.com` |
| `sdkwork-drive` | `drive` | `/etc/sdkwork/drive/` | `drive.sdkwork.com` |
| `sdkwork-cloudrouter` | `router` | `/etc/sdkwork/router/` | `router.sdkwork.com` (+ registered alias domains) |
| `sdkwork-knowledgebase` | `knowledgebase` | `/etc/sdkwork/knowledgebase/` | `knowledgebase.sdkwork.com` |
| `sdkwork-birdcoder` | `birdcoder` | `/etc/sdkwork/birdcoder/` | `code.sdkwork.com` |
| `sdkwork-appstore` | `appstore` | `/etc/sdkwork/appstore/` | `appstore.sdkwork.com` |
| `sdkwork-manager` | `manager` | `/etc/sdkwork/manager/` | `admin.sdkwork.com` |
| `sdkwork-webserver` | `webserver` | `/etc/sdkwork/webserver/` | `server.sdkwork.com` |
| `sdkwork-iam` | `iam` | `/etc/sdkwork/iam/` | (per topology) |
| `sdkwork-commerce` | `commerce` | `/etc/sdkwork/commerce/` | (per topology) |

Host naming detail: `APP_RUNTIME_TOPOLOGY_NAMING.md` §9. Role hosts **MAY** differ from `runtimeCode`; directories and env prefixes **MUST** follow `runtimeCode`.

## 5. Delivery Targets

| Target | Config root | Notes |
| --- | --- | --- |
| `.deb` / `.rpm` / systemd | `/etc/sdkwork/<code>/` | postinst writes `config.toml` + `secrets/` |
| Docker / container | `/etc/sdkwork/<code>/` | Same FHS paths; entrypoint or mount renders `config.toml` |
| Kubernetes | `/etc/sdkwork/<code>/` | ConfigMap/Secret mount; see application `deployments/kubernetes/` |
| Development checkout | none required | `etc/topology/*.env` + env overrides; optional `etc/examples/config.toml.example` |

## 6. Permissions (Linux)

| Path | Mode | Owner |
| --- | --- | --- |
| `config.toml` | `0640` | `root:sdkwork` |
| `secrets/*` | `0600` | `sdkwork:sdkwork` (or `root:sdkwork` when only root reads) |
| config root directory | `0750` | `root:sdkwork` |

## 7. Verification

Application repositories **SHOULD** document local validation in `etc/README.md`.

```bash
# Single repository
node <sdkwork-specs>/tools/check-application-deploy-layout.mjs --root .

# Entire workspace (all deployable sdkwork-* Rust backends)
node <sdkwork-specs>/tools/check-application-deploy-layout.mjs --workspace <sdkwork-space-root>

# Materialize missing layout artifacts (README section, config.toml.example, deploy.yaml stub, webserver placeholder)
node <sdkwork-specs>/tools/align-application-deploy-layout.mjs --workspace <sdkwork-space-root>

# Retire configs/topology → etc/topology and normalize profileFiles paths
node <sdkwork-specs>/tools/migrate-application-deploy-legacy.mjs --workspace <sdkwork-space-root>
```

Additional checks:

```bash
node <sdkwork-specs>/tools/check-source-config-standard.mjs --root .
node <sdkwork-specs>/tools/check-deploy-standard.mjs
node <sdkwork-specs>/tools/check-webserver-toml-standard.mjs --root deployments/webserver
node <sdkwork-specs>/tools/align-webserver-workspace.mjs --root .
```

## 8. Document Map

| Question | Read |
| --- | --- |
| Source `etc/` ownership and profiles | `SOURCE_CONFIG_SPEC.md` |
| Full FHS matrix, database/Redis paths | `RUNTIME_DIRECTORY_SPEC.md` |
| `deploy.yaml`, install layouts, nginx | `SDKWORK_DEPLOY_SPEC.md` |
| `deployments/webserver/*.toml` merge rules | `SDKWORK_WEBSERVER_SPEC.md` |
| Host registry and environment suffixes | `APP_RUNTIME_TOPOLOGY_NAMING.md` |
| Env keys and materialization | `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md` |

## 9. Host Deploy Root And Shared-Surface Contract (Docker Mode)

Normative layout of the **host deploy root** (`SDKWORK_SPACE_ROOT`, default
`/opt/deploy`) when applications ship as Docker bundles. Every module's
bundle installer `MUST` materialize exactly this layout; paths are module
namespaced so independent stacks cannot collide, and shared surfaces are
bind-mounted — never copied per container.

### 9.1 Host Deploy Root Layout

```text
/opt/deploy/                              # SDKWORK_SPACE_ROOT
  sdkwork-space/                          # shared module checkout (single source of truth)
    sdkwork-<module>/                     #   per-module repo checkout
      deployments/webserver/              #     nginx sidecars + snippets (webserver imports)
      apps/*-{pc,h5}/dist/<profile>/<envAlias>/   # Adaptive Web dist trees
  sdkwork-<module>/                       # per-module install root (one per deployable module)
    bundle/                               #   install bundle materialized by deploy.sh
      compose/docker-compose.bundle.yml
      env/<environment>.env
      deploy.sh / release.sh
      postgres/                           #   embedded deps init scripts (when bundled)
    backups/                              #   module backups (ops-backup.sh)
  deps/                                   # host-level shared dependency materials
    postgres-tls/                         #   shared postgres server cert/key
  drive/                                  # drive object/website cache (shared rw)
  archives/                               # workspace/static backup archives (ops scripts)
  logs/                                   # host-side operation logs (install/build/pack)
```

Rules:

- **Module namespacing.** Every per-module artifact lives under
  `/opt/deploy/sdkwork-<module>/`. Loose files at the deploy root
  (`pack-run.log`, `standalone-build.log`, …) are drift: operation scripts
  `MUST` write logs under `/opt/deploy/logs/<module>-<operation>.log` and
  package archives under `/opt/deploy/archives/`.
- **One checkout, all stacks.** `sdkwork-space/` is mounted read-only into
  every container that needs module sources or Adaptive Web dist trees; the
  webserver additionally mounts the checkout subtree read-write (clone/pull
  overlay, `SDKWORK_WEBSERVER_SPEC.md` §17). Modules `MUST NOT` vendor
  checkout copies into their images when the shared checkout is the declared
  source.
- **Bundle = single install unit.** `bundle/` is produced by packaging
  (`bin/apps-package.sh`) and materialized by install (`deploy.sh`); operators
  `MUST NOT` hand-edit files under `bundle/compose/` — install overwrites
  them from the release artifact (`ENVIRONMENT_SPEC.md` §5.1.0.2 operator
  contract governs browser dist sync, which is the one sanctioned
  post-install overlay).

### 9.2 Shared Surfaces (Bind-Mount, Never Per-Container Copies)

Multiple Docker processes on one host `MUST` consume these surfaces through
bind mounts of the same host path; duplicating them into images or per-process
volumes is a drift defect:

| Shared surface | Host path | Consumers | Mount mode |
| --- | --- | --- | --- |
| Module checkout (sidecars, topology, imports) | `/opt/deploy/sdkwork-space` | webserver (rw overlay), any module edge reading sidecars | ro (checkout subtree rw for webserver only) |
| Adaptive Web dist trees | `/opt/deploy/sdkwork-space/<module>/apps/*-{pc,h5}/dist/` | webserver data plane (via `@pc`/`@h5` roots) | ro |
| Deploy TLS/CA materials | `/opt/deploy/deps/postgres-tls/`, `<module>/bundle/compose/docker/ca/` | gateway + deps containers of that stack | ro |
| Drive objects / website cache | `/opt/deploy/drive` | webserver, drive-enabled modules | rw |
| Backup archives | `/opt/deploy/archives` | ops scripts | rw (host-side) |

Anti-patterns observed and prohibited:

- **Snapshot dist inside an image** (for example a module serving
  `/opt/sdkwork/<code>/portal/dist` baked at build time) while the same
  module's Adaptive Web dist lives in the shared checkout — the two diverge
  after the first host-side rebuild. A module image `MAY` embed a dist
  snapshot only as a **fallback root** declared in its catalog
  (`static_fallback_root` semantics, `SDKWORK_WEBSERVER_SPEC.md` §13.6);
  the active root `MUST` resolve through the shared checkout when present.
- **Per-container certificates** generated independently by each process:
  TLS/CA material `MUST` be provisioned once per stack at
  `<module>/bundle/compose/docker/ca/` (or the shared `deps/` path for
  host-wide dependencies like postgres) and bind-mounted read-only by every
  process that trusts it.
- **Per-container log/backup paths** that bypass the module install root.

### 9.3 Conformance Checks

- `doctor.sh` (module `bin/`) `MUST` verify: deploy root layout matches §9.1;
  declared shared surfaces resolve to host paths (not image-internal
  snapshots); TLS bind sources exist and are readable; no loose
  operation logs at the deploy root.
- `check-operations-conformance.mjs` `MAY` extend with a layout probe;
  failures cite this section.

