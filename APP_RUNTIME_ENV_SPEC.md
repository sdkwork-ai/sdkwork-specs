# App Runtime Env Specification

Status: normative. Authority over how EVERY SDKWork application surface —
PC web, H5 web, admin web, desktop renderers, Flutter, mini-program, and
native clients — resolves and materializes its SDK base URLs and runtime
environment across the two deployment profiles (`standalone`, `cloud`) and the
five lifecycle environments (`development`, `test`, `staging`, `demo`,
`production`). This is the umbrella standard; `BROWSER_RUNTIME_ENV_SPEC.md`
remains the browser-surface annex (document shape, `SDKWORK_RUNTIME_ENV`
bridge, Vite wiring details).

Canonical implementations (do not fork):

- Browser/runtime resolver: `resolveBaseUrl` (+ `resolveBaseUrlWithAlignProtocol`)
  from `@sdkwork/sdk-common` — `ENVIRONMENT_SPEC.md` §6.3.
- Build/dev tooling resolver: `tools/app-base-url.mjs` in this repository —
  the node-side lifecycle matrix with standalone/cloud + environment
  parameters and multi-domain splitting.
- Dev/build runtime document builders: `tools/browser-runtime-env.mjs`.
- Shared Vite integration: `tools/browser-runtime-env-vite.mjs`.
- Cloud multi-domain family derivation: `tools/browser-cloud-api-base.mjs`.

Regression gates: `tools/app-base-url.test.mjs`,
`tools/browser-runtime-env.test.mjs`,
`tools/browser-runtime-env-vite.test.mjs`,
`tools/check-browser-runtime-env-standard.mjs --root <repo>`,
`tools/check-base-url-resolution.mjs --workspace <workspace-root>`.

---

## 1. Standalone gateway integration (all applications)

Every application module owns a standalone gateway —
`sdkwork-api-<application-code>-standalone-gateway` (or the module's composed
equivalent, e.g. an embedded edge runtime) — that integrates and starts the
module's composed API surfaces (`API_ASSEMBLY_SPEC.md` §6.1). In the
`standalone` deployment profile the application dev runner starts that gateway
and every browser surface reaches it through ONE same-origin dev ingress; no
surface ever points at a sibling module's dev port
(`ENVIRONMENT_SPEC.md` §6.2).

In the `cloud` deployment profile no local standalone gateway runs: browser
and client surfaces resolve gateway-attached surfaces against the platform
`api-<suffix>.<base-domain>` family (build) or the locally started
`sdkwork-api-cloud-gateway` (dev), while federated sibling edges keep their
declared remote origins.

## 2. The four-quadrant lifecycle matrix (all application surfaces)

Restated from `ENVIRONMENT_SPEC.md` §6.2.1 as the single normative table.
`tools/app-base-url.mjs` `resolveBaseUrl` implements exactly this matrix;
application repositories MUST consume it (directly or through their contract
library) instead of re-deriving profile/phase decisions.

| | **dev** (`pnpm dev`, `dev:standalone`, `dev:cloud`) | **build** (per-environment artifact) |
|---|---|---|
| **standalone** | `browser-document`: same-origin RELATIVE `/` — the page origin (dev ingress ip+port, e.g. `http://127.0.0.1:4734`) IS the API origin; the ingress fans canonical API paths server-side to the module standalone gateway. `transport`: the dev ingress origin itself. | `browser-document`: same-origin relative `/`. `transport`: the serving application edge domain (`https://im-dev.sdkwork.com` — domain, no port, HTTPS in non-dev). |
| **cloud** | `browser-document`: same-origin RELATIVE `/` (same document shape as standalone — the dev ingress fronts every gateway-attached surface and fans out server-side to the locally started `sdkwork-api-cloud-gateway`). `transport`: `SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL` (ip+port, e.g. `http://127.0.0.1:3900`) — domain edges are never contacted from a dev surface. | `browser-document` and `transport`: cross-origin unified `api-<suffix>.<base-domain>` family, primary origin first, full `;`-joined family materialized (§5). |

Selection reasons returned by `resolveBaseUrl` (the sanctioned matrix
telemetry): `standalone-dev-same-origin`, `standalone-build-same-origin`,
`standalone-dev-page-origin`, `standalone-build-page-origin`,
`cloud-dev-same-origin-document`, `cloud-dev-local-gateway`,
`cloud-build-domain-family`.

Invariants independent of profile, environment, and surface family:

1. Dev surfaces use `ip+port` origins only; built artifacts use domains only —
   never IPs or ports (`ENVIRONMENT_SPEC.md` §6.2.1).
2. The deployment profile changes the server-side fan-out target and the
   build-time domain family — never the dev browser-document shape.
3. Process-only topology bindings (`*_APPLICATION_(PUBLIC|OPEN|BACKEND)_HTTP_URL`,
   `*_PLATFORM_API_GATEWAY_HTTP_URL`, local gateway overrides) never enter a
   client-visible runtime document.
4. Deployed transport origins are HTTPS domains without ports in every
   non-development environment (fail closed, `tools/app-base-url.mjs`).

## 3. Surface styles (`browser-document` vs `transport`)

One matrix serves every application family through two surface styles:

- `browser-document` (default): what a web surface materializes into its
  runtime document / Vite bag. Standalone and dev cloud pin relative `/`
  bases; the serving origin is resolved by the browser at request time.
  Cloud build documents carry the `;`-joined multi-domain family so shared
  SDK resolvers can auto-select the registered gateway matching the page host.
- `transport`: the absolute origin a client WITHOUT a same-origin proxy must
  call — desktop renderers, Flutter (`env/sdkwork.<profileId>.json`),
  mini-program (`runtime-env.<profileId>.json`), native clients, and the
  dev-server proxy upstream itself. Standalone transport is the application
  edge domain (same-origin by deployment); cloud dev transport is the local
  platform gateway ip+port; cloud build transport is the multi-domain family.

Materialization formats per family are owned by
`tools/materialize-client-env.mjs` (vite dotenv, flutter JSON, mini-program
JSON); `tools/build-browser-client.mjs` owns the browser runtime document.

## 4. `resolveBaseUrl` — one name, two layers

- **Runtime (in the client):** `resolveBaseUrl` /
  `resolveBaseUrlWithAlignProtocol` from `@sdkwork/sdk-common` selects among
  configured candidates using the page host, environment label, brand, and
  deployment mode, applies the §6.3 page-protocol adaptation, and passes
  relative candidates through verbatim (`same-origin-relative`). Contract:
  `ENVIRONMENT_SPEC.md` §6.3.
- **Tooling (build/dev process):** `resolveBaseUrl({ deploymentProfile,
  environment, phase, surface, ... })` from `tools/app-base-url.mjs` decides
  what base URLs a surface SHOULD materialize for a matrix point, including
  the fail-closed cloud dev (local gateway required) and standalone transport
  (application edge required) branches. The framework's own materializers
  route their family derivation and materialization through it
  (`tools/materialize-client-env.mjs` via `baseUrlsMaterializationValue`;
  cloud build documents carry the full `;`-joined family in both surfaces);
  the convergence gates in `tools/app-base-url.test.mjs` lock the dev
  document builder and the cloud family derivation to the same matrix.

Multi-domain configuration splitting:

- `splitBaseUrls` / `serializeBaseUrls` split and re-serialize the
  `;`/`,`-joined candidate lists.
- `selectBaseUrlForPageHost(baseUrls, { pageHost, environment,
  deploymentProfile })` is the auto-adapting selection: standalone resolves
  the page origin itself; cloud maps `im-dev.sdkwork.com` onto
  `https://api-dev.sdkwork.com` (exact environment match → same base-domain
  match → `api-<suffix>.<base-domain>` derivation → first candidate).
- Runtime-side selection is the same contract implemented by
  `@sdkwork/sdk-common` `resolveBaseUrl` + `resolveCloudApiOriginForHost`.

Application rules (restating `ENVIRONMENT_SPEC.md` §6.2.1.3 and §6.3):

1. Factory modules MUST NOT hand-roll mode parsing, candidate splitting,
   environment-suffix parsing, or `im.`→`api.` host rewriting.
2. UI/feature packages MUST NOT call resolvers directly; the application
   composition root resolves origins and passes them downward.
3. Generated SDK clients receive their base through the composition root.

## 5. Cloud multi-domain family (build)

A cloud build materializes the registered `api-<suffix>.<base-domain>` family
for its environment — one entry per commissioned base domain
(`etc/sdkwork.deployment.config.json` `cloudApiBaseUrl`, derived from
`specs/topology.spec.json` through `tools/browser-cloud-api-base.mjs`).
Rules:

- The primary origin (first entry) is the default SDK base.
- The full family is materialized (`;`-joined) into runtime documents and
  validated against the environment (`api-dev.` for development, `api.` for
  production, ...); entries must not repeat a base domain.
- A page served on a module domain of one base domain auto-selects the
  gateway of the SAME base domain (brand isolation), never another brand's
  gateway.

## 6. Shared Vite integration standard

Browser surfaces consume `tools/browser-runtime-env-vite.mjs`
`createBrowserRuntimeEnvVitePlugin` instead of re-declaring the wiring:

- Serve-only middleware for the dev document (`/runtime-env.json` document
  shape or `/runtime-env.js` global-bag shape), `Cache-Control: no-store`,
  exact-path match with query strings tolerated, everything else untouched.
- Optional build asset emit so statically hosted artifacts carry the
  deploy-time document; a checked-in `public/runtime-env.json` remains
  forbidden (it shadows the dev middleware with stale deploy values).
- Optional post-order `transformIndexHtml` for `/runtime-env.js` injection.
- Dev resolution order stays `{ ...dotenvFile, ...process.env }` (process
  wins) with canonical bases force-authored by the application contract
  library (`tools/browser-runtime-env.mjs` `authorSameOriginSdkBaseUrls`).

The Vite `--mode` profile parsing itself comes from
`tools/vite-runtime-profile.mjs`; build out directories from
`tools/browser-dist-layout.mjs`. None of these are re-declared per app.

## 7. Compliance

- Application repositories: run
  `tools/check-browser-runtime-env-standard.mjs --root <repo>` (dev document
  wiring, canonical tool consumption, no checked-in runtime document) and
  `tools/check-base-url-resolution.mjs --workspace <workspace-root>` in
  `check`; keep the mode-matrix assertions in the topology regression test.
- Workspace rollout tracking: `tools/check-app-runtime-env-workspace.mjs
  --workspace <workspace-root>` classifies every browser-surface repository
  (`ok` / `environment`-blocked / `code-gap`); `--report` exits 0 and prints
  the matrix during the install-gated adoption campaign, the default exits 1
  on any code gap.
- Framework: `tools/app-base-url.test.mjs` owns the matrix unit tests,
  including convergence checks that lock the dev document builder and the
  cloud family derivation to the same matrix (`pnpm test:app-runtime-env`).
