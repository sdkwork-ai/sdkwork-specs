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
