# Authorization State Specification

> Canonical SDKWork standard for how authenticated principals obtain authorization:
> request-time resolution, versioned session snapshots, and cache rules.

## Scope

This spec defines:

- The separation between an authentication credential and authorization state.
- Why an authorization snapshot may be cached in a session, and how it stays current.
- The authorization epoch contract and where it must be advanced.
- Wildcard grant semantics at evaluation time.
- Cache keys, TTL bounds, tenant isolation, and fail-closed behavior.
- Performance budgets for request-time authorization at platform scale.
- Mandatory conformance tests and prohibited implementations.

Related specs: `PERMISSION_STANDARD_SPEC.md`, `IAM_SPEC.md` §7,
`IAM_RBAC_FEDERATION_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `SECURITY_SPEC.md`,
`DATABASE_FRAMEWORK_SPEC.md`.

## 1. The Failure This Spec Prevents

A login-time permission snapshot — copying every effective permission code into
the session row or access token — looks cheap but couples authorization to
authentication. It produces three defects that grow with the platform:

| Defect | Symptom |
| --- | --- |
| Feature coupling | Shipping a new module or permission code reaches only sessions created after the deploy; every existing user is denied until they log out and back in. |
| Revocation lag | A revoked role binding or permission stays effective until the session expires, so a compromised or departed principal keeps access. |
| Scale cost | Expanding wildcards against the full catalog makes every token/session O(catalog size); the catalog grows with every module, so login cost and token size grow without bound. |

Observed production instance: a platform module whose permission catalog was
materialized after a user signed in returned `403 Permission denied` for every
module route on that session, with no path to recovery except re-login.

## 2. Definitions

| Term | Meaning |
| --- | --- |
| Credential | Bearer/dual token proving identity and session validity. Authentication artifact only. |
| Authorization state | The effective grant set for a principal in a tenant/organization context: role bindings, role grants, catalog entries, exclusions. |
| Snapshot | A materialized `permission_scope` / `data_scope` copy cached in a session or token. |
| Authorization epoch | A monotonically advancing integer that changes on every write to authorization state. |
| Pattern | A grant expressed in the permission grammar: exact code, `*`, `{domain}.*`, or `*.{action}`. |

## 3. Rules

### 3.1 The credential is never the authority

- Credentials and session rows `MUST NOT` be treated as the authoritative source
  of permissions. They `MAY` carry an identity, tenant/organization context,
  and an authorization-epoch marker only.
- Local session JWTs `MUST NOT` embed the expanded `permission_scope`. A token
  whose size grows with the permission catalog violates this spec.
- A snapshot stored on the session row `MUST` be treated as a cache with a
  version, never as a frozen grant.

### 3.2 Authorization is resolved from current state

- Every protected request `MUST` authorize against authorization state at least
  as current as the request's authorization epoch check.
- Resolution `MUST` be server-side. A client-supplied permission list or scope
  header is evidence of a client preference, never a grant, unless it was
  produced by a trusted component in the same process from current state.
- Authorization decisions `MUST` fail closed: resolution, session load, or epoch
  read failure denies the operation rather than allowing it.

### 3.3 Authorization epoch

- The platform `MUST` maintain an authorization epoch that advances on every
  write to authorization state, including deletes:
  - role binding create/update/delete/status change,
  - role permission grant/revoke/update,
  - permission catalog insert/update/delete,
  - role insert/update/delete,
  - role exclusion create/update/delete,
  - catalog materialization completion.
- Advancement `MUST` be enforced by the persistence layer (database triggers or
  an equivalent write-path invariant), not by remembering to call a service
  function from each handler. An application-level bump that can be forgotten
  does not satisfy this rule.
- The epoch `MUST` be monotonic and shared by every instance serving the tenant.
- Snapshots record the epoch they were derived from. A snapshot with an older
  epoch, or no epoch, `MUST` be re-resolved before it authorizes a request.

### 3.4 Refresh without re-authentication

- A stale snapshot `MUST` be refreshed in place from current authorization
  state. The credential, session token, and user-agent session `MUST` remain
  valid across the refresh.
- Refreshing `MUST NOT` require the user to log out, re-login, or re-consent.
- Adding a permission code or a whole module catalog `MUST NOT` require any
  client or user action.
- A refresh `MUST NOT` widen authority beyond current state (never merge old and
  new grants; replace).
- Refresh `MUST` be idempotent and safe to repeat per request.

### 3.5 Wildcard grants are evaluated, not pre-expanded

- Grant patterns `MUST` be stored and evaluated with the platform grammar
  (`*`, `{domain}.*`, `*.{action}`, exact code) per
  `PERMISSION_STANDARD_SPEC.md`.
- `MUST NOT` pre-expand `*` into a fixed list of catalog codes as the
  authorization source. Pre-expansion turns every new catalog code into a
  missing grant.
- The catalog is a registry of usable codes, not a grant. A pattern authorizes a
  code whether or not the catalog entry existed when the session was created.
- Every enforcement point `MUST` use the shared wildcard-aware matcher. Literal
  string equality against grant codes is prohibited for authorization.

### 3.6 Cache rules

- Authorization caches `MUST` be keyed by `(tenant_id, principal/session id,
  epoch)` so a bump invalidates them without a broadcast.
- Cache TTL `MUST` be bounded and `MUST NOT` exceed 300 seconds; the reference
  bound is 5 seconds for in-process scope caches.
- Caches `MUST` be tenant-isolated. A cross-tenant key reuse is a critical defect.
- Cache capacity `MUST` be bounded, and overflow `MUST` evict rather than grow
  without limit.
- A cache miss `MUST` resolve from authoritative state, not from another cache
  layer whose freshness cannot be proven.

### 3.7 Revocation and least privilege

- Revoking a grant or binding `MUST` take effect by the principal's next
  authorized request, bounded by the cache TTL.
- Widening `MUST` also be effective without re-login.
- Service accounts, API keys, and OAuth access tokens `MUST` keep their declared
  narrower scope; a general session refresh `MUST NOT` apply to credentials
  whose scope was deliberately intersected or narrowed.

### 3.8 Multi-instance and scale

- The epoch and authorization state are shared state; instances `MUST NOT` rely
  on in-memory agreement for correctness.
- Steady state (no epoch advance) `MUST NOT` add a database round trip per
  request. The reference implementation folds one indexed single-row epoch read
  into the session query that already runs.
- An epoch advance `MUST` cost at most one re-resolution per session, not per
  request, and `MUST` not synchronize the fleet.
- A module manifest shipped in the bundle `MUST` be materialized without editing
  a hand-maintained enable list; `optionalModules` is the only opt-out. A module
  whose routes the application serves `MUST NOT` stay optional
  (`IAM_MODULE_MANIFEST_SPEC.md` section 1).

### 3.9 Declared route permissions are enforced

- A route manifest that declares a required permission `MUST` produce an
  enforced route guard. A code generator that renders routes from a manifest
  `MUST` propagate `auth.permission`; dropping it turns a permission-gated
  route into an authentication-only route and is an authorization bypass.
- Enforcement `MUST` use the shared matcher (3.5) so a `*` or `{domain}.*`
  grant does not require catalog pre-expansion.
- Verification: `node tools/check-permission-guard-standard.mjs --workspace
  <space-root>` fails a generator that drops the declared permission.

## 4. Performance Budget

| Operation | Budget |
| --- | --- |
| Authorized request, steady state | No additional round trip beyond session load; O(1) epoch comparison; O(1) matcher call per required code |
| Token size | Independent of catalog size |
| Refresh after epoch advance | One scope resolution + one session update per session, once |
| Memory | Bounded cache entries; snapshot size bounded by grant count, not catalog size |

## 5. Prohibited Implementations

- Writing an expanded permission list into a JWT or an immutable session field.
- Computing grants once at login and reusing them until session expiry.
- Bumping the epoch from application handlers only.
- Exact-string permission comparison in any enforcement point.
- A refresh path that requires re-authentication.
- A cache whose key omits the tenant or the epoch.
- Treating a client header as a grant.

## 6. Conformance Tests (Required)

Implementations `MUST` provide automated coverage for:

1. **New permission without re-login** — create a session, add a permission code
   to the catalog and grant it to the session's role, advance the epoch, and
   assert the existing token authorizes the new code.
2. **Revocation without expiry** — revoke a granted code or binding with the same
   token still valid, and assert the next request is denied.
3. **Wildcard evaluation** — `*`, `{domain}.*`, `*.{action}` authorize matching
   codes; exact codes stay literal.
4. **Token shape** — local session tokens do not carry an expanded permission
   list.
5. **Epoch advancement** — insert, update, and delete on each authorization-state
   table advances the epoch.
6. **Fail closed** — a failed resolution or epoch read denies.

## 7. Reference Implementation

`sdkwork-iam`:

- `database/ddl/baseline/postgres/0001_iam_baseline.sql` and
  `database/migrations/postgres/0030_iam_authz_epoch.up.sql` define
  `iam_authz_epoch`, `iam_session.authz_epoch`, and the statement triggers that
  advance the epoch.
- `crates/sdkwork-iam-web-adapter/src/iam_session.rs` folds the epoch into the
  session read and re-resolves a stale snapshot through
  `refresh_session_authorization_if_stale`.
- `crates/sdkwork-iam-context-service/src/permission_standard.rs` provides the
  wildcard matcher used by every enforcement point.
- `crates/sdkwork-web-framework/crates/sdkwork-web-core/src/request_context.rs`
  provides `permission_scope_matches_any` for host crates.

Enforcement: `node tools/check-authz-state-standard.mjs --root .` rejects a
workspace that reintroduces a login-time-only authorization snapshot or removes
the epoch contract.

Reachability: `node tools/audit-permission-reachability.mjs --workspace <root>
--fail-on-uncovered-enforced` fails when a route-enforced permission code has no
grant a non-break-glass role can hold; the same report lists catalogued codes
that only break-glass `*` can reach.

## 8. Reviewer Checklist

- Does the change add a permission code? Existing sessions must authorize it
  without a deploy-triggered re-login.
- Does the change revoke or narrow? The next request must reflect it.
- Is any new enforcement point comparing permission codes with `==` instead of
  the shared matcher?
- Is any cache key missing the tenant or the epoch?
- Does the epoch still advance for deletes, or only inserts?
- Is the token still identity-sized?
