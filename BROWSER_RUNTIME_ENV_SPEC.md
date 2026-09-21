# Browser Runtime Env Specification

Status: normative. Browser-surface annex of `APP_RUNTIME_ENV_SPEC.md` (the
umbrella runtime-env standard for every application surface — PC web, H5 web,
admin web, desktop renderers, Flutter, mini-program). This annex owns how
every SDKWork browser surface (PC web, H5 web, admin web, future SPA surfaces)
publishes and consumes its runtime environment in development, and how
generated SDK clients resolve their API base URLs from it. Companion
authorities: `APP_RUNTIME_ENV_SPEC.md` (four-quadrant lifecycle matrix,
`browser-document` vs `transport` styles, shared Vite integration),
`ENVIRONMENT_SPEC.md` (per-environment domain binding, §6.3 runtime
`resolveBaseUrl`), `APP_RUNTIME_TOPOLOGY_SPEC.md` §8.2 (adaptive browser
delivery), `PNPM_SCRIPT_SPEC.md` §3 (dev commands), `SDK_SPEC.md` (generated
SDK transport).

Canonical implementations (do not fork):

- `tools/browser-runtime-env.mjs` — dev/build runtime document builders and
  the `SDKWORK_RUNTIME_ENV` bridge.
- `tools/app-base-url.mjs` — the node-side lifecycle-matrix resolver
  (`resolveBaseUrl({ deploymentProfile, environment, phase, surface })`) with
  multi-domain splitting; consumed by env materializers, build runners, and
  application contract libraries.
- `tools/browser-runtime-env-vite.mjs` — the shared Vite integration factory
  (serve-only middleware, build asset emit, script injection).
- `tools/browser-cloud-api-base.mjs` — cloud `api-<suffix>.<base-domain>`
  family derivation and page-host auto-selection.

Regression checkers:
`tools/check-browser-runtime-env-standard.mjs --root <repo>`,
`tools/check-base-url-resolution.mjs --workspace <workspace-root>`.

---

## 1. The four-quadrant contract

| | **dev** | **build / deployed** |
|---|---|---|
| **standalone** | One adaptive same-origin dev ingress; browser API bases are same-origin RELATIVE paths (`/app/v3/api`, `/backend/v3/api`, `/v1`); the ingress fans canonical API paths to the application ingress server-side. | Same-origin domain (e.g. `https://router.<base-domain>`); SDK base `/`. |
| **cloud** | Same ingress, SAME document shape; server-side fan-out → the locally started `sdkwork-api-cloud-gateway` (`SDKWORK_LOCAL_PLATFORM_API_GATEWAY_HTTP_URL`, ip:port); deploy domains never appear in the dev surface. | Cross-origin unified edge `https://api-<suffix>.<base-domain>`; page on the module web edge. |

Invariants independent of profile and environment:

1. The deployment profile changes only the server-side fan-out target — never
   the browser-visible document shape.
2. Loopback / port-bearing URLs are banned from every deployed artifact and
   from every dev browser document (dev loopback lives only in dev-process
   bindings and local-rehearsal profiles).
3. Process-only topology URL bindings (per-surface
   `*_APPLICATION_(PUBLIC|OPEN|BACKEND)_HTTP_URL`,
   `*_PLATFORM_API_GATEWAY_HTTP_URL`) never enter a browser document.

## 2. Dev runtime document (mandatory)

Every browser surface MUST serve a dev runtime document through a serve-only
middleware (Vite `configureServer`) — never as a static file in `public/`
(build artifacts would shadow it and poison dev with deploy-time values).

- PC/shell surfaces: `/runtime-env.js` assigning `window.__<APP>_ENV__` AND
  publishing the same object to the canonical global (§4).
- JSON-document surfaces: `/runtime-env.json` served from
  `buildBrowserDevRuntimeEnvDocument({ profileId: mode })`.
- `Cache-Control: no-store`; non-document requests pass through untouched.

Content contract (enforced by `assertBrowserDevRuntimeEnvDocument`):

1. `browserOriginMode: "same-origin"` (JSON shape).
2. Canonical same-origin bases, exact: `appApiBaseUrl: /app/v3/api`,
   `backendApiBaseUrl: /backend/v3/api`, `openApiBaseUrl: /v1` — or the
   surface-declared Vite key equivalents passed via
   `sameOriginBaseEntries`.
3. No process-only topology keys, no loopback absolutes, no protocol-relative
   URLs.
4. `profileId` (and derived `deploymentProfile` / `environment`) present and
   equal to the active vite mode (`<deploymentProfile>.<environment>`).

The canonical bases are FORCE-authored in dev (dev dotenv files are shared
with `vite build` and legitimately carry deploy-time domains; process env wins
over the file — `materialize-client-env.mjs` relies on exactly that
precedence).

## 3. Build runtime document (mandatory, deploy-time)

`public/runtime-env.json` is a build artifact materialized per
`<deploymentProfile>.<environment>` by the canonical build runner
(`tools/build-browser-client.mjs`) immediately before `vite build`:

- standalone → `browserOriginMode: same-origin`, every SDK base `/`;
- cloud → `browserOriginMode: cross-origin`, SDK bases = the registered
  `api-<suffix>.<base-domain>` family (`;`-joined).

It is git-ignored; deployed artifacts must carry domain values only.
`tools/align-browser-runtime-env.mjs` and
`tools/regress-browser-runtime-env.mjs` own the matrix.

## 4. The `SDKWORK_RUNTIME_ENV` global bridge (mandatory)

Shared SDK packages resolve deployment mode and base URLs from
`readRuntimeEnv`, whose browser channels (dynamic `import.meta.env` access,
`process.env`) are unreliable in bundled apps. Every browser surface MUST
publish its runtime document to:

```js
globalThis.SDKWORK_RUNTIME_ENV = Object.freeze({ ...document });
```

before the first SDK client call, including the deployment-mode aliases:

```js
SDKWORK_DEPLOYMENT_PROFILE / SDKWORK_DEPLOY_MODE /
VITE_SDKWORK_DEPLOYMENT_PROFILE / VITE_SDKWORK_DEPLOY_MODE
```

(= the active `deploymentProfile`). `tools/browser-runtime-env.mjs`
`buildBrowserRuntimeEnvGlobalBridge` / `buildBrowserRuntimeEnvGlobalScript`
build the bridge and the assignment statement.

### Why (case study: the 3910 regression)

`resolveBaseUrl` derived a RELATIVE candidate (`/app/v3/api`) against the
deployment-mode heuristic; the mode keys were invisible in the browser, the
mode fell back to its default `cloud`, and the dev page port was replaced by
`CLOUD_GATEWAY_DEV_PORT` (3910) — yielding
`http://127.0.0.1:3910/app/v3/api/...` from a correct same-origin document.
Two framework fixes landed in `@sdkwork/sdk-common`:

1. `readRuntimeEnv` reads `globalThis.SDKWORK_RUNTIME_ENV` first;
2. `resolveBaseUrl` returns RELATIVE candidates verbatim with reason
   `same-origin-relative` (a relative base IS the same-origin contract; host
   derivation never applies to it).

Both are covered by `sdkwork-sdk-commons` `tests/base-url-resolution.test.mjs`.

## 5. SDK integration rules (application composition roots)

1. Author explicit canonical bases in the dev runtime document (§2); never
   rely on SDK-internal relative fallbacks — those are convenience, not
   contract.
2. Never pass application surfaces through host/port derivation when a
   relative base expresses the contract (fixed in sdk-common, but applications
   must not re-introduce derivation).
3. Federated sibling edges (drive, agents, voice, ...) keep their DECLARED
   remote origins in cloud development; they are not gateway-attached and are
   exempt from the local-gateway rewrite. They must still pass the generic
   invariants (§2.3).
4. Generated SDK clients receive the base through the application composition
   root; generated packages must not hardcode app dev ports.
5. The `SDKWORK_API_DEV_PORT` / `SDKWORK_API_BASE_URL` overrides remain
   available for local gateway experimentation.

## 6. Vite integration standard

- Browser surfaces consume the shared factory
  `tools/browser-runtime-env-vite.mjs` `createBrowserRuntimeEnvVitePlugin`
  (serve-only middleware, build asset emit, script injection) instead of
  re-declaring the wiring per app; the document VALUES stay
  application-owned (authored through the app's contract library).
- Serve-only middleware in `configureServer`; build paths
  (`generateBundle` / static hosting) keep the deploy-time document.
- Dev resolution order: `{ ...dotenvFile, ...process.env }` (process wins),
  then force-author canonical bases, then re-run the same-origin alignment.
- Build resolution order: dotenv file (deploy-time authority) + the
  materialized `public/runtime-env.json` overrides.
- The runtime document middleware must not require the dev proxy environment
  at build time (server config is computed only for `serve`).
- The matrix decision behind every authored value (which base is
  same-origin relative, which is the local gateway, which is the build
  domain family) comes from `tools/app-base-url.mjs` `resolveBaseUrl`
  (`APP_RUNTIME_ENV_SPEC.md` §2/§4) — never re-derived in vite configs.

## 7. Compliance

- Applications: add the matrix assertions (document gate per mode per surface
  + plan assertions) to their topology regression test; run
  `tools/check-browser-runtime-env-standard.mjs --root <repo>` in `check`.
- Framework: `tools/browser-runtime-env.test.mjs` owns the contract unit
  tests; `sdkwork-sdk-commons` owns the resolver tests.
