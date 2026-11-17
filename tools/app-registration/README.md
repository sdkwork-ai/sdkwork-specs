# Application registration into Deploy + IAM

Registers every application root of the SDKWork workspace into the Deploy module
and IAM, wires each lifecycle as an IAM installation-environment row, and hands
the returned deploy-application anchor to the client-env materializers so every
profile's public application token carries it.

```text
sdkwork-specs/tools/register-applications.mjs            CLI entrypoint
sdkwork-specs/tools/app-registration/
  inventory.mjs                 workspace scan -> registration inventory
  contract.mjs                  identities, domains, deterministic keys, fail-closed settings
  http-fingerprint.mjs          X-Content-SHA256 body digest + Retry-After parsing
  deploy-client.mjs             Deploy app-api client (list / retrieve / create)
  iam-client.mjs                IAM bootstrap-body client + installation-environment client
  env-anchor.mjs                anchor read/write for env configuration
  register.mjs                  sequence, retry, concurrency, verification, environment hand-off
  tests/                        node --test suites + loopback Deploy/IAM fake
```

## Identity model

| Value | Where it comes from | Used for |
| --- | --- | --- |
| deploy application `id` (decimal) | `AppResponse.deployApplicationId` (int64 string), the anchor; value is `deploy_app.id` | `iam_tenant_application.deploy_application_id`, token `app_id`/`aud`, `SDKWORK_DEPLOY_APPLICATION_ID` |
| deploy application `uuid` | `AppResponse.id`, the addressable id | `GET/PATCH /app/v3/api/apps/{appId}`, registrar bookkeeping |
| slug | `app.key` (fallback `app.name`, then the directory) | `apps.create`, `uk_deploy_app_tenant_slug` |
| environment key | lifecycle name (`development`, `production`, ...) | `iam_application_installation_environment.env_key` |
| primary domain | `--primary-domain` pattern, then manifest sources (below) | installation + environment `primary_domain` |

The two deploy identifiers are different facts and are recorded separately in
every result (`deployApplicationId`, `deployApplicationUuid`). Both are read from
the same response row: `sdkwork-deployments` commit `7471031` made
`AppResponse.deployApplicationId` a required int64-string field on `apps.list`,
`apps.retrieve`, `apps.create`, and `apps.update`, so the row the registrar just
created (or re-read) names its own anchor. The registrar validates it at the
client boundary and fails the item when the field is missing or not decimal; the
anchor is never synthesized from the slug, never taken from another surface, and
never silently substituted by the uuid.

## One installation, one row per lifecycle

A deploy application is **environment-independent** (`uk_deploy_app_tenant_slug`
is scoped by tenant, not by lifecycle) and IAM binds exactly one installation to
its anchor (`uk_iam_application_installation_deploy`, enforced by
`ensure_deploy_application_unclaimed`; `provision_tenant_application` reconciles
deploy-application-first). A lifecycle is therefore **not** a second installation
and **not** a second anchor:

- one repository → one deploy application → one anchor → one IAM installation;
- each lifecycle → one `iam_application_installation_environment` row under that
  installation (`env_key` + `primary_domain` + `env_status`), written through
  `PUT /backend/v3/api/iam/tenants/{tenantId}/applications/{installationId}/environments/{envKey}`.

Registering `development` and then `production` for the same repository keeps the
same deploy app, the same anchor, and the same installation, and adds one row per
lifecycle. `decide_installation_environment_access` then gates runtime token
issuance: once an installation has any row, an unregistered environment fails
closed, and a row that is not `active` blocks issuance. Enabling an installation
whose row could not be written would therefore publish an installation no request
of that lifecycle can use — the registrar writes the row **before** enable.

Several manifest roots that resolve to one deploy slug are one installation and
one row: the upsert is cached per `(installation, env_key)` in a run, so a second
surface awaits the first write instead of creating a duplicate.

## Primary domain

IAM enable refuses an installation whose `primary_domain` is blank
(`409 primaryDomain must be configured`), and the environment row stores a domain
too, so a domain is a **provisioning input**. Sources, highest precedence first:

1. `--primary-domain <pattern>` — `{env}` expands to the lifecycle and `{slug}` to
   the deploy slug, e.g. `--primary-domain '{slug}.{env}.sdkwork.com'`. Any other
   `{token}` is refused.
2. `environments.<environment>.accessUrl` (the `<env>` alias section too).
3. `environments.<environment>.deployUrl`.
4. `backend.primaryDomain`.
5. `backend.domain`.

Each value is normalized to the absolute hostname IAM stores: a URL's scheme,
port, path, query, and userinfo are stripped (`http://127.0.0.1:4734` → `127.0.0.1`),
the value is lowercased, a trailing dot is dropped, and every DNS label is
validated (1–63 characters, `[a-z0-9-]`, no wildcard, no whitespace, IPv6 literal
refused, 253 characters max). A value that is present but invalid fails the item
instead of falling through to a lower-precedence source. With **no** source at
all the item fails at plan time and names every source that was checked — it never
reaches Deploy or IAM.

IAM keeps `(tenant_id, primary_domain)` unique across live installation and
environment rows, so two applications cannot share one domain. Two items of one
run that assert the same domain on **different** deploy slugs both fail at plan
time with that fact named (a shared development ingress host is the usual cause),
instead of one of them losing a mid-batch `409` based on completion order.

## Sequence per application × environment

1. **Plan** — slug, application type (`app.appType` → `h5|pc|flutter|api|other`),
   manifest permission scope, primary domain, deterministic keys, anchor sinks. A
   plan defect (no slug, no application type, no permission scope, no domain
   source, duplicate domain) is a recorded failure, not a skip.
2. **Deploy ensure** — `GET /app/v3/api/apps?keyword=<slug>` and an exact slug
   comparison; when absent, `POST /app/v3/api/apps` with
   `Idempotency-Key: sdkwork-app-register:<environment>:<slug>` **and**
   `X-Content-SHA256: sha256(request body bytes)`. A `409` slug conflict re-reads
   the row and adopts it.
3. **Anchor** — the anchor recorded in the app's own env configuration, then an
   explicit `--anchor-map` entry, then `AppResponse.deployApplicationId` from the
   row the deploy ensure step returned (create, list, or retrieve); with
   `--anchor-kind=deploy-application-uuid` the addressable uuid replaces the
   response field. A response without the field, or with a non-decimal value, is
   a failure, and two disagreeing sources abort the item.
4. **IAM provision** — `POST /backend/v3/api/iam/tenant_applications` with the
   anchor, the deterministic `provisioningIdempotencyKey`
   (`iam-bootstrap-<sha256(...)[0..40]>`, byte-compatible with
   `@sdkwork/iam-application-bootstrap`), the application type, the instance key
   derived from the anchor, the manifest permission scope, and the resolved
   `primaryDomain`.
5. **Environment row** — `PUT .../environments/{envKey}` with `primaryDomain` +
   `envStatus: active`, a deterministic
   `Idempotency-Key: sdkwork-app-register:env:<tenant>:<installation>:<envKey>`,
   and the same `X-Content-SHA256` digest. The PUT is the IAM upsert keyed by
   `(installation_id, env_key)`, so a repeated run rewrites the row in place.
6. **Enable + verify** — `.../{id}/enable` runs only after the row is `active`.
   The installation must report `enabled` and echo the same anchor; a response
   that cannot prove the binding is refused unless
   `--allow-unverified-iam-binding` is passed explicitly.
7. **Hand-off** — `SDKWORK_DEPLOY_APPLICATION_ID` (plus
   `SDKWORK_DEPLOY_APPLICATION_UUID` bookkeeping) is written into every authored
   env layer of the lifecycle: `etc/topology/overrides/<profile>.<environment>.env`
   for each deployment profile that declares one, else an authored
   `.env.<environment>`/`.env`. Generated
   `etc/topology/<profile>.<environment>.env` files are never hand-edited; they
   are regenerated by `materialize-topology-env.mjs`. Then
   `materialize-client-env.mjs --environment <environment>` runs with the anchor in
   its environment, so both profiles of *that* lifecycle carry `app_id`/`aud` =
   anchor. Other lifecycles share the same anchor through their own rows and
   their own materialization run.

## Usage

```sh
# Scan only (writes nothing, needs no credentials)
node sdkwork-specs/tools/register-applications.mjs --inventory inventory.json

# Plan only (no request, no write)
node sdkwork-specs/tools/register-applications.mjs \
  --environment development --dry-run --report plan.development.json

# Register one lifecycle, deriving a unique domain per application
node sdkwork-specs/tools/register-applications.mjs \
  --environment production --primary-domain '{slug}.{env}.sdkwork.com' \
  --report report.production.json

# One application, with an explicit anchor
node sdkwork-specs/tools/register-applications.mjs \
  --environment development --only sdkwork-im --anchor-map anchors.json
```

Required environment when not running `--dry-run`/`--inventory` (every missing
value is named before anything is attempted):

```text
SDKWORK_DEPLOY_BACKEND_API_BASE_URL      Deploy app-api origin
SDKWORK_DEPLOY_BACKEND_ACCESS_TOKEN      Deploy Access-Token
SDKWORK_DEPLOY_BACKEND_AUTH_TOKEN        Deploy Bearer auth token
SDKWORK_IAM_BACKEND_API_BASE_URL         IAM backend origin (alias: SDKWORK_BACKEND_BASE_URL)
SDKWORK_IAM_BOOTSTRAP_OPERATOR_AUTH_TOKEN, or
SDKWORK_IAM_BOOTSTRAP_OPERATOR_USERNAME + SDKWORK_IAM_BOOTSTRAP_OPERATOR_PASSWORD
SDKWORK_TENANT_ID / SDKWORK_ORGANIZATION_ID   optional tenant scope (manifest otherwise)
```

The installation-environment route is `dual-token`, unlike the bootstrap-body
provision/enable routes, so the client authenticates it as follows:

1. `SDKWORK_IAM_MANAGEMENT_ACCESS_TOKEN` + `SDKWORK_IAM_MANAGEMENT_AUTH_TOKEN`
   (aliases `SDKWORK_IAM_BACKEND_ACCESS_TOKEN` / `SDKWORK_IAM_BACKEND_AUTH_TOKEN`);
2. otherwise a session minted once per run from the operator username + password
   through `POST /app/v3/api/auth/sessions`;
3. otherwise the item fails closed naming those variables — the registrar will
   not enable an installation whose environment row it cannot write.
   `--no-register-environments` is the explicit downgrade path (it enables the
   installation without the row and marks the item `skipped`).

Exit codes: `0` every selected item created or reused and the hand-off succeeded,
`1` at least one failure (count reported), `2` unusable configuration, `3` no
application matched the selection.

## Selection scope

`--scope repository` (default) registers one application per repository: the
repository-root manifest when it exists, otherwise the first surface manifest.
This is the granularity the token pipeline supports — `materialize-client-env.mjs`
resolves `appIdEnv` for every declared surface from the same process environment,
so one repository carries one deploy anchor. `--scope all` (or `surfaces`)
registers every manifest root; surfaces that resolve to one installation share
one environment row, while a repository whose surfaces then need several anchors
is reported as a materializer conflict instead of silently baking the last anchor
over the others.

## Idempotency, retries, and failure semantics

- `apps.create` keys are deterministic per environment and slug; a retry after a
  timeout or a 5xx replays the first row.
- **Every body-carrying command sends `X-Content-SHA256`** (lowercase hex SHA-256
  of the exact bytes sent) alongside `Idempotency-Key`. The framework idempotency
  interceptor refuses a command with a body that omits
  `X-Content-SHA256`/`X-Idempotency-Fingerprint`
  (`requests with a body must include X-Content-SHA256 ...`), so the key alone is
  not a valid request.
- The environment upsert is keyed by the row identity, so several surfaces of one
  installation converge on one row and a repeated run rewrites it.
- `tenantApplications.create` reconciles on `deployApplicationId`; the
  provisioning key is deterministic, so re-runs converge on one installation.
- Retries are bounded (`--retries`, default 5 attempts). A `429` waits at least
  the `Retry-After` the server announced, otherwise the delay doubles per attempt
  (base `--retry-delay`, default 500 ms), plus up to 25% jitter so a throttled
  batch does not retry in lockstep.
- Items are registered with bounded concurrency (`--concurrency`, default 2,
  1..8); a full workspace is 80+ applications and the backend rate limiter trips
  when they are fired at once. Results keep the plan order.
- Every item ends as `created`, `reused`, or `failed`; a failed item carries a
  diagnostic naming the route, the status, and the variable to fix.
- Writing an unchanged anchor leaves the env file byte-identical, so a repeated
  run produces no diff.

## Verification

```sh
node --test "sdkwork-specs/tools/app-registration/tests/*.test.mjs"
```

The suites cover created/reused/failure-retry flows against a loopback fake of
both HTTP surfaces (which enforces the real idempotency rules: `Idempotency-Key`,
`X-Content-SHA256` presence, and digest match), the anchor being read from the
created and the reused deploy response, refusal of a response whose
`deployApplicationId` is missing or not decimal, deterministic idempotency keys
(including a framework known-vector for the provisioning key), anchor conflict
refusal, unverified binding refusal, dry-run isolation, env-file write
idempotency, the inventory scan and its domain sources, one installation across
two lifecycles with one row each, the environment row being written before
enable, plan-time refusal of a missing/duplicate/invalid domain, `--primary-domain`
placeholder expansion, per-installation row deduplication, `Retry-After`-aware
retry, and the dual-token-credential failure path.

## Known contract gaps

- The anchor depends on `AppResponse.deployApplicationId`
  (`sdkwork-deployments` commit `7471031`). A deploy build that predates it, or
  any response that omits the field or returns a non-decimal value, fails the
  item closed: the registrar never substitutes the uuid or a slug. `--anchor-map
  <file>` is the retained downgrade path for such a deployment (or for pinning an
  anchor deliberately) — it supplies the decimal id the API cannot, and a run
  still fails if the map and the response disagree.
- `--anchor-kind=deploy-application-uuid` remains available for a deployment that
  binds the uuid on purpose. It does not relax the wire check: the app response
  must still carry `deployApplicationId`, because the app-api contract marks it
  required on every app response.
- `GET /backend/v3/api/iam/tenant_applications/{id}` needs dual-token credentials,
  so binding verification uses the provision/enable response. An IAM build that
  does not echo `deployApplicationId` fails verification until
  `--allow-unverified-iam-binding` is chosen deliberately.
- The environment row's `primary_domain` is validated locally against the DNS
  hostname shape IAM accepts; an installation environment that is already
  registered to another environment of the tenant is still refused by IAM with
  `409` naming the conflicting environment. The plan-time duplicate check only
  covers the items of one run.
