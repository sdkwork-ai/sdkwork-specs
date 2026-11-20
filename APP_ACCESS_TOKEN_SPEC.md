# SDKWork Public Application Access Token Standard

- Version: 1.0
- Scope: public per-application SaaS-isolation access tokens in client env profiles, their
  generation, commit policy, validation, and start/build fail-closed behavior
- Related: `ENVIRONMENT_SPEC.md` §5.1.7 and §6.1, `IAM_APPLICATION_BOOTSTRAP_SPEC.md`,
  `IAM_CREDENTIAL_ENTRY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `API_SPEC.md` §10.4,
  `TEST_SPEC.md`, `SECURITY_SPEC.md`

This standard defines the public **application access token** carried by every
manifest-bearing application root. It is the token a client sends as
`Access-Token` before an interactive user session exists so the server can resolve
tenant, organization, application, environment, and deployment-profile isolation.
It is not a user session credential.

## 1. Two Credential Classes

| Class | Env key | Purpose | Secrecy | May be committed |
| --- | --- | --- | --- | --- |
| Application access token | `SDKWORK_ACCESS_TOKEN` | SaaS isolation before login | Public | Yes |
| Session access token | runtime TokenManager state | Authenticated user session | Private | No |
| Auth token | runtime TokenManager state | Authenticated user session | Private | No |
| Refresh token | runtime TokenManager state | Session refresh | Private | No |
| API key / OAuth bearer | server-side or secure storage | Open-api credentials | Private | No |

Rules:

- The application access token `MUST NOT` be accepted by a server as a user
  session credential, `MUST NOT` authorize protected business operations, and
  `MUST NOT` carry user permissions, `data_scope`, or `permission_scope` beyond a
  minimal `iam:self` bootstrap scope.
- A server `MUST` accept an application access token only on
  `credential-entry-bootstrap` or an equivalent pre-login isolation route, where
  it supplies tenant/app/environment isolation and nothing else.
- Session access tokens, auth tokens, refresh tokens, API keys, OAuth bearers,
  signing keys, and deployment secrets `MUST NEVER` be committed. Only the
  application access token is public material.

## 2. Required Env Profile Matrix

Every application root that ships an installable artifact — every manifest-bearing
root under `apps/*`, and the repository root that carries `agent.app.config.json`
and builds the Web/Desktop shell — `MUST` carry a complete per-scope env profile
set, whatever its application type (Vite, Flutter, mini program, Harmony native,
or another JSON runtime root). The token ships inside the packaged artifact: a
root without one cannot resolve its tenant, organization, application,
environment, and deployment profile before an interactive login exists, so "no
token yet" is never a legal state for a released application. The profile id is
`<deployment-profile>.<environment>` per `ENVIRONMENT_SPEC.md` §5.1:

```text
standalone.development  standalone.test  standalone.staging  standalone.demo  standalone.production
cloud.development       cloud.test       cloud.staging       cloud.demo       cloud.production
```

Each profile file `MUST` contain a non-empty `SDKWORK_ACCESS_TOKEN` whose claims
match that profile and the root's `agent.app.config.json` identity. The file
shape is owned by the application architecture:

| Application format | Profile file |
| --- | --- |
| Vite (PC/H5) | `.env.<profile-id>` |
| Flutter | `env/sdkwork.<profile-id>.json` |
| WeChat mini program | `config/mini-program/runtime-env.<profile-id>.json` |
| Harmony native | `config/app/runtime-env.<profile-id>.json` |
| Other JSON runtime root | `config/app/runtime-env.<profile-id>.json` |

The repository root's documented `.env.<profile-id>` deployment documents (the
Web/Desktop shell build input) keep the Vite carrier shape but are authored
documents: their token is materialized in **token-only** mode, which owns the
`SDKWORK_ACCESS_TOKEN` line and preserves every other byte, including
documentation and empty key placeholders
(`materialize-client-env.mjs`, `mode: "token-only"`). A missing document is a
failure, not a skip, and a document whose declared identity names another
profile is refused so a token cannot land in the wrong carrier.

Rules:

- The ten files above are mandatory even when the root declares only one
  supported deployment profile; `agent.app.config.json`
  `runtime.supportedDeploymentProfiles` controls packaging, not the env matrix.
- The token `MUST` be permanent. It ships with the application and has no
  expiry in normal operation: `exp: 0` (the canonical sentinel), or no `exp`
  claim at all. A packaged build cannot renew a credential it did not keep, so
  an expiring profile token is a defect, and the gates fail one whose concrete
  rotation deadline already elapsed.
- Every declared application type `MUST` carry the token. The matrix is per
  root, not per repository: a repository whose five `apps/*` roots are covered
  still fails the standard while its Web/Desktop root documents carry none.
- `SDKWORK_ACCESS_TOKEN` `MUST` be present, non-empty, and a three-part JWT
  compact serialization. A missing, empty, malformed, or mismatched token
  `MUST` fail `dev`, `start`, `serve`, `build`, `package`, and `dist` before the
  application process or renderer spawns.
- The token `MUST NOT` be duplicated under `VITE_*`, `PORTAL_PUBLIC_*`, or a
  format-specific public prefix. The canonical key is exactly
  `SDKWORK_ACCESS_TOKEN`, including JSON profile files.
- The token `MUST` be generated by the canonical generator
  `tools/materialize-client-env.mjs` (which uses `tools/app-access-token.mjs`),
  never hand-written and never inherited from `etc/topology/base.env` or an
  application `etc/env.base.env` overlay.

> **Deprecated for new consumers.** The committed matrix above remains a supported release input,
> but a surface that needs an application credential *during a user session* `MUST` obtain it from
> `appAccessTokens.create` (§8): that credential is signed, revocable, and expresses the caller's
> own, organization, or tenant entitlement. The committed `alg:none` token stays the pre-login
> isolation credential (§5) and is removed per surface only after that surface exchanges at
> runtime.

## 3. Token Format And Claims

The application access token is a public isolation token. It uses JWT compact
serialization with an explicit public header and no secret signature:

```json
{ "alg": "none", "kid": "public-app-token", "typ": "JWT" }
```

Required claims:

| Claim | Value |
| --- | --- |
| `token_class` | `application` |
| `token_type` | `access` |
| `token_version` | `1` |
| `iss` | `sdkwork-iam-public` |
| `aud` | the deployment application anchor, or the root manifest `backend.appId` when the app id is repository-owned (§3.1.1) |
| `app_id` | the deployment application anchor, or the root manifest `backend.appId` when the app id is repository-owned (§3.1.1) |
| `tenant_id` | the root manifest `backend.tenantId` |
| `organization_id` | the root manifest `backend.organizationId`, subject to §3.2.1 (`0` unless the installation is `ORGANIZATION`) |
| `login_scope` | `TENANT` when `organization_id` is `0`, otherwise `ORGANIZATION` |
| `ownership_scope` | the installation's release scope: `TENANT` (default), `ORGANIZATION`, or `USER` (§3.2.1) |
| `environment` | the profile environment (`development`, `test`, `staging`, `demo`, `production`) |
| `deployment_profile` | `standalone` or `cloud` |
| `deployment_mode` | `private` for standalone, `saas` for cloud |
| `runtime_target` | the surface runtime target |
| `session_id` | `bootstrap-public-<app_id>-<profile-id>` |
| `user_id` | `0` for `TENANT`/`ORGANIZATION`; the installation owner's user id for `USER` (§3.2.1) |
| `permission_scope` | `["iam:self"]` |
| `iat` | fixed generation instant |
| `exp` | `0` — permanent (the default); a concrete future epoch is an explicit rotation deadline |

Rules:

- The token `MUST NOT` carry a live user id, user handle, email, phone, or
  tenant selection supplied by a client. The only user identity a token may
  carry is the installation owner's `user_id` for a `USER` release (§3.2.1),
  and it is resolved at materialization, never supplied by a request.
- The token `MUST` carry `ownership_scope` with the installation's release
  scope. The vocabulary, the `TENANT` default, and the immutability rule are
  owned by `APPLICATION_IDENTITY_SPEC.md` §4.1; §3.2.1 fixes the generation
  rules. IAM rejects a token whose claim does not match the installation.
- `alg:none` is allowed **only** for `token_class: application`; session and
  operator credentials `MUST` remain signed per `IAM_SPEC.md`.
- The generator `MUST` be deterministic: the same app, profile, manifest
  identity, and generation instant produce the same token. Regenerating without
  a rotation request `MUST NOT` rewrite committed files.
- The token `MUST` be permanent by default: `exp` is `0`, the explicit
  no-expiry sentinel (`app-access-token.mjs`
  `PUBLIC_APP_ACCESS_TOKEN_NO_EXPIRY`, `sdkwork-iam`
  `APPLICATION_ACCESS_TOKEN_NO_EXPIRY`), and the gates also accept an absent
  claim. Permanent means exactly that — no session lifetime, no scheduled
  refresh, and a shipped package keeps working until it is replaced.
- A concrete `exp` is an explicit rotation deadline and stays opt-in: the
  generator takes it as an override for a time-boxed rotation window, and a
  deadline at or before the generation instant is refused. Every gate refuses a
  committed token whose concrete deadline already elapsed, so an expired
  credential cannot reach a package.
- Rotation is an explicit act: bump the generator's generation instant or
  `token_version`, regenerate every profile file, review the diff, and commit.
  A committed token does not expire in normal operation; a concrete `exp` is a
  rotation ceiling chosen by the operator, never a default.

### 3.1 Token Value Is A String

`SDKWORK_ACCESS_TOKEN` is a **single JWT compact string**, never a JSON object:

```text
SDKWORK_ACCESS_TOKEN=eyJhbGciOiJub25lIiwia2lkIjoicHVibGljLWFwcC10b2tlbiIsInR5cCI6IkpXVCJ9.eyJhcHBfaWQiOiJzZGt3b3JrLWltLXBjIiwiYXVkIjoic2Rrd29yay1pbS1wYyIsImRlcGxveW1lbnRfbW9kZSI6InByaXZhdGUiLCJkZXBsb3ltZW50X3Byb2ZpbGUiOiJzdGFuZGFsb25lIiwiZW52aXJvbm1lbnQiOiJkZXZlbG9wbWVudCIsImV4cCI6NDEwMjQ0NDgwMCwiaWF0IjoxNzY3MjI1NjAwLCJpc3MiOiJzZGt3b3JrLWlhbS1wdWJsaWMiLCJsb2dpbl9zY29wZSI6IlRFTkFOVCIsIm9yZ2FuaXphdGlvbl9pZCI6IjAiLCJwZXJtaXNzaW9uX3Njb3BlIjpbImlhbTpzZWxmIl0sInJ1bnRpbWVfdGFyZ2V0IjoiYnJvd3NlciIsInNlc3Npb25faWQiOiJib290c3RyYXAtcHVibGljLXNka3dvcmstaW0tcGMtc3RhbmRhbG9uZS5kZXZlbG9wbWVudCIsInRlbmFudF9pZCI6IjEwMDAwMSIsInRva2VuX2NsYXNzIjoiYXBwbGljYXRpb24iLCJ0b2tlbl90eXBlIjoiYWNjZXNzIiwidG9rZW5fdmVyc2lvbiI6MSwidXNlcl9pZCI6IjAifQ.public
```

`etc/client-env.materialization.json` may contain an `accessToken` **input
object**. That object is generator configuration, not the token:

```json
{
  "accessToken": {
    "appId": "sdkwork-im-pc",
    "tenantId": "100001",
    "organizationId": "0",
    "permissionScope": ["iam:self"]
  }
}
```

The materializer generates the JWT string from that object and writes the
string to the profile file. A surface `MUST NOT` store the object in a profile
file, and a profile file `MUST NOT` store the object under
`SDKWORK_ACCESS_TOKEN`.

### 3.1.1 Deployment-Injected Application Identity Anchor

When the platform makes the **deploy application** the identity of every access
token, the application id belongs to the installation, not to the repository. A
surface `MUST` then source its `app_id`/`aud` from an environment variable
instead of a compiled-in literal:

```json
{
  "accessToken": {
    "appIdEnv": "SDKWORK_DEPLOY_APPLICATION_ID",
    "tenantId": "100001",
    "organizationId": "0",
    "permissionScope": ["iam:self"]
  }
}
```

Rules:

- `accessToken.appIdEnv` names the variable that carries the anchor. The inline
  placeholder `"appId": "${SDKWORK_DEPLOY_APPLICATION_ID}"` is equivalent.
  `accessToken.appId` and `accessToken.appIdEnv` are mutually exclusive.
- Materialization `MUST` read the anchor from the process environment and
  `MUST` fail, naming the variable, when it is unset or empty. It `MUST NOT`
  fall back to a retired or compiled-in app id.
- A repository `SHOULD` commit the profile placeholder
  `__SDKWORK_DEPLOY_APPLICATION_ID__` for a surface whose anchor is only known at
  deployment, so no fabricated identity is committed. Deployment re-runs
  `materialize-client-env` with the anchor set before building or packaging.
- A documented profile document (`mode: "token-only"`) is authored, not
  generated: materialization replaces only the `SDKWORK_ACCESS_TOKEN` line,
  keeps every other byte, and refuses a document whose declared identity names
  another profile. The placeholder rule above still applies to the token it
  holds, so a source checkout keeps the pending anchor while shipping the
  current claim set.
- Verification gates `MUST` resolve the expected app id per surface with the
  same `appIdEnv` logic, highest precedence first:
  1. the surface-scoped variable `<appIdEnv>_<SURFACE>` in the process
     environment;
  2. the same variable recorded in that profile's env layer — the resolved
     profile file named by `etc/sdkwork.deployment.config.json`
     (`etc/topology/<profile>.<environment>.env`), then the authored
     `etc/topology/overrides/<profile>.<environment>.env`;
  3. the declared repository-level variable `<appIdEnv>`.
  The surface-scoped name `MUST` reuse `surfaceApplicationTokenEnvName`
  (`tools/app-access-token.mjs`), the same normalization the materializer uses,
  so a gate and the generator cannot disagree.
  `check-app-access-token-env.mjs` and `check-release-access-token-env.mjs`
  accept `--surface <id>[,<id>]` to limit the check to surfaces materialized
  separately, and each profile is compared against the anchor resolved for its
  own surface, so one surface's token is never judged against another surface's
  anchor.
- When no layer carries an anchor for a checked surface, the gate `MUST` print
  `skipped: <ENV> not set` for that surface and return 0 when nothing was
  verified, because it cannot compare against an identity that does not exist
  there; it `MUST NOT` report a pass that was never evaluated. `--require-anchor`,
  used by the packaging/release preflight, turns a missing anchor into a failure
  and also refuses a token that still carries the committed
  `__SDKWORK_DEPLOY_APPLICATION_ID__` placeholder; without that flag a
  placeholder is reported as needing materialization.
- A surface that still declares a literal `accessToken.appId` while the
  platform uses a deploy application anchor is a violation in that repository;
  the application-owned gate fails and names `accessToken.appIdEnv`.

Generate, decode, and verify with the canonical tool:

```bash
# generate the JWT compact string
node <sdkwork-specs>/tools/app-access-token.mjs generate \
  --app-id sdkwork-im-pc \
  --tenant-id 100001 \
  --organization-id 0 \
  --environment production \
  --deployment-profile cloud \
  --runtime-target browser \
  --permission-scope iam:self

# inspect header and claims
node <sdkwork-specs>/tools/app-access-token.mjs decode --token "$SDKWORK_ACCESS_TOKEN"

# verify the token against one profile
node <sdkwork-specs>/tools/app-access-token.mjs verify \
  --token "$SDKWORK_ACCESS_TOKEN" \
  --app-id sdkwork-im-pc \
  --tenant-id 100001 \
  --environment production \
  --deployment-profile cloud \
  --runtime-target browser
```

The generate command prints only the token string by default; `--json` prints
the token with decoded header and payload. The signature segment is the literal
`public`; it is not a secret and is never verified with a shared key.

### 3.2 Tenant-Level And Organization-Level Tokens

The token scope is explicit and is derived from `organization_id`:

| Scope | `organization_id` | `login_scope` | Meaning |
| --- | --- | --- | --- |
| Tenant-level | `0` | `TENANT` | the application token can resolve tenant-wide operations for its `tenant_id` |
| Organization-level | non-zero | `ORGANIZATION` | the same token is bound to one organization inside the tenant |

The organization context above is not the installation's release scope: a `USER` release is
tenant-level in organization terms (`organization_id = 0`, `login_scope = TENANT`) and is
identified only by its `ownership_scope` claim (§3.2.1).

The two levels are the two multi-tenant isolation keys, and they are not
interchangeable:

- **Tenant-level** (`organization_id = 0`): every row the credential can reach is
  scoped by `tenant_id` alone, so the tenant is one SaaS boundary and its
  organizations are rows *inside* that boundary, not separate boundaries.
- **Organization-level** (`organization_id` non-zero): rows are scoped by
  `tenant_id` plus that `organization_id`, so one tenant can host several
  organizations whose data never mixes, and a tenant-level credential is not a
  superset of an organization-level one on a route that requires the binding.
- The token level is a property of the installation and the artifact, decided by
  the surface declaration (`accessToken.organizationId` / `accessToken.scope`),
  never by a request. A client `MUST NOT` rewrite, widen, or re-scope a shipped
  token; a caller that needs another level receives a different credential from
  IAM, not an edited claim.
- The isolation key is the canonical tuple of `APPLICATION_IDENTITY_SPEC.md`
  §4.1 rule 7: `(tenant_id, app_id)` for a tenant release,
  `(tenant_id, app_id, organization_id)` for an organization release, and
  `(tenant_id, app_id, user_id)` for a personal release. Downstream modules bind
  that tuple (`ApplicationIsolationKey::filter_columns`) instead of hand-writing
  a predicate, and a tenant-level credential is never narrowed by an
  organization binding it does not own.

Rules:

- The generator `MUST` derive `login_scope` from `organization_id`; it `MUST NOT`
  accept a contradictory `loginScope`.
- A surface `MAY` declare `accessToken.scope` as `tenant` or `organization` as
  an explicit guard. The value `MUST` agree with `accessToken.organizationId`;
  a mismatch `MUST` fail materialization.
- A tenant-level token `MUST` use `organization_id=0`. An organization-level
  token `MUST` use a non-zero `organization_id`.
- Server resolvers `MUST` reject a tenant-level token on a route that requires
  an organization binding, and `MUST` reject an organization-level token on a
  cross-organization or tenant-wide route.
- A tenant-level token `MUST NOT` be used to impersonate an organization;
  an organization-level token `MUST NOT` be widened to tenant scope by a
  client-supplied organization id.
- `permission_scope` does not change the token level. A tenant-level token with
  `iam:self` and an organization-level token with `iam:self` remain different
  scopes because of `organization_id` and `login_scope`.

Examples:

```bash
# tenant-level
node <sdkwork-specs>/tools/app-access-token.mjs generate \
  --app-id sdkwork-im-pc --tenant-id 100001 --organization-id 0 \
  --scope tenant --environment production --deployment-profile cloud \
  --runtime-target browser

# organization-level
node <sdkwork-specs>/tools/app-access-token.mjs generate \
  --app-id sdkwork-im-pc --tenant-id 100001 --organization-id 42 \
  --scope organization --environment production --deployment-profile cloud \
  --runtime-target browser
```

### 3.2.1 Release Scope Claim And Ownership Claims

One source tree produces different deployments, and the release scope is what tells them apart.
Every application access token `MUST` carry the scope of the installation it serves. The
vocabulary, the `TENANT` default, and the immutability rule are owned by
`APPLICATION_IDENTITY_SPEC.md` §4.1; this section fixes how `tools/app-access-token.mjs` and
`tools/materialize-client-env.mjs` stamp it.

| Release scope | `ownership_scope` | `organization_id` | `user_id` | `login_scope` |
| --- | --- | --- | --- | --- |
| Tenant (default) | `TENANT` | `0` | `0` | `TENANT` |
| Organization | `ORGANIZATION` | the installation's non-zero organization id | `0` | `ORGANIZATION` |
| Personal | `USER` | `0` | the installation owner's user id | `TENANT` |

Generation rules:

- The value resolves, highest precedence first:
  1. the process environment variable `SDKWORK_APPLICATION_OWNERSHIP_SCOPE`;
  2. the materialization surface declaration `accessToken.ownershipScope` in
     `etc/client-env.materialization.json`;
  3. the surface's organization binding: a non-zero
     `accessToken.organizationId` is an `ORGANIZATION` release and `0` is
     `TENANT`, so the level is declared once rather than repeated as a scope;
  4. the default `TENANT`.

  A deployment-provided value outranks the committed declaration because the scope belongs to
  the installation, not to the repository (`APPLICATION_IDENTITY_SPEC.md` §4.1 rule 3).
  `accessToken.scope` (`tenant` | `organization`) stays an explicit guard and must agree with the
  organization binding whichever source supplied the scope.
- `ORGANIZATION` `MUST` carry a non-zero `organization_id`; `TENANT` and `USER` `MUST` carry `0`,
  because a personal release is tenant-level in organization terms and only `ownership_scope`
  distinguishes it from a tenant release (rule 7). A contradiction fails materialization and
  names the claim.
- `USER` `MUST` carry its owner in the existing `user_id` claim. The owner resolves from the
  process environment variable `SDKWORK_APPLICATION_OWNER_USER_ID`, then the surface declaration
  `accessToken.ownerUserId`. When neither supplies a non-zero value, generation fails and names
  both the claim and the missing source; a synthetic id (`0`) is never substituted.
- The claim reaches every language form the materializer serves (vite, Flutter, mini program,
  Harmony native), because all of them are produced by the same token builder.
- An unknown value `MUST` fail generation and decoding instead of being mapped to the default.
  A token whose claim contradicts its `organization_id`, or a `USER` token without a non-zero
  `user_id`, is rejected on decode before any identity comparison.

Validation rules:

- `check-app-access-token-env.mjs` and `check-release-access-token-env.mjs` resolve the expected
  scope exactly as the materializer does (environment, declaration, default) and compare it with
  the committed token's claim.
- An absent claim is the legacy derivation: `TENANT` when `organization_id` is `0`, otherwise
  `ORGANIZATION`, never `USER`. It is accepted only for an expected `TENANT` surface. An
  `ORGANIZATION` or `USER` surface requires the explicit claim and fails with
  `missing claim ownership_scope=<scope>`; a `USER` token must also carry a non-zero `user_id`,
  and the owner is compared whenever one is resolvable.
- `assertApplicationAccessToken(token, expected)` accepts `ownershipScope` and `ownerUserId`, so
  an application gate can assert both claims against its own declaration.

```bash
# organization-scoped installation
node <sdkwork-specs>/tools/app-access-token.mjs generate \
  --app-id sdkwork-im-pc --tenant-id 100001 --organization-id 42 \
  --ownership-scope ORGANIZATION --environment production \
  --deployment-profile cloud --runtime-target browser

# personal installation (the owner is the installation's user_id)
node <sdkwork-specs>/tools/app-access-token.mjs generate \
  --app-id sdkwork-im-pc --tenant-id 100001 --organization-id 0 \
  --ownership-scope USER --user-id <owner-user-id> --environment production \
  --deployment-profile cloud --runtime-target browser
```

Without `--ownership-scope`, the command keeps the legacy derivation from `--organization-id`
(`0` = `TENANT`, non-zero = `ORGANIZATION`, never `USER`); that is why an organization-level
direct generation still names the organization id.

## 4. Start And Build Gate

- `dev`, `start`, `serve`, `build`, `package`, and `dist` `MUST` validate the
  selected profile file before spawning the runtime, compiler, or renderer.
- The validation `MUST` check: file exists, key present, value parses as a
  three-part JWT, and `app_id`, `tenant_id`, `organization_id`,
  `ownership_scope`, `environment`, `deployment_profile`, and `runtime_target`
  match the selected root and profile. An absent `ownership_scope` is the
  legacy derivation and is accepted only for a `TENANT` surface (§3.2.1).
- The validation `MUST` also check the lifetime: a permanent token (`exp: 0` or
  absent) passes, and a concrete `exp` that already elapsed fails with the claim
  that expired. `assertApplicationAccessToken` owns that decision, so every
  consumer applies the same rule.
- Every declared surface is covered, including a token-only documented root: a
  missing profile document fails, and the surface list itself is validated, so a
  newly added application type cannot ship without its token.
- The materialization declaration is the authoritative inventory of a
  repository's client application types: a repository that ships client
  artifacts `MUST` declare one surface per type, and a repository root that
  builds a packaged client artifact (the Web/Desktop shell) `MUST` declare its
  token-only `.env.<profile>` surface. The gate enforces every declared
  surface's matrix and its agreement with the owning manifest; it does not infer
  undeclared roots, because a repository may legitimately keep server-only or
  non-client roots outside the token matrix (`format: "none"` declares a
  server-only repository).
- A failure `MUST` be non-zero and name the failing app root, profile file,
  profile id, and the repair command
  `node <sdkwork-specs>/tools/materialize-client-env.mjs --root <repository>`.
- The gate `MUST` run in local development and CI. A bypass flag is forbidden.

### 4.1 Release And Local Commit Preflight

- Every `test`, `staging`, `demo`, and `production` deployment profile declared
  by `etc/sdkwork.deployment.config.json` `MUST` have a valid public application
  access token in every declared client surface.
- Packaging and deployment `MUST` fail before the build/deploy phase when a
  release profile token is missing, empty, or has mismatched
  `environment`/`deployment_profile`/`app_id` claims.
- The release preflight resolves each surface's anchor per §3.1.1 and packaging
  runs it with `--require-anchor`, so a multi-surface repository passes when
  every surface carries its own anchor and fails when any checked surface has
  none or still carries the committed placeholder.
- The reusable package and verify workflows run
  `scripts/check-release-access-token-env.mjs` immediately after
  `validate-config`. The check is not bypassable.
- A repository `MUST` provide a local pre-commit check equivalent to
  `node <sdkwork-specs>/tools/check-release-access-token-env.mjs --root .`;
  sdkwork-im ships it as `.githooks/pre-commit` and installs
  `core.hooksPath=.githooks` through `scripts/dev/install-git-hooks.mjs`.
  Other workspace modules install the shared hook with
  `node <sdkwork-specs>/tools/install-workspace-release-token-hooks.mjs
  --workspace <workspace-root>`.
- A local developer who has not installed the hook still runs
  `pnpm check:release-access-token` in the repository check lane.

## 5. Server Acceptance

- Server resolvers `MUST` treat an `alg:none`, `token_class:application` token as
  isolation-only input.
- Server resolvers `MUST NOT` require a persisted user session row for an
  application access token. They `MUST` resolve tenant, organization,
  application, environment, and deployment profile from the token claims and
  reject the token when those claims do not resolve to an enabled tenant
  application.
- The server `MUST` reject an application access token on any route whose
  auth mode is `dual-token`, `backend-admin`, `open-api`, `api-key`,
  `refresh-token`, or an internal/service profile.
- An application access token `MUST` never create a user session by itself. It
  only enables credential-entry bootstrap; the resulting session tokens are
  issued by IAM after the declared login flow.
- The server `MUST` reject a token whose `app_id`/`aud` does not resolve to an
  enabled tenant application for its `tenant_id` and `organization_id`.
- The resolver `MUST` project the isolation keys onto the credential's data
  scope: `tenant:<tenant_id>` for every application token,
  `organization:<organization_id>` for an organization-level token, and
  `user:<owner_user_id>` for a `USER` release. The projection matches a session
  credential's, so a data plane that filters by data scope isolates a
  tenant-level token to its tenant and an organization-level token to its
  organization (`API_SPEC.md` §10.4, `DATABASE_SPEC.md` §16). A tenant-level
  token `MUST NOT` carry an `organization:` entry.
- Production IAM `MUST NOT` trust `token_class:application` tokens for
  administrative operations (application register, provision, enable, or access
  credential issuance).

## 6. Generation And Validation Commands

```bash
# materialize every profile (URLs + public application access token)
node <sdkwork-specs>/tools/materialize-client-env.mjs --root <repository>

# verify the committed matrix without rewriting
node <sdkwork-specs>/tools/materialize-client-env.mjs --root <repository> --check
node <sdkwork-specs>/tools/check-app-access-token-env.mjs --root <repository>

# fail fast for test/staging/demo/production profiles
node <sdkwork-specs>/tools/check-release-access-token-env.mjs --root <repository>

# workspace adoption report
node <sdkwork-specs>/tools/audit-app-access-token-workspace.mjs --workspace <workspace-root>
node <sdkwork-specs>/tools/audit-client-surface-token-matrix.mjs --workspace <workspace-root>
node <sdkwork-specs>/tools/validate-access-token-files.mjs --workspace <workspace-root> --check

# adopt the token in client env configs / existing profile files
node <sdkwork-specs>/tools/adopt-app-access-token.mjs --workspace <workspace-root> --dry-run
node <sdkwork-specs>/tools/adopt-app-access-token-files.mjs --workspace <workspace-root> --dry-run
```

## 7. Checklist

- [ ] Every manifest-bearing `apps/*` root has all ten profile files.
- [ ] Every application type is covered, including the repository root's
  Web/Desktop `.env.<profile-id>` documents: no shipped artifact carries an
  empty `SDKWORK_ACCESS_TOKEN`.
- [ ] Every profile file carries exactly one non-empty `SDKWORK_ACCESS_TOKEN`.
- [ ] Every token is permanent (`exp: 0` or absent); only a deliberate rotation
  window carries a concrete future deadline, and no committed deadline elapsed.
- [ ] Every token matches its manifest identity and profile claims.
- [ ] Every token carries the installation's `ownership_scope`; `ORGANIZATION` names a non-zero
  organization and `USER` carries its owner's `user_id`.
- [ ] The token's level matches the deployment: tenant-level uses
  `organization_id=0` and keys isolation by `tenant_id`; organization-level uses
  the deployment's non-zero organization and keys isolation by that id.
- [ ] No session, auth, refresh, API-key, OAuth, or signing secret is committed.
- [ ] `dev`, `start`, and `build` fail closed when the selected token is absent.
- [ ] Generated files are deterministic and reviewed as a normal diff.
- [ ] A consumer that needs an application credential at runtime calls
  `appAccessTokens.create` (§8) instead of inventing a second issuance path.

## 8. Runtime Application Access Token Exchange

Status: **target path**. The committed `SDKWORK_ACCESS_TOKEN` profile matrix (§2–§6) stays valid and
is **deprecated** for new consumers; a repository migrates surface by surface once its runtime
can mint the credential it needs.

### 8.1 Why the committed token is not the runtime answer

The committed token is `alg:none` public material (§1, §5). It can only be produced at build time
from a deployment-injected anchor, so every new consumer must first be registered, have its anchor
materialized, and be rebuilt. It also carries no subject that could authorize anything: any client
can forge one. An application that needs a credential *for itself, for its organization, or for its
tenant*, obtained by a signed-in user at run time, therefore needs a signed credential and an
issuance endpoint.

### 8.2 Issuing endpoint

| Property | Value |
| --- | --- |
| Route | `POST /app/v3/api/iam/app_access_tokens` |
| Operation id | `appAccessTokens.create` |
| Auth mode | `dual-token` (authenticated user session) |
| Permission | `iam.app_tokens.create` (`app_user` baseline) |
| Success | HTTP `201` with `SdkWorkApiResponse.data.item` = `IamAppAccessToken` |
| Owner | `sdkwork-iam` (app-api) |
| SDK | `@sdkwork/iam-app-sdk` → `iam.appAccessTokens.create(body)` |

Request body (`IamAppAccessTokenCreateCommand`): at least one selector.

| Field | Meaning |
| --- | --- |
| `appId` | the installation's deploy application anchor (preferred: it is the identity the deployment plane publishes) |
| `tenantApplicationId` | the IAM installation row (`tapp_…`) of the caller's tenant |
| `instanceKey` | the installation instance key of the caller's tenant |
| `environment` | exact installation lifecycle to initialize (`development`/`test`/`staging`/`demo`/`production`). Omitted means: the caller's session environment when the installation registered it, otherwise the installation's **only active** environment; anything ambiguous fails closed and names the registered rows |
| `ownershipScope` | release-scope **declaration** to be checked (`TENANT`/`ORGANIZATION`/`USER`); the installation decides and the value is immutable |

The tenant and the organization are **server-derived**. A body that supplies
`tenantId` or `organizationId` does not name a selector and `MUST` be ignored: the
installation decides the organization claim.

The response item (`IamAppAccessToken`) also reports the lifecycle the credential
was gated on (`environment`), so a client can cache it without re-decoding the JWT.

### 8.2.1 Three initialization paths

One endpoint serves the three ways an application factory needs to initialize a
credential. The installation's release scope selects the path, and the capability is
resolved **at that scope**, never from an aggregated session list:

| Path | Capability | Resolved at | Release declaration |
| --- | --- | --- | --- |
| Tenant admin | `iam.app_tokens.create` **or** `iam.app_tokens.admin` | tenant-scope bindings only | omit to inherit the installation (`TENANT` applications yield tenant-level credentials) |
| Organization member with the capability | `iam.app_tokens.admin` | that organization's bindings **plus** tenant bindings | omit to inherit (`ORGANIZATION`) |
| Application owner | none — ownership | n/a | omit to inherit (`USER`) |

The scope resolution is the security boundary: `resolve_session_scopes(..., None)` reads
tenant-scope bindings only, and `resolve_session_scopes(..., Some(organization))` adds that
organization's bindings. An organization grant therefore can never satisfy a tenant-level
exchange, and a tenant grant satisfies every organization of its tenant.

An omitted `ownershipScope` inherits the installation's release scope, so an application the
factory registers as `TENANT` (the deploy default) initializes as a **tenant-level** credential
with no extra input. An explicit declaration that disagrees with the installation `MUST` fail with
a conflict naming the value; the installation's scope is immutable
(`APPLICATION_IDENTITY_SPEC.md` §4.1 rule 3).

### 8.3 Entitlement matrix

The credential is issued only when the installation's release scope entitles the caller. The
caller's tenant always comes from its session, so a cross-tenant selector cannot resolve.

| Installation `ownership_scope` | Who may exchange | Enforcement |
| --- | --- | --- |
| `USER` | the installation owner only — even a platform administrator must not impersonate it | `installation.owner_user_id == session.user_id` |
| `ORGANIZATION` | an active member of that organization holding `iam.app_tokens.admin` **for that organization** | `iam_organization_membership` row (same tenant and organization) plus the capability resolved with that organization's bindings; `org_admin` supplies it through its `iam.*` grant |
| `TENANT` | an active member of that tenant holding `iam.app_tokens.create` or `iam.app_tokens.admin` at tenant scope | `iam_tenant_member` row plus the capability resolved with tenant-scope bindings only |

Additional preconditions, all failing closed: the installation `MUST` be `enabled`; the selected
environment `MUST` have an `active` installation-environment row; the issued `permission_scope`
`MUST` be the intersection of the caller's session scopes and the installation's
`access_permissions`.

Baseline capability grants (IAM module catalog):

| Capability | Baseline holders | Resolved at |
| --- | --- | --- |
| `iam.app_tokens.create` | `app_user` — every tenant member | tenant scope |
| `iam.app_tokens.admin` | `platform_system_admin`, `platform_super_admin` | tenant scope |
| `iam.app_tokens.admin` | `org_admin` (through its `iam.*` role grant) | the bound organization |

A deployment `MUST` not broaden these baselines implicitly: an organization grant applies only
where its binding is organization-scoped, because the entitlement check resolves the caller's
capabilities with the installation's organization.

### 8.4 Credential properties

- Signed with the tenant signing key (`alg` is never `none`); the subject is the installation's
  deploy application anchor, so `app_id`/`aud` name the deployment, not the IAM runtime app id.
- Claims: `accessToken`, `authToken`, `expiresAt`, `appId`, `tenantApplicationId`,
  `organizationId`, `ownershipScope`, `environment`, `sessionId`.
- The `environment` claim is the coarse session-plane value (`Dev`/`Test`/`Prod`) while the
  installation gate runs against the exact lifecycle key; `staging` and `demo` installations
  therefore carry the `Prod` claim, consistent with the rest of IAM.
- Session-class: **one hour** TTL, persisted as a revocable session, audited like any other IAM
  issuance. It is not the §2 public token and `MUST NOT` be committed to a profile file.
- Each issuance writes one `iam_audit_event` (action `iam.app_access_token.created`, resource
  `iam_application_installation`, actor the calling user, detail carrying the anchor, release
  scope, lifecycle, and session id — never the credential or its hash). A failed audit write
  `MUST` return an error instead of handing out an unaudited credential; the already-persisted
  session then carries no disclosed token and expires with the TTL.
- It authorizes the same operations a session of that installation authorizes — bounded by the
  intersection above — so a consumer can call app-api and backend-api surfaces with
  `Access-Token`/`Authorization: Bearer`.
- It `MUST NOT` be used to issue further credentials, register or provision installations, or
  obtain another application's credential.

### 8.5 Client libraries

- `@sdkwork/iam-app-sdk` exposes the typed call:
  `iam.appAccessTokens.create({ appId, environment?, ownershipScope? }) => IamAppAccessToken`.
- `sdkwork-deployments` ships `sdkwork-deploy-app-token`, the deploy-side library that resolves a
  caller-facing selector (slug / uuid / anchor) inside the caller's tenant and then performs the
  exchange: `DeployAppTokenService::issue(tenant_id, session, request)`, with
  `AppTokenRequest::with_environment(...)` for the lifecycle hint. It reads only `deploy_app`,
  never signs, and never caches or widens a credential.

### 8.6 Migration from the committed token

1. Keep the committed matrix until every consumer of a surface can exchange at runtime; the two
   paths coexist (no profile file changes are required by this section).
2. A consumer replaces `SDKWORK_ACCESS_TOKEN` reads with an exchange call bound to its logged-in
   session, and keeps the committed token only for the pre-login isolation route (§5).
3. A consumer that only ever calls during a user session `MAY` drop the committed token once its
   surface matrix is migrated; removal is a per-repository decision, not a platform cut-over.

### 8.7 App factory flow

The exchange is the last step of the application factory
(`APPLICATION_FACTORY_DEPLOYMENT_SPEC.md` §11); all three steps exist today and no committed token
is involved on this path:

| Step | Owner | Operation |
| --- | --- | --- |
| 1. Register the application | deploy | `POST /app/v3/api/apps` — `ownerType` defaults to `TENANT`; a user-created application is `USER` with the caller as `user_id` |
| 2. Provision the installation | deploy → IAM | `POST /backend/v3/api/apps/{appId}/identity_provision` (automatic on create) writes `iam_application_installation` with the application's `ownershipScope`/`ownerUserId` and its lifecycle environment rows |
| 3. Initialize the credential | IAM | `POST /app/v3/api/iam/app_access_tokens` — operator (admin, default `TENANT`) or the owner/member (8.3) |

Operationally: an operator registers an application and initializes a tenant-level credential with
no extra input; a signed-in user registers an application (it becomes a `USER` installation owned
by that user) and initializes its credential as its owner. Both use the same endpoint, and neither
needs a deployment-injected static token.

```bash
# Verify the contract after touching the endpoint or its schemas
node <sdkwork-specs>/tools/check-api-operation-patterns.mjs --workspace <workspace-root>
node <sdkwork-specs>/tools/check-api-response-envelope.mjs --workspace <workspace-root>
```

### 8.8 Rule flow

Normative order. A step runs only when every earlier step passed; a failure stops the flow with
the stated class and no credential is issued.

| # | Step | Rule | Failure |
| --- | --- | --- | --- |
| 0 | Transport auth | `dual-token` only: a session `Access-Token` + `Authorization: Bearer`. The `alg:none` public isolation token (§5) is never accepted here | 401 |
| 1 | Route capability | the session must hold `iam.app_tokens.create` (entry capability). `iam.app_tokens.admin` broadens *which installations* are reachable; it does not replace the entry capability | 403 |
| 2 | Throttle | one bucket per `(tenant, user)` from the IAM rate-limit window; a limiter storage failure fails closed | 429 / 503 |
| 3 | Session actor | tenant, user, session organization, environment, deployment mode. A bootstrap/system actor is refused | 401 |
| 4 | Body | at least one of `appId` / `tenantApplicationId` / `instanceKey`; `ownershipScope` ∈ {TENANT, ORGANIZATION, USER} when present; `environment` optional | 400 |
| 5 | Installation resolution | resolved **within the caller's tenant** by anchor → installation row → instance key. Another tenant's row is indistinguishable from a missing one | 404 |
| 6 | Installation state | `status = enabled`; a `USER` installation must carry its owner | 409 |
| 7 | Release-scope entitlement | `USER`: owner only. `TENANT`: active tenant membership + (`iam.app_tokens.create` or `iam.app_tokens.admin`) resolved from **tenant-scope bindings only**. `ORGANIZATION`: active membership of that organization + `iam.app_tokens.admin` resolved **for that organization** | 403 |
| 8 | Scope declaration | omitted → inherit the installation's scope; explicit → must equal it (the installation is immutable) | 409 |
| 9 | Environment | explicit `environment` must be a registered `active` lifecycle; omitted → session environment when registered, else the installation's only `active` environment, else refuse and list the rows | 409 |
| 10 | Issuance | tenant signing key; `app_id`/`aud` = deploy application anchor; `permission_scope` = caller scopes ∩ installation `access_permissions`; `organization_id` from the installation; `ownership_scope` from the installation; `environment` claim from the lifecycle; **1 h** TTL; session persisted | 500 |
| 11 | Audit | one `iam_audit_event` (`iam.app_access_token.created`); failure refuses to disclose the token | 500 |
| 12 | Response | `201` `data.item` = `IamAppAccessToken` | — |

Invariants of the issued credential:

- it names the deployment (`app_id`/`aud` = anchor), never the IAM runtime app id;
- its permissions are the intersection above, so it can never exceed the caller;
- `USER` credentials are issued to the owner's user id and nobody else's;
- it cannot mint further credentials, register or provision installations, or read another
  application's credential. Chaining is prevented by the permission intersection: an installation
  `MUST NOT` list `iam.app_tokens.create` or `iam.app_tokens.admin` in its
  `backend.accessTokenPermissionScope`, so no credential it issues can satisfy step 1 of §8.8;
- it is revocable as a session and expires in one hour; callers should cache until `expiresAt`.

Regression entry points (implementation):

| Concern | Where |
| --- | --- |
| capability/entitlement matrix, scope declaration, environment choice | `sdkwork-iam-web-adapter/src/app_token_exchange.rs` |
| installation resolution, issuance, signing-key and session persistence | `sdkwork-iam-web-adapter/src/access_token_issue.rs` |
| route capability + auth mode | `sdkwork-routes-iam-app-api/src/manifest.rs` |
| session guard, throttle, HTTP mapping | `sdkwork-routes-iam-app-api/src/handlers.rs` |
| deploy-side selector resolution and exchange | `sdkwork-deployments/crates/sdkwork-deploy-app-token` |
