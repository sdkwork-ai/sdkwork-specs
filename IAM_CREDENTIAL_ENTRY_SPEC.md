# SDKWork IAM Credential Entry Integration Standard

- Version: 1.2
- Scope: login, registration, password reset, OAuth session creation, QR/device authorization bootstrap transport, manifest identity, lifecycle-aware bootstrap env, and Vite development handoff
- Related: `IAM_SPEC.md`, `IAM_APPLICATION_BOOTSTRAP_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `API_SPEC.md`, `SDK_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `ENVIRONMENT_SPEC.md`

## 1. Purpose

IAM owns credential-entry business handlers and SDK contracts. Host applications must not duplicate bootstrap token injection, client wrapping, or manifest identity mapping in local commons packages.

## 2. Canonical Runtime Package

```text
@sdkwork/iam-credential-entry
```

Rules:

- Host applications `MUST` use this package for `wrapCredentialEntryClient`, `prepareCredentialEntryTokens`, and manifest identity helpers.
- Flutter mobile applications `MUST` use `sdkwork_iam_flutter_mobile_core` credential-entry bootstrap helpers and a dedicated credential-entry IAM SDK client. They `MUST NOT` send login, registration, password reset, OAuth session, authorization URL, or IAM runtime policy operations through an anonymous client.
- Application repos `MUST NOT` copy credential-entry wrapper logic into local `*-commons` packages.
- Vite renderers `MUST` use `@sdkwork/iam-credential-entry/vite`. Source-linked multi-repository workspaces `MAY` resolve that declared package dependency to its canonical `sdkwork-iam-credential-entry/src/vite.ts` source entry while package links are unavailable; applications `MUST NOT` copy its HTML serialization, canonical global assignment, or lifecycle gating.
- Node dev/test orchestrators `MUST` use `sdkwork-iam/scripts/dev/create-dev-bootstrap-access-token-env.mjs`; applications `MUST NOT` copy JWT fixture generation, manifest lookup, or env merge helpers.
- The package `MUST` remain transport-only; IAM session persistence stays in `@sdkwork/iam-runtime`.

## 3. Auth Mode: `credential-entry-bootstrap`

OpenAPI operations backed by `HttpRoute::credential_entry_bootstrap` (or the migration alias `credential_entry_public`) `MUST` declare:

```yaml
x-sdkwork-auth-mode: credential-entry-bootstrap
x-sdkwork-forbid-credential-headers: true
security:
  - AccessToken: []
```

SDK transport rules:

- Generated TypeScript clients `MUST` call transport with `credentialEntryBootstrap: true`.
- Transport `MUST` inject bootstrap `Access-Token` from TokenManager.
- Transport `MUST NOT` inject `Authorization`, API keys, or SDKWork context projection headers.
- The credential-entry wrapper `MUST` fail before network dispatch when no bootstrap access token is available. It `MUST NOT` clear session credentials and then send an unauthenticated request that can only fail as server `40101`.
- Pure anonymous browser QR operations (`deviceAuthorizations.create`, `deviceAuthorizations.retrieve`, and `deviceAuthorizations.sessionExchanges.create`) remain `x-sdkwork-auth-mode: anonymous` with `skipAuth: true`. QR scan and password-completion operations remain credential-entry unless the owning IAM route contract explicitly selects another protected profile.

Gateway rules:

- `credential_entry_public` is a migration helper name only. New route contracts use first-class `RouteAuth::CredentialEntryBootstrap`; the helper must construct that profile and must not encode it as `Public + flag`.
- Credential-entry routes `MUST` require bootstrap `Access-Token` JWT for tenant isolation.
- The Web Framework credential-contamination guard `MUST` reject `Authorization`, refresh, API-key, OAuth, ingress/agent, and client-projected context credentials before handlers run. Handlers do not parse or reject headers themselves.

## 4. Configuration Layering

Effective credential-entry identity resolves in this order:

1. Platform defaults from SDKWork specs
2. Surface `sdkwork.app.config.json` (`backend.appId`, `backend.tenantId`, `backend.organizationId`, permission scope)
3. Optional module/composition overrides documented in local `specs/`
4. Environment profile secrets and generated bootstrap artifacts

Rules:

- `SDKWORK_ACCESS_TOKEN` is a generated private bootstrap artifact, not hand-authored identity.
- Credential-entry token generation `MUST` fail closed when the selected surface manifest omits `backend.appId`; it `MUST NOT` fall back to `app.key` or infer an id from architecture metadata.
- Browser runtimes `MUST NOT` expose bootstrap tokens through `VITE_*` or `PORTAL_PUBLIC_*`.
- Development Vite serve processes `MAY` inject a private bootstrap token only through `createSdkworkCredentialEntryBootstrapVitePlugin`, which assigns `globalThis.__SDKWORK_CREDENTIAL_ENTRY_BOOTSTRAP_ACCESS_TOKEN__` before application modules execute.
- Vite `define` replacement for `process.env.SDKWORK_ACCESS_TOKEN` is not a valid credential-entry handoff. Vite 6 client dev transforms do not guarantee that ordinary define replacement reaches linked source packages.
- Test Vite serve processes `MAY` inject only when the isolated test runner explicitly sets both token-generation and plugin-injection opt-ins.
- Staging and production renderers `MUST NOT` inject bootstrap tokens into HTML, JavaScript bundles, `/runtime-env.js`, or equivalent browser artifacts.
- Production browser clients obtain only a short-lived bootstrap JWT through an approved IAM/application bootstrap exchange or trusted native host channel. The exchange derives app/tenant/audience from server-owned deployment binding, never client tenant selectors; applies origin policy, rate limits, `Cache-Control: no-store`, short expiry, and credential-entry-only purpose; and returns no user session credential.
- A production browser credential-entry runtime `MUST` fail bootstrap before rendering an actionable login form when neither an approved short-lived exchange nor a trusted host channel is configured.

## 5. Lifecycle Bootstrap

Application repositories `MUST` resolve bootstrap access tokens through the shared IAM workflow. They `MUST NOT` fork signing, fixture JWT, manifest identity, private env-file parsing, or HTML injection logic per application.

### 5.1 Vite Serve Call Contract (normative)

Stating "use the shared workflow" is not sufficient on its own: the plugin has options, and an
option that is silently optional in TypeScript can still be *semantically required*. The
following contract is therefore normative. History: before 2026-09-20 this section described
only the principle, and the resulting option drift let a real bootstrap artifact match no
candidate path, so the plugin resolved no token, returned `undefined` **without any
diagnostic**, and the failure surfaced only at the first authenticated request as
`access-token-only request requires Access-Token before request dispatch`.

The **only** sanctioned dev-time browser handoff is:

```ts
import { resolveViteEnvironment } from '<specs>/tools/vite-runtime-profile.mjs';
import { createSdkworkCredentialEntryBootstrapVitePlugin } from '@sdkwork/iam-credential-entry/vite';

const lifecycleEnvironment = resolveViteEnvironment(mode, process.env);
// ...
createSdkworkCredentialEntryBootstrapVitePlugin({
  accessToken: process.env.SDKWORK_ACCESS_TOKEN, // optional; plugin also reads process.env itself
  environment: lifecycleEnvironment,            // MUST be a lifecycle name
});
```

Rules:

- `environment` `MUST` receive a **lifecycle** name — `development`, `test`, `staging`, `demo`,
  `production`. It `MUST NOT` receive Vite's raw `mode`. Vite `mode` is a *deployment profile
  id* (`standalone.development`, `cloud.development`) on every canonical build path, and the
  plugin's gate is a strict comparison, so passing `mode` silently disables injection. Always
  normalize through `resolveViteEnvironment(mode, process.env)`; do not hand-roll the mapping.
- `repoRoot` `MAY` be omitted. When omitted, the plugin searches the process working directory
  and walks ancestors. Callers `MUST NOT` hand-write an artifact path: a wrong root fails
  silently. Only pass `repoRoot` when the artifact genuinely lives outside the app's ancestor
  chain.
- The artifact file names the reader accepts are exactly:
  `.sdkwork.local.env`, `.env.standalone.<lifecycle>.bootstrap.local`,
  `.env.<lifecycle>.bootstrap.local`. A writer that emits any other name or location is
  non-conforming.
- Staging and production `MUST NOT` inject; the plugin's own gate refuses, and callers `MUST NOT`
  widen it (`allowTestInjection` is the only widening, and only for `test`).

### 5.2 Credential Material Invariants (normative)

- A credential field `MUST NOT` be given a fabricated literal default
  (`accessToken: "dev-access-token"`). A literal is not a validated session; seeding a default
  session object with one makes an unauthenticated browser report itself as authenticated
  (`SECURITY_SPEC.md` login-synthesis prohibition). Default such fields to `""` and fail closed.
- A stub IAM runtime `MUST` fail closed rather than manufacture login success.
- These invariants are machine-checked; see §6.

### 5.3 Environment Behavior

| Environment | Missing `SDKWORK_ACCESS_TOKEN` | Browser/Vite behavior |
| --- | --- | --- |
| `development` | Shared helper may generate a disposable local bootstrap JWT from application manifest identity. | Serve-only shared plugin may inject the canonical global handoff. |
| `test` | Generation is allowed only with `allowTestTokenGeneration: true` in an isolated test runner. | Injection is allowed only with `allowTestInjection: true`; production bundles must not contain it. |
| `staging` | Startup fails closed. A private secret source must provide the token for approved server/service contexts. | Never inject or embed the token in browser artifacts. |
| `production` | Startup fails closed. A secret manager, mounted secret, protected host env, or equivalent private source must provide the token for approved server/service contexts. | Never inject or embed the token in browser artifacts. |

Canonical helpers:

- `@sdkwork/iam-application-bootstrap`
  - `ensureRepoBootstrapAccessToken`
  - `loadBootstrapAuthProfileFromHome`
  - `writeRegisteredBootstrapEnvFiles`
- `sdkwork-iam/scripts/dev/ensure-repo-bootstrap-access-token.mjs`
- `sdkwork-space/bin/with-bootstrap-token.mjs`
- `sdkwork-iam/scripts/dev/create-dev-bootstrap-access-token-env.mjs`
  - `mergeRepoBootstrapAccessTokenEnv`
  - `mergeRepoDevBootstrapAccessTokenEnv`
  - `resolveRepoApplicationManifestPath`
- `@sdkwork/iam-credential-entry/node-bootstrap`
  - `readBootstrapAccessTokenEnvFile`
- `@sdkwork/iam-credential-entry/vite`
  - `createSdkworkCredentialEntryBootstrapVitePlugin`
- `sdkwork_iam_flutter_mobile_core`
  - `resolveSdkworkFlutterCredentialEntryBootstrapAccessToken`
  - `requireSdkworkFlutterCredentialEntryBootstrapAccessToken`
- `sdkwork-iam/scripts/dev/run-pc-renderer-dev-with-bootstrap.mjs`
  - standalone PC package `dev` scripts that invoke Vite directly
- topology dev orchestrators such as `*-dev.mjs` that spawn renderers after backend health checks

Rules:

- The repository-level `sdkwork-app` lifecycle facade `MUST` run the canonical IAM development bootstrap provider before spawning any renderer that consumes credential-entry operations. Application-local orchestration helpers are forbidden after migration.
- The lifecycle facade `MUST` pass the resolved renderer bind/port and bootstrap env to the same child process plan; package scripts `MUST NOT` override the topology-selected port with a hard-coded value.
- Standalone IAM PC packages `MUST` route `dev` through `run-pc-renderer-dev-with-bootstrap.mjs` unless a repository-local orchestrator already merges bootstrap env.
- BirdCoder and other apps with public-runtime env denylists `MUST` inject bootstrap credentials through approved private dev channels only.
- A configured token is preserved in every lifecycle. Shared helpers generate only for development or explicitly isolated tests and fail closed when a required staging/production private token is absent.
- Login, registration completion, refresh, and current-session bootstrap `MUST` replace bootstrap credentials through the global TokenManager. Feature code must not retain or reapply the bootstrap value.
- Development Flutter builds may receive the generated private bootstrap token through a Dart define prepared from the explicit surface manifest by the canonical IAM Node helper. Staging and production Flutter artifacts `MUST NOT` embed it and must use a trusted native host channel or approved short-lived exchange.

## 6. Acceptance Checklist

- [ ] Credential-entry route manifests, OpenAPI, SDK metadata, generated call options, and runtime `RouteAuth` all use `credential-entry-bootstrap`, not anonymous.
- [ ] OpenAPI requires only `AccessToken`; SDK transport injects only bootstrap `Access-Token` and fails before dispatch when it is absent.
- [ ] Host apps consume `@sdkwork/iam-credential-entry`; no duplicated local wrappers remain.
- [ ] Host app Vite configs consume `@sdkwork/iam-credential-entry/vite`; no local serializer or `process.env.SDKWORK_ACCESS_TOKEN` define remains.
- [ ] `sdkwork-app` invokes the canonical IAM dev bootstrap provider before renderer spawn; no application-local token generation/helper fork remains.
- [ ] Browser `device_authorizations.create`, retrieve, and session exchange dispatch without `Access-Token` or `Authorization`; QR scan and password-completion credential-entry calls still require only bootstrap `Access-Token`.
- [ ] Development/test lifecycle gates and production browser bootstrap exchange/host channels fail closed under the exact environment policy.
- [ ] Renderer port/bind, injected bootstrap, browser access endpoint, and CORS authority come from the same resolved runtime plan.
- [ ] Machine-checked: `node ../sdkwork-specs/tools/check-token-manager-bootstrap-fallback.mjs --workspace <workspace>` reports zero violations. The gate enforces four independent rules, each with a labeled triage class:
  - `rule1-token-manager`: a session `TokenManager` (or equivalent credential store) that does not fall back to the shared credential-entry bootstrap reader.
  - `rule2-env-fork`: a locally applied `process.env.SDKWORK_ACCESS_TOKEN` Vite `define` entry, or another hand-rolled credential injection channel that bypasses `@sdkwork/iam-credential-entry/vite`.
  - `rule3-raw-mode-as-environment`: a `createSdkworkCredentialEntryBootstrapVitePlugin` call passing Vite `mode` straight through as `environment`, without normalizing it through `resolveViteEnvironment(...)` (see §5.1).
  - `rule4-fabricated-credential`: a credential-ish property (`accessToken` / `authToken` / `access_token` / `auth_token`) bound to a fabricated literal (`dev-access-token`, `mock-token`, `YOUR_TOKEN`-style scaffolding), instead of reading real material or failing closed (see §5.2).
- [ ] Machine-checked: an artifact written for one surface `MUST` be discoverable by the sanctioned reader. The writer and reader contract in §5.1 is the only accepted artifact location; a dev server whose HTML lacks the injected `__SDKWORK_CREDENTIAL_ENTRY_BOOTSTRAP_ACCESS_TOKEN__` bootstrap is non-conformant regardless of which file exists on disk.
