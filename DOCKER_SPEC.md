# SDKWork Docker Image Packaging, Install, And Configuration Standard

- Version: 1.0
- Scope: normalized Docker lifecycle — image naming and tagging, Dockerfile/build rules, install bundle layout, per-environment install matrix, env-file contract, and domain/origin selection — for the two platform deployment units `sdkwork-webserver` and `sdkwork-api-cloud-gateway`, extended to every SDKWork module that ships a container
- Related: `DEPLOYMENT_SPEC.md` (§6 container install image, §6.1 external dependencies), `PACKAGING_SPEC.md` (image content), `ENVIRONMENT_SPEC.md` (§5.1 profile ids, §5.1.0.1 cloud API edge), `SDKWORK_WEBSERVER_SPEC.md` (public edge, §17 Docker space integration, §17.4 standalone-only), `APPLICATION_GATEWAY_SPEC.md`, `NGINX_SPEC.md` §0 (no stock nginx), `RUNTIME_DIRECTORY_SPEC.md`, `CONFIG_SPEC.md`, `PNPM_SCRIPT_SPEC.md` (§3 dev commands, §4.2 build family), `SOURCE_CONFIG_SPEC.md`, `MODULE_BIN_SPEC.md` (the standardized `bin/` entrypoints that drive image build and deployment)

## 0. Quick Reference

| Question | Answer |
| --- | --- |
| Who owns the public edge? | `sdkwork-webserver` only (`SDKWORK_WEBSERVER_SPEC.md` §0.1). It is **standalone-only** (§17.4) |
| Who owns the API? | `sdkwork-api-cloud-gateway` — the platform API gateway, never exposed publicly; reached only through the webserver reverse proxy (plus a loopback health port) |
| Which import set is active by default? | `cloud` — set at startup with `SDKWORK_WEBSERVER_IMPORT_PROFILE` (§1.1); switch live with `pnpm import:switch:cloud\|standalone` |
| How many images? | One environment-neutral image per application; every lifecycle environment uses the same tag |
| Lifecycle environments | `development`, `test`, `staging`, `demo`, `production` (`ENVIRONMENT_SPEC.md` §5.1) — all five are first-class Docker deploy targets |
| Dev vs build origins | `pnpm dev` binds local IP + port; per-environment **builds** bind domains — standalone same-origin, cloud `https://api-<suffix>.<base-domain>` |
| Install entrypoint | `deploy.sh --environment <env> [--replicas N] [--embedded] [--down|--ps|--logs]` |
| Dependencies | External host-system PostgreSQL `5432` / Redis `6379` by default (`DEPLOYMENT_SPEC.md` §6.1); embedded is an explicit opt-in |

## 1. Topology Contract (Normative)

```text
                    ┌────────────────────────────────────────────────┐
 Browser / App ───▶ │ sdkwork-webserver (standalone-only)            │
                    │  • public :80/:443 (or env import ports)       │
                    │  • serves own PC/H5 SPAs, same-origin `/`      │
                    │  • imports.d default set = cloud               │
                    │  • reverse-proxies /api* and module hosts      │
                    └───────────────┬────────────────────────────────┘
                                    │ upstream `gateway`
                                    ▼
                    ┌────────────────────────────────────────────────┐
                    │ sdkwork-api-cloud-gateway (API gateway)        │
                    │  • container :3900, host GATEWAY_HOST_PORT     │
                    │  • platform API, IAM, open-api edge routing    │
                    │  • external PostgreSQL/Redis (host system)     │
                    └────────────────────────────────────────────────┘
```

Rules:

- `sdkwork-webserver` is the **only** public reverse-proxy edge for SDKWork
  domains. Stock nginx/OpenResty and `/etc/nginx` `MUST NOT` serve public
  traffic (`NGINX_SPEC.md` §0).
- `sdkwork-webserver` is **standalone-only** for its own build, packaging, and
  runtime surface (`SDKWORK_WEBSERVER_SPEC.md` §17.4): same-origin `/` SDK API
  base URLs, `build:pc|h5:<env>` commands only, standalone release artifacts
  only. Its **import plane** still defaults to the `cloud` sidecar set for
  sibling modules — the two defaults are independent axes.
- `sdkwork-api-cloud-gateway` is the API gateway. Its container `MUST NOT`
  publish public `:80`/`:443`; its only host port is the health/proxy port
  (`GATEWAY_HOST_PORT` → container `:3900`), consumed by the webserver
  upstream and by local health checks.
- The gateway composition never starts the webserver and never installs nginx
  site mappings; the webserver composition never embeds the gateway unless an
  explicit attach/embedded profile says otherwise (separate compose projects).
- Both applications deploy as **independent** Docker compose projects that
  join one per-environment shared network.

### 1.1 Import-Mode Selection At Startup (Normative)

The webserver container starts with both sibling-module import sets
materialized and **one** activated. The active set is a deploy-time input —
configuring `cloud` imports every enabled sibling module's *cloud* sidecar;
configuring `standalone` imports the *standalone* sidecar. Full contract:
`SDKWORK_WEBSERVER_SPEC.md` §17.3/§17.3.1.

```sh
# Startup selection — declare in the lifecycle env file (default cloud):
SDKWORK_WEBSERVER_IMPORT_PROFILE=cloud

# Runtime switch without recreating the container (inside the webserver
# checkout / container), then restart the serve-imports data plane:
pnpm import:switch:cloud        # or: pnpm import:switch:standalone
pnpm import:status              # shows the active set
```

| Startup value | Imported per-module config | Edge semantics | Module PC/H5 assets |
| --- | --- | --- | --- |
| `cloud` (default) | `nginx.cloud.<environment>.conf` from each module checkout | Module hosts proxy the unified `api-*` edge through the `gateway` upstream | cloud dist trees (`dist/cloud/<alias>`) |
| `standalone` | `nginx.standalone.<environment>.conf` from each module checkout | Same-origin module edges (`/`) | standalone dist trees (`dist/standalone/<alias>`) |

Rules:

- The active import mode is **independent** of the webserver's own
  standalone-only build/packaging profile (§1): the webserver always serves
  its own SPAs same-origin; the knob only selects which sibling-module edge
  set activates.
- The entrypoint materializes **both** sets on every start; switching only
  re-copies the two active aggregator files
  (`imports.d/import.conf`, `imports.d/layout-imports.toml`) — module configs
  are never rebuilt or rewritten.
- A module missing the sidecar for the selected profile is skipped with a log
  entry; it never fails the whole data plane.
- `SDKWORK_WEBSERVER_IMPORT_PROFILE` `MUST` be declared in every shipped
  lifecycle env file even when equal to the `cloud` default (env-file parity,
  §3.3).
- This section covers only the **profile axis**. Each activated profile still
  imports sidecars for **every commissioned lifecycle environment** by default
  (all five) — a deployed `development` webserver routes `server-test.*` etc.
  too. The orthogonal **environment axis** and its
  `SDKWORK_WEBSERVER_IMPORT_ENVIRONMENTS` default are normative in
  `SDKWORK_WEBSERVER_SPEC.md` §17.3.2 / `ENVIRONMENT_SPEC.md` §6.2.2; the two
  axes compose independently (`import.conf.standalone` and
  `import.conf.cloud` each include all commissioned environments).

## 2. Image Standard (Normative)

### 2.1 Image Reference And Naming

```text
registry.sdkwork.com/apps/<docker-name>:<version>
```

| Application | Canonical image reference | Notes |
| --- | --- | --- |
| `sdkwork-webserver` | `registry.sdkwork.com/apps/sdkwork-webserver-standalone:${SDKWORK_WEBSERVER_IMAGE_TAG}` | standalone-only; the image name carries `standalone` explicitly |
| `sdkwork-api-cloud-gateway` | `registry.sdkwork.com/apps/sdkwork-api-cloud-gateway:${GATEWAY_IMAGE_TAG}` | the legacy un-prefixed form `registry.sdkwork.com/sdkwork-api-cloud-gateway:<version>` and the local build tag `sdkwork-api-cloud-gateway:local` are migration aliases; new env examples and documentation `MUST` use the canonical `/apps/` reference |

Rules:

- `<version>` is the application release version (SemVer, from
  `sdkwork.app.config.json` release metadata). Tag `MUST NOT` contain an
  environment segment (`:0.1.0-dev`, `:0.1.0-prod` are forbidden): one image,
  every environment — environment selection happens at deploy time
  (`DEPLOYMENT_SPEC.md` §6).
- The `latest` tag `MUST NOT` be referenced by any checked-in compose file,
  env example, or install bundle. Local development may build and reference
  `:local` tags, which never leave the build host and are never recorded in
  release evidence.
- Production deployments `SHOULD` pin the image digest in the bundle
  `image.env` release record.
- Image repositories are application-owned; multi-variant images of one
  application (for example the webserver standalone image) keep the variant
  suffix in the repository name, never in the tag.

### 2.2 Dockerfile And Build Rules

- Multi-stage builds; the runtime stage contains only the artifacts listed by
  `PACKAGING_SPEC.md` §3 (binaries, static roots, generated configs) and none
  of the forbidden content of §2 (build state, VCS metadata, secrets, dev
  dependencies, `.env*` material).
- `.dockerignore` `MUST` isolate the build context per `PACKAGING_SPEC.md` §4.
- The image `MUST NOT` bake any environment binding: no
  `ENV SDKWORK_..._ENVIRONMENT=...`, no domain, no database credential, no
  profile id. The entrypoint resolves them from deployment inputs at start.
- The image `MUST` declare a `HEALTHCHECK` (or the compose service declares
  the equivalent healthcheck) probing the application health endpoint.
- The runtime process `MUST` run as a non-root user.
- Image labels `MUST` record provenance:
  `org.opencontainers.image.version`, `.revision` (git sha), `.created`, and
  `.source` (repository URL).
- Build entrypoints:

| Application | Build command | Output |
| --- | --- | --- |
| `sdkwork-webserver` | `node scripts/webserver-release.mjs …` / repository container-image target | `registry.sdkwork.com/apps/sdkwork-webserver-standalone:<version>` |
| `sdkwork-api-cloud-gateway` | `pnpm build:container` (wraps `scripts/build-api-cloud-gateway-container.mjs`) | `registry.sdkwork.com/apps/sdkwork-api-cloud-gateway:<version>` |

- Building from a mounted checkout inside the webserver container
  (`pnpm build:container:module …`) follows `SDKWORK_WEBSERVER_SPEC.md` §17.1
  and `PNPM_SCRIPT_SPEC.md` §4.3.

## 3. Lifecycle Environment Matrix (Normative)

Five lifecycle environments are first-class Docker deploy targets. The
environment suffix in a hostname is the domain-registry abbreviation
(`APP_RUNTIME_TOPOLOGY_NAMING.md` §9.1); the canonical environment value stays
`development`/`test`/`staging`/`demo`/`production`.

### 3.1 Public Domains And Origins

| Environment | Webserver same-origin hosts (standalone role) | Cloud API edge (`gateway` upstream) | Gateway profile id |
| --- | --- | --- | --- |
| `development` | `server-dev.<base-domain>` | `https://api-dev.<base-domain>` | `standalone.development` |
| `test` | `server-test.<base-domain>` | `https://api-test.<base-domain>` | `standalone.test` |
| `staging` | `server-staging.<base-domain>` | `https://api-staging.<base-domain>` | `standalone.staging` |
| `demo` | `server-demo.<base-domain>` | `https://api-demo.<base-domain>` | `standalone.demo` |
| `production` | `server.<base-domain>` | `https://api.<base-domain>` | `standalone.production` |

Rules:

- `<base-domain>` spans the registered base-domain family (`sdkwork.com`,
  `birdcoder.cn`, …). `GATEWAY_ALLOWED_HOSTS` and `GATEWAY_CORS_ALLOWED_ORIGINS`
  enumerate the complete family per environment — serving a subset is the
  configuration-drift defect defined in `ENVIRONMENT_SPEC.md` §5.1.0.1.
- The webserver serves its own SPAs and the API on **one same-origin** host;
  the cloud edge origin is the value browser **builds** target, and the
  webserver imports module cloud sidecars that proxy `api-*` hosts to the
  `gateway` upstream.
- The `demo` environment is an independent demonstration tier: dedicated
  database (`sdkwork_ai_demo`), dedicated Redis key prefix, and
  demonstration-grade data only. It `MUST NOT` share persistence with
  development, test, staging, or production (`ENVIRONMENT_SPEC.md` §5).

### 3.2 Host Port Plan

Port keys have safe fallbacks; the checked-in env files are the operator
source of truth and `MUST` agree with this plan.

**sdkwork-webserver** (edge host ports; `DEPLOYMENT_SPEC.md` §6 port-key
contract extended with the demo row):

| Environment | Application port key (fallback) | Import HTTP port key (fallback) | HTTPS port key (fallback) |
| --- | --- | --- | --- |
| `development` | `SDKWORK_WEBSERVER_DEV_HOST_PORT` (`13800`) | `SDKWORK_WEBSERVER_DEV_IMPORT_HTTP_HOST_PORT` (`80`) | `SDKWORK_WEBSERVER_DEV_HTTPS_HOST_PORT` (`443`) |
| `test` | `SDKWORK_WEBSERVER_TEST_HOST_PORT` (`18888`) | `SDKWORK_WEBSERVER_TEST_IMPORT_HTTP_HOST_PORT` (`18898`) | `SDKWORK_WEBSERVER_TEST_HTTPS_HOST_PORT` (`28430`) |
| `staging` | `SDKWORK_WEBSERVER_STAGING_HOST_PORT` (`18081`) | `SDKWORK_WEBSERVER_STAGING_IMPORT_HTTP_HOST_PORT` (`18099`) | `SDKWORK_WEBSERVER_STAGING_HTTPS_HOST_PORT` (`38431`) |
| `demo` | `SDKWORK_WEBSERVER_DEMO_HOST_PORT` (`19080`) | `SDKWORK_WEBSERVER_DEMO_IMPORT_HTTP_HOST_PORT` (`19098`) | `SDKWORK_WEBSERVER_DEMO_HTTPS_HOST_PORT` (`38432`) |
| `production` | `SDKWORK_WEBSERVER_PROD_HOST_PORT` (`18080`) | `SDKWORK_WEBSERVER_PROD_IMPORT_HTTP_HOST_PORT` (`18098`) | `SDKWORK_WEBSERVER_PROD_HTTPS_HOST_PORT` (`38430`) |

**sdkwork-api-cloud-gateway**:

| Environment | Host port key (fallback) | Internal port |
| --- | --- | --- |
| `development` | `GATEWAY_DEV_HOST_PORT` / `GATEWAY_HOST_PORT` (`3910`) | `3900` |
| `test` | (`3911`) | `3900` |
| `staging` | (`3912`) | `3900` |
| `demo` | (`3914`) | `3900` |
| `production` | (`3913`) | `3900` |

Rules:

- Only one webserver instance per environment publishes the edge host ports;
  external load balancing uses the per-instance port stride
  (`GATEWAY_HOST_PORT + (index - 1) * 10` for gateway instances,
  `DEPLOYMENT_SPEC.md` §6).
- The webserver container listens on gateway port **3800** internally so
  sibling-module `server.standalone.toml` upstreams stay uniform across
  instances and hosts (`SDKWORK_WEBSERVER_SPEC.md` §17).
- Adding a lifecycle environment without extending the port-resolution matrix
  in the bundle deploy script is a specification violation (dry-run regression
  guard per `DEPLOYMENT_SPEC.md` §6).

### 3.3 Environment Identity And Persistence

Every lifecycle env file `MUST` declare (values are per environment, never
image-baked):

| Key group | Contract |
| --- | --- |
| Identity | `<APP>_ENVIRONMENT`, `<APP>_DEPLOYMENT_PROFILE`, `<APP>_PROFILE_ID` — e.g. `GATEWAY_ENVIRONMENT=demo`, `GATEWAY_PROFILE_ID=standalone.demo`; `SDKWORK_WEBSERVER_ENVIRONMENT`/`SDKWORK_WEBSERVER_DEPLOYMENT_PROFILE` for the webserver |
| Database | Host-system PostgreSQL: `host.docker.internal:5432`; per-environment database/schema/user (`sdkwork_ai_dev`, `sdkwork_ai_test`, `sdkwork_ai_staging`, `sdkwork_ai_demo`, `sdkwork_ai_prod`) with per-environment password (`DEPLOYMENT_SPEC.md` §6.1) |
| Redis | `host.docker.internal:6379` (canon; the gateway `docker/README` `6380` mention is drift and `MUST` be aligned), per-environment key prefix |
| Image | Image reference + tag resolved from the bundle `image.env`, not hardcoded in env examples (`DEPLOYMENT_SPEC.md` §6.1) |
| Domains | `GATEWAY_ALLOWED_HOSTS` / `GATEWAY_CORS_ALLOWED_ORIGINS` full base-domain family for the environment (§3.1) |
| Shared mounts | webserver: `SDKWORK_SPACE_*` and `SDKWORK_DRIVE_WEBSITE_CACHE_*` declared in **every** environment env file even when equal to image defaults (env-file parity rule, `DEPLOYMENT_SPEC.md` §6) |

## 4. Install Bundle Standard (Normative)

Each deployable ships one self-consistent install bundle per release — the
single artifact an operator downloads to install any environment with any
instance count.

> **Bundle executors are private.** `deploy.sh` (and a bundle-carried
> `release.sh` ledger wrapper) are implementation invoked by
> `bin/docker-deploy.sh` on the target host (`MODULE_BIN_SPEC.md` §4.2,
> single operator channel). They `MUST NOT` be exposed as operator
> entrypoints: no `package.json` wrapper and no documentation may present
> direct invocation (`bash deploy.sh …`, `bash release.sh …`) as an
> operator path.
>
> **Executor source (§2.2 of `MODULE_BIN_SPEC.md`).** The executors are
> authored flat in `bin/` as `docker-bundle-deploy.sh`,
> `docker-bundle-release.sh`, and (where the module needs it)
> `docker-bundle-prepare-envs.sh`. The module's bundle packager copies them
> into the bundle root under the artifact names this section fixes — that
> copy is the only place the source→artifact mapping is expressed.
> There is no `bin/bundle/` directory and no source-tree bundle: the install
> bundle is always a packaged `dist/docker-install/*` artifact, resolved by
> the `sdkwork_module_install_bundle_dir` hook (`MODULE_BIN_SPEC.md` §3), and
> the operator surface stays `bin/`.

### 4.1 Bundle Layout

```text
<app>-docker-install-<version>.bundle/
  deploy.sh                       # the single generic entrypoint (§4.2)
                                  #   source: bin/docker-bundle-deploy.sh
  release.sh                      # versioned release/rollback ledger wrapper
                                  #   source: bin/docker-bundle-release.sh
  image.env                       # IMAGE=<canonical reference>, IMAGE_DIGEST=… (release record)
  compose/
    docker-compose.yml            # base service definition (env-neutral)
    docker-compose.bundle.yml     # bundle binding: image, networks, volumes
    docker-compose.external.yml   # external host-system dependency bindings
    docker-compose.embedded.yml   # explicit opt-in embedded dependencies
  env/
    development.env / development.env.example
    test.env / test.env.example
    staging.env / staging.env.example
    demo.env / demo.env.example
    production.env / production.env.example
    <environment>.i<index>.env    # per-instance overlays (generated on demand)
  README.md                       # install steps, port plan, health checks
  sha256sums.txt                  # bundle integrity evidence
```

Rules:

- The bundle `MUST` carry the full five-environment env matrix. Shipping a
  subset (for example omitting `demo.env`) is a packaging defect.
- `image.env` is the only place the image tag lives; env examples `MUST NOT`
  hardcode it (`DEPLOYMENT_SPEC.md` §6.1).
- Bundle archives are `.tar.gz` with a `sha256` sidecar; packaging commands
  follow `PNPM_SCRIPT_SPEC.md` §4.4 / §8.

### 4.2 `deploy.sh` Contract

`deploy.sh --environment <env> [--replicas N] [--embedded] [--down|--ps|--logs|--dry-run]`:

- `MUST` fail before side effects when `<env>` is missing or outside the five
  canonical environments.
- `MUST` stay idempotent: re-running updates the existing stack.
- Default dependency mode is external host-system PostgreSQL/Redis (§6.1 of
  `DEPLOYMENT_SPEC.md`); `--embedded` is the explicit opt-in.
- Instance 1 starts first, completes database migration, and reaches health
  before instances 2..N start; the knowledgebase-rpc singleton (gateway
  bundle) provisions shared secrets material before instance 1.
- Every compose service `MUST` declare a `restart` policy, a healthcheck, and
  bounded `json-file` log rotation (reference `50m` / `3`).
- Every supported environment (all five, including `demo`) `MUST` pass a
  `--dry-run` regression run in CI.

## 5. Install Procedure (Per Environment)

Prerequisites (operator host, WSL Ubuntu 22.04 or Linux server):

1. Docker Engine + compose plugin.
2. Host-native PostgreSQL (`5432`) and Redis (`6379`) system services,
   provisioned per environment by the repository provisioning script
   (`setup-host-external-deps.sh` / `db:postgres:provision`) — identities
   derived from the checked-in env files, covering all five environments.
3. webserver only: `/opt/deploy` space root (clone target
   `/opt/deploy/sdkwork-space`) and `/opt/deploy/drive`
   (`SDKWORK_WEBSERVER_SPEC.md` §17.5); certificate inventory
   `/etc/sdkwork/certs/` for TLS tiers.

Procedure:

```sh
# 1. Load the image (from the bundle or the registry)
docker load -i <app>-<version>-image.tar.gz        # or: docker pull <canonical-ref>

# 2. Unpack the bundle and configure the environment
tar -xzf <app>-docker-install-<version>.bundle.tar.gz && cd <app>-*-bundle
$EDITOR env/<environment>.env                       # secrets, ports, domains

# 3. Deploy
bash deploy.sh --environment <environment> --replicas 1

# 4. Verify (webserver example — public edge, Host-header probe)
curl --noproxy '*' -H 'Host: api-dev.sdkwork.com' http://127.0.0.1/healthz
curl --noproxy '*' -H 'Host: server-demo.sdkwork.com' http://127.0.0.1:19098/healthz
# gateway example — loopback health port only
curl http://127.0.0.1:3914/healthz
```

Rules:

- The gateway health port is reachable from loopback and from the webserver
  container network only; it `MUST NOT` be published on a public interface.
- Verification `MUST` cover: every instance `healthy`, `/healthz` and
  `/readyz` via the public domain through the webserver, and the resolved
  database/Redis env of the deployed container equal to the env file
  (`DEPLOYMENT_SPEC.md` §6.1 regression checklist).
- Upgrade = deploy the new bundle/image with the same command (idempotent);
  rollback = re-deploy the previous bundle. Data volumes and host-system
  databases are never touched by the bundle scripts.

## 6. Dev Versus Build Origin Standard (Normative)

This section consolidates the origin rules that Docker install docs must
restate for operators (`PNPM_SCRIPT_SPEC.md` §3, §4.2; `ENVIRONMENT_SPEC.md`
§5.1.0.1).

### 6.1 Development: Local IP + Port

| Command | Binding |
| --- | --- |
| `pnpm dev` / `pnpm dev:standalone` | Application-owned local processes on local IP + port (e.g. webserver `http://127.0.0.1:3800`, gateway anchor `http://127.0.0.1:3900`) |
| `pnpm dev:cloud` | Developer-facing clients bound to the **local** platform gateway anchor (`SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL`, normally `http://127.0.0.1:3900`); never remote `api-dev.<base-domain>` |

Rules:

- Development servers bind local loopback/LAN addresses with explicit ports;
  dev surfaces `MUST NOT` hardcode deployed domains — domain-based access is a
  build/deploy concern, not a dev concern.
- The webserver container development deployment publishes host
  `:80`/`:443` from the webserver container itself (never a host nginx);
  `hosts` entries may map registered domains to `127.0.0.1`.

### 6.2 Builds: Per-Environment Domains

Browser builds target the environment's declared origins; the output lands in
`dist/<deploymentProfile>/<envAlias>/`:

| Build (PC example) | Profile | SDK API base URL in the artifact |
| --- | --- | --- |
| `build:pc:dev` | `standalone.development` | same-origin `/` |
| `build:pc:test` / `:staging` / `:prod` | `standalone.<env>` | same-origin `/` |
| `build:pc:dev:cloud` | `cloud.development` | `https://api-dev.<base-domain>` |
| `build:pc:test:cloud` / `:staging:cloud` / `:prod:cloud` | `cloud.<env>` | `https://api-test/-staging/…` / `https://api.<base-domain>` |
| `build:pc:demo` / `build:pc:demo:cloud` | `standalone.demo` / `cloud.demo` | same-origin `/` / `https://api-demo.<base-domain>` |

Rules:

- `standalone` artifacts are **same-origin**: every SDK API base URL is the
  canonical root `/` and `browserOriginMode = same-origin`
  (`ENVIRONMENT_SPEC.md` §5.1.0.1).
- `cloud` artifacts target the unified `api-*` edge per environment and are
  the CDN-publishable bundles; they never point at per-service hostnames.
- `sdkwork-webserver` is standalone-only: `build:pc|h5:<env>` only, no
  `:cloud` variants for its own surfaces (§17.4 of the webserver spec).
- The `demo` alias is supported by the canonical build runner
  (`tools/build-browser-client.mjs`); repositories that declare a `demo`
  environment in `etc/sdkwork.deployment.config.json` `MUST` expose the
  matching `build:<client>:demo[:cloud]` scripts
  (`check-browser-build-scripts.mjs` enforces it when declared).

## 7. Configuration And Secrets Standard

- Configuration source precedence follows `ENVIRONMENT_SPEC.md` §5.1.1 (four
  layers): reviewed source config in `etc/` → materialized env file in the
  bundle → local overlay → runtime/operator override.
- Secrets (database passwords, signing masters, session secrets) enter the
  container through env files excluded from the bundle or through secret
  files (`*_PASSWORD_FILE` / `/run/secrets/sdkwork/...`), never through image
  layers or tracked `.env` files (`PACKAGING_SPEC.md` §2.3).
- Runtime config lives at the FHS paths of
  `APPLICATION_DEPLOY_LAYOUT_SPEC.md` (e.g. gateway
  `/etc/sdkwork/api-gateway/config.toml`, data `/var/lib/sdkwork/api-gateway`);
  containers mount config and mutable state, never bake them.
- Every checked-in declaration of one connection fact is single-sourced: env
  file ↔ provisioning script ↔ compose file must agree (drift between two
  checked-in copies is a specification violation, `DEPLOYMENT_SPEC.md` §6.1).

## 8. Acceptance Checklist

- [ ] One environment-neutral image per application; no environment segment
      in any image tag; no `latest` in checked-in references.
- [ ] Image reference uses `registry.sdkwork.com/apps/<docker-name>:<version>`.
- [ ] Public edge is `sdkwork-webserver` only; the gateway publishes a
      loopback/proxy health port only.
- [ ] `SDKWORK_WEBSERVER_IMPORT_PROFILE` defaults to `cloud`; the webserver's
      own surfaces are standalone-only and same-origin.
- [ ] All **five** lifecycle environments (including `demo`) ship: env files,
      deploy-script port-resolution branches, provisioning coverage, and
      `--dry-run` CI regression.
- [ ] `demo` uses dedicated persistence (`sdkwork_ai_demo`, dedicated Redis
      key prefix) and the `api-demo.<base-domain>` family.
- [ ] External host-system PostgreSQL/Redis is the default dependency mode;
      `15432` appears nowhere.
- [ ] Bundle contains `deploy.sh`, `image.env`, full env matrix, compose
      files, README, and sha256 evidence; env examples carry no image tag.
- [ ] Every compose service declares restart policy, healthcheck, and bounded
      log rotation; instances have unique node identities and ports.
- [ ] Post-install verification passes the §6.1 regression checklist of
      `DEPLOYMENT_SPEC.md` (env parity with `.env.postgres`, host service
      probes, `/healthz`/`/readyz` via the public domain).
- [ ] Dev surfaces bind local IP + port; per-environment builds bind domains
      (standalone same-origin `/`, cloud `api-<suffix>.<base-domain>`).
