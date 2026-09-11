# CORS Origin Standard

- Version: 1.0
- Scope: browser/WebView origin allowlist authority, canonical origin-set derivation, registered console host patterns, per-profile carrier contract, and the single registry that makes a new base domain a one-file change
- Related: `SOURCE_CONFIG_SPEC.md` (§3 origin-set ownership), `WEB_FRAMEWORK_SPEC.md` (§12 secure defaults), `SECURITY_SPEC.md` (§4 CORS), `APP_RUNTIME_TOPOLOGY_NAMING.md` (§9 public host registry), `APP_RUNTIME_TOPOLOGY_SPEC.md` (`cloudPublicHosts`), `SDKWORK_WEBSERVER_SPEC.md`, `NGINX_SPEC.md`, `ENVIRONMENT_SPEC.md`, `DOCKER_SPEC.md`, `DEPLOYMENT_SPEC.md`, `TEST_SPEC.md`

## 0. Authority (Normative)

This file is the **single authority for the CORS origin set of every SDKWork
deployment profile**. It does not restate the security rationale
(`SECURITY_SPEC.md` §4), the runtime deny-by-default policy
(`WEB_FRAMEWORK_SPEC.md` §12), or the source-config ownership rule
(`SOURCE_CONFIG_SPEC.md` §3); it fixes **which origins, in which carrier, derived
from which registry**, so that:

- every independent module ships a complete, environment-correct allowlist in
  both `standalone` and `cloud` deployment profiles;
- a **new base domain is a one-line registry edit** followed by one aligner run,
  not a hand edit of hundreds of `.env` files;
- a new module or a new auxiliary console surface is derived from its own
  `specs/topology.spec.json`, never hand-enumerated.

Machine authorities:

```text
sdkwork-specs/tools/webserver/host-registry.mjs       # base domains, roles, suffixes
sdkwork-specs/tools/webserver/build-from-topology.mjs # surface → host resolution
sdkwork-specs/tools/cors/registry.mjs                 # origin-set derivation (this spec §4)
sdkwork-specs/tools/cors/env-file.mjs                 # surgical .env read/write
sdkwork-specs/tools/check-cors-standard.mjs           # gate (read-only)
sdkwork-specs/tools/align-cors-standard.mjs           # aligner (--check / --fix)
```

Repository carriers are **derived artifacts**. When a carrier disagrees with
this spec, the carrier is wrong; fix it by running the aligner, never by editing
the spec to match the carrier.

## 1. Definitions

| Term | Meaning |
| --- | --- |
| **Origin** | Exact scheme + host (+ optional port) that a browser or WebView shell sends in `Origin`. Never a path, query, fragment, wildcard, or userinfo. |
| **Base domain** | A registered product domain such as `sdkwork.com` or `birdcoder.cn`. |
| **Role host** | The single-label registry role of a surface, e.g. `im`, `code`, `server-app`, `api`. |
| **Console host** | `<role>[-<environment-suffix>].<base-domain>`, the public host where a browser surface is served. |
| **Browser-facing surface** | A `cloudPublicHosts` entry that terminates HTTP for browsers: `application.public-ingress`, `application.app-http`, `application.backend-http`, `application.admin-http`, `application.open-http`, `edge.device-ingress`. `platform.api-gateway` is a **target**, not an origin carrier: a module's own allowlist does not list it. |
| **Client origin** | A fixed, non-HTTP first-party shell origin (`app://…`, `tauri://localhost`, the Mini Program runtime). |
| **Loopback seed** | A development-only `http://127.0.0.1:<port>` / `http://localhost:<port>` origin derived from a browser-reachable development bind. |

## 2. Layered Authority

Three layers exist, in this order. Only the first is in source config.

| # | Layer | Carrier | Authority |
| --- | --- | --- | --- |
| 1 | Static exact allowlist | `SDKWORK_CORS_ALLOWED_ORIGINS` in `etc/topology/<profile>.<environment>.env`; the `[cors]` table of a gateway TOML | this spec §4 |
| 2 | Registered console host pattern | `SDKWORK_CORS_CONSOLE_HOST_{LABELS,SUFFIX,SCHEMES,BASE_DOMAINS}` | this spec §5 |
| 3 | Runtime web CORS policy | `sdkwork-web-store-sqlx` migration `004_web_cors_policy.sql` + admin API | `WEB_FRAMEWORK_SPEC.md` §12 |

Layer 3 is a runtime data-plane override for operators; it `MUST NOT` be used to
repair a source-config defect. A source profile that passes this spec must work
with an empty layer-3 store.

## 3. Registered Domains And Host Formula

Base domains, role labels, and environment suffixes are the registry in
`APP_RUNTIME_TOPOLOGY_NAMING.md` §9, implemented by
`tools/webserver/host-registry.mjs`:

```text
<console-host> = <role>[-<suffix>].<base-domain>
suffix: development=-dev  test=-test  staging=-staging  demo=-demo  production=(none)
```

Rules:

- The registered base-domain set is **closed**. An `http(s)` origin whose
  registrable domain is outside it is a defect, not an extension point. Use
  `SDKWORK_CORS_CONSOLE_HOST_BASE_DOMAINS` for a customer-managed substitution.
- Production hosts carry no environment suffix. An origin such as
  `api-prod.sdkwork.com` is never valid.
- A console host origin carries **no port**. Port-bearing console origins
  (`http://server.sdkwork.com:18080`) are legacy drift and are rejected.
- Prefix-style hosts (`test-im.sdkwork.com`) are retired.

## 4. Canonical Origin Set Of A Profile (Normative)

For a topology profile id `<deployment-profile>.<environment>`, the canonical
allowlist is, in this order:

```text
origins(profile) =
    loopbackSeeds(profile)                    # non-production only, ascending port
  ∪ hostOrigins(profile)                      # https for every browser-facing host
  ∪ (http for every browser-facing host)      # non-production only
  ∪ CLIENT_ORIGINS                            # always, production included
  ∪ preservedExtras                           # see §4.4
```

### 4.1 Host Block

The surface selector is **`cloudPublicHosts`**, not
`orchestration.profiles[].healthSurfaces`. A published public host is reachable
by browsers whether or not the profile also lists it as a health probe.

For every browser-facing surface declared in `cloudPublicHosts`, resolve its
hosts with `hostsForSurface(surface, environment)` and emit, per registered base
domain in registry order:

```text
https://<console-host>                     # every environment
http://<console-host>                      # non-production only
```

Production emits `https` only; a plain-HTTP production origin is a defect.

### 4.2 Loopback Seeds

Non-production profiles emit both forms of every **browser-reachable**
development bind, in ascending port order:

```text
http://127.0.0.1:<port>, http://localhost:<port>
```

The bind is collected from keys ending in a browser-reachable suffix:

| Suffix | Browser reachable | Origin? |
| --- | --- | --- |
| `_WEB_DEV_INGRESS_BIND` | Adaptive Web PC+H5 origin | **yes** |
| `_PC_DESKTOP_DEV_BIND` | Desktop WebView dev origin | **yes** |
| `_PC_INTERNAL_DEV_PORT`, `_H5_INTERNAL_DEV_PORT` | private Vite renderers | no |
| `_SERVER_BIND`, `_APPLICATION_PUBLIC_INGRESS_BIND` | process binds | no |

Promoting a process bind or an internal dev port into an allowlist is drift.
Production-like profiles (`test`, `staging`, `demo`, `production`) carry **no**
loopback origin.

### 4.3 Client Origins

Every lifecycle environment, production included, carries exactly these six
origins. Runtime assembly merges them (`WEB_FRAMEWORK_SPEC.md` §12); carrier
repetition is permitted and is the canonical materialisation.

```text
app://dsh
app://birdcoder
app://sdkwork
app://dtupay
tauri://localhost
https://servicewechat.com
```

### 4.4 Preserved Extras

An origin already present that is neither derived nor a client origin is
preserved **only when it is an exact `http(s)` console host of the registered
family**. This keeps a module that is also served from the platform gateway
(`https://api.<base-domain>`) working without hand maintenance.

Everything else is removed by the aligner:

- loopback origins that are not a declared browser bind of the profile — a
  stale development port is drift, not a local convenience;
- origins outside the registered base-domain family;
- port-bearing console hosts;
- loopback in a production-like profile;
- plain `http` console origins in production.

### 4.5 Order And Format

- Entries are comma-separated with no spaces and no trailing comma.
- One allowlist per file, on one line, in the profile's env file.
- Order is the §4 order; the aligner normalises it and the gate reports a
  non-canonical order as an error.
- Duplicate entries are defects.

## 5. Registered Console Host Pattern (Compact Mode)

An enumerated allowlist is O(surfaces × domains × 2) and must be re-materialised
for every new domain. The **registered console host pattern** collapses this to
four keys:

```text
SDKWORK_CORS_CONSOLE_HOST_LABELS=<role>,<role>,…
SDKWORK_CORS_CONSOLE_HOST_SUFFIX=<''|-dev|-test|-staging|-demo>
SDKWORK_CORS_CONSOLE_HOST_SCHEMES=<http,https|https>
SDKWORK_CORS_CONSOLE_HOST_BASE_DOMAINS=<base>,…      # optional; defaults to §3
```

An `Origin` matches when it is exactly
`<scheme>://<label><suffix>.<registered base domain>` with a single DNS label,
no port, no userinfo, no path/query/fragment, and a registered base domain.
Matching stays exact: the pattern is not a subdomain wildcard.

Rules:

- The pattern is an **addition** to the exact allowlist, never a replacement for
  the §4 host block: the exact list keeps working when LABELS is unset.
- Setting `LABELS` `MUST` be accompanied by `SUFFIX` and `SCHEMES`; a partial set
  is fail-closed at startup.
- `production` `MUST` use `SCHEMES=https` and an empty suffix.
- The pattern is the right mechanism for **any process that must accept the
  whole fleet's console origins**: the platform gateway, a host that embeds
  dependency routers, and the web server's module-gateway attachment. It is not
  required on a module that only serves its own surfaces.
- Label lists are derived from `REGISTERED_APP_ROLE_HOSTS` plus the auxiliary
  surface labels (`-app`, `-admin`, `-open`) and any explicitly registered label.
  Duplicating a derived label by hand is drift.

## 6. Carrier Contract Per Profile

Every deployable root that declares a browser-facing surface in
`cloudPublicHosts` `MUST` materialise §4 in **every** profile of its supported
matrix. `standalone.*` and `cloud.*` are separate profiles of the same matrix
(`SOURCE_CONFIG_SPEC.md` §4) and `MUST` both be complete:

```text
<module-root>/etc/topology/standalone.<environment>.env   # SDKWORK_CORS_ALLOWED_ORIGINS
<module-root>/etc/topology/cloud.<environment>.env        # SDKWORK_CORS_ALLOWED_ORIGINS
```

| Deployment topology | Extra requirement |
| --- | --- |
| `standalone` | Same-origin UI and API. The allowlist still enumerates every public host: the Adaptive Web surface, the app surface, and the backend/admin surface are distinct hosts. |
| `cloud` | Application and API origins are explicit; the module's own surfaces stay enumerated exactly as in `standalone`. |
| Embedded host (any process that mounts dependency routers) | Project the selected environment and origin set to the shared `SDKWORK_ENVIRONMENT` / `SDKWORK_CORS_ALLOWED_ORIGINS` keys (`SOURCE_CONFIG_SPEC.md` §3), and add §5 when it must accept the whole fleet. |

Carriers without a gate are a latent failure: the drift is invisible until a
browser blocks a preflight. Every repository that materialises an allowlist
therefore owns a gate for its own carriers, wired per §8.1.

Process-host and deploy-bundle carriers:

| Carrier | Keys | Notes |
| --- | --- | --- |
| `sdkwork-api-cloud-gateway/docker/env/<environment>.env` | `GATEWAY_CORS_ALLOWED_ORIGINS`, `GATEWAY_CORS_CONSOLE_HOST_*` | Host-side `GATEWAY_*` prefix mapped by compose interpolation; the console pattern is the primary mechanism. |
| `sdkwork-webserver/deployments/docker/env/<environment>.env` | `SDKWORK_CORS_ALLOWED_ORIGINS`, `SDKWORK_CORS_CONSOLE_HOST_*`, `SDKWORK_MODULE_API_GATEWAY_CORS_ALLOWED_ORIGINS`, `SDKWORK_MODULE_API_GATEWAY_CORS_CONSOLE_HOST_*` | Injected as an env file; the `MODULE_API_GATEWAY_*` keys are what the embedded gateway router consumes. Keep both console-host key families in sync. |
| Gateway TOML `[cors]` | `allowAnyOrigin`, `allowedOrigins` | Must stay consistent with the env carrier of the same profile; checked by `tools/check-source-config-standard.mjs`. |
| Deploy bundle `bundle/env/<environment>.env` | as parent repository | Incrementally unpacked without `--delete`; a deploy never rewrites a deployed value. |

Naming rules:

- The shared key is `SDKWORK_CORS_ALLOWED_ORIGINS`. No other shared allowlist
  key exists.
- Application-scoped `SDKWORK_<APPLICATION>_ALLOWED_ORIGINS` keys are **retired**.
  They duplicated the shared key and drifted from it; the aligner deletes them.
- A profile whose `cloudPublicHosts` declares no browser-facing surface carries
  no allowlist. Adding one is permitted only when it is structurally valid.

## 7. Procedures

### 7.1 Add A Base Domain

1. Add the domain to the registry base-domain set
   (`tools/webserver/host-registry.mjs`).
2. Add the certificate declaration for the domain
   (`NGINX_SPEC.md` §3, `server.common.toml`).
3. Materialise the derived carriers. Host lists (`httpHosts`), nginx
   `server_name` sets and webserver TOML are materialised by the webserver
   aligner; the CORS allowlist is materialised from those hosts. Run both, in
   this order:
   ```sh
   node tools/webserver/align-webserver-workspace.mjs --workspace ..   # owns httpHosts / server_name / TOML
   node tools/align-cors-standard.mjs --workspace .. --fix             # owns SDKWORK_CORS_ALLOWED_ORIGINS
   node tools/check-cors-standard.mjs --workspace ..
   node --test tools/cors/registry.test.mjs
   ```
   From inside a single repository the same two tools take `--root .` and audit
   only that repository's carriers (`§8.1`).
4. Run each repository's `pnpm verify`.

Nothing else is edited by hand. Every carrier gains the new domain's origin from
the registry, and the console host pattern picks it up automatically because
`BASE_DOMAINS` defaults to the registry.

### 7.2 Add A Module Or An Auxiliary Surface

1. Declare the public host in the module's `specs/topology.spec.json`
   `cloudPublicHosts` (`APP_RUNTIME_TOPOLOGY_NAMING.md` §9.1).
2. If it introduces a new role label, register it in the §9.2 registry so the
   fleet-wide console pattern can accept it.
3. Run §7.1 step 3.

### 7.3 Add An Environment

1. Add the environment and its suffix to the registry (`LIFECYCLE_ENVIRONMENTS`,
   `environmentSuffix`).
2. Add the profile id to `SOURCE_CONFIG_SPEC.md` §4 and the module's matrix.
3. Run §7.1 step 3. Production-like treatment follows the suffix: an environment
   without a suffix is production-like and carries no loopback origin.

### 7.4 Change A Console Surface Role

Edit the role mapping in the §9.2 registry, then run §7.1 step 3. Never
hand-edit a label list in a carrier; the label list is derived.

## 8. Gates

| Gate | Command | Enforces |
| --- | --- | --- |
| Workspace origin set | `node tools/check-cors-standard.mjs --workspace <workspace-root>` | §3, §4, §5, §6, §8.1: every required profile is present, exact, environment-correct, complete, deduplicated, and canonically ordered; console key sets are complete per environment; retired keys are gone; every repository that can host the gate hosts it. |
| Repository origin set | `node tools/check-cors-standard.mjs --root .` | The same carrier invariants for one application root, without scanning sibling checkouts. Fails closed when the directory carries no allowlist at all. |
| Source config | `node tools/check-source-config-standard.mjs --workspace <root>` | `[cors]` TOML invariants. |
| Alignment | `node tools/align-cors-standard.mjs --workspace <root> --check` or `--root . --check` | Dry run; exits non-zero when a carrier is not canonical. |
| Unit | `node --test tools/cors/registry.test.mjs` | §4 derivation, §4.2/§4.3.1 seeds, and §4.4 invalidation rules. |

### 8.1 Gate Wiring (Normative)

1. A repository that materialises an allowlist `MUST` declare

   ```json
   "check:cors-standard": "node ../sdkwork-specs/tools/check-cors-standard.mjs --root ."
   ```

2. It `MUST` reference `check:cors-standard` from the aggregate that `pnpm verify`
   runs, in this preference order: `_sdkwork:verify`, then `verify`, then `check`.
   The aggregate is the merge-ready gate; a repository that never runs the step
   cannot detect carrier drift.
3. The workspace gate fails when a repository with carriers declares the script
   without referencing it, or has an aggregate but no script. A repository with
   none of `_sdkwork:verify`, `verify`, `check` is reported as a **warning**: the
   missing aggregate is a `PNPM_SCRIPT_SPEC.md` gap owned by that specification,
   and the workspace gate still audits its carriers.
4. The workspace root `@sdkwork/workspace-root` runs both: `pnpm check:all`
   includes `check:cors-standard` and `test:cors`. Adding a registered base
   domain is therefore proven complete by §7.1 step 3 alone.

## 9. Prohibited

- Wildcard (`*`), regex, or suffix-matched origins; echoing an arbitrary
  `Origin`; `Access-Control-Allow-Origin: *` with credentials.
- Path, query, fragment, port, or userinfo in an origin.
- Loopback or internal dev-port origins in `test`/`staging`/`demo`/`production`.
- Plain `http` console origins in production.
- Hand-enumerated console label lists in carriers instead of §5.
- Application-scoped `*_ALLOWED_ORIGINS` keys.
- Second CORS middleware in a process host that already mounts
  `WebFrameworkLayer` (`WEB_FRAMEWORK_SPEC.md` §12).
- Fixing a 403 by suppressing `Origin`, proxying through an ungoverned endpoint,
  or enabling `*`.

## 10. Acceptance Checklist

- [ ] `tools/webserver/host-registry.mjs` is the only place a base domain or a
      role label is declared.
- [ ] Every profile with a browser-facing surface carries a non-empty,
      deduplicated, canonically ordered `SDKWORK_CORS_ALLOWED_ORIGINS`.
- [ ] `standalone.*` and `cloud.*` profiles of the same module are both complete.
- [ ] Production-like profiles carry no loopback origin and no plain-HTTP host.
- [ ] All six client origins are present in every lifecycle environment.
- [ ] Every console host origin has a registered base domain and no port.
- [ ] Retired application-scoped allowlist keys are absent.
- [ ] Every repository with carriers declares `check:cors-standard` and
      references it from `_sdkwork:verify`, `verify`, or `check` (§8.1).
- [ ] The platform gateway and any fleet-wide acceptor use §5 with complete key
      sets and production `SCHEMES=https`.
- [ ] `check-cors-standard` and `check-source-config-standard` pass for the
      workspace.
- [ ] The workspace root `pnpm check:all` runs `check:cors-standard` and
      `test:cors`.
- [ ] Adding a base domain requires only §7.1.
