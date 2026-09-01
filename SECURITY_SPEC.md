# Security Standard

- Version: 1.1
- Scope: authentication, authorization, token use, API/RPC security, frontend handling, logging, secrets
- Related: `SDKWORK_WORKSPACE_SPEC.md`, `API_SPEC.md`, `WEB_FRAMEWORK_SPEC.md`, `WEB_BACKEND_SPEC.md`, `DATABASE_SPEC.md`, `RPC_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, `SDK_SPEC.md`, `DRIVE_SPEC.md`, `IAM_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `OBSERVABILITY_SPEC.md`, `TEST_SPEC.md`

Security is a cross-cutting requirement. It must be enforced by backend services and reflected in OpenAPI contracts, SDK behavior, frontend service boundaries, and tests.

## 1. Authentication And Tokens

Rules:

- Every HTTP operation `MUST` use exactly one authentication profile declared by its route manifest and OpenAPI contract. Protected app-api and backend-api operations require `dual-token`; protected open-api operations require `api-key`, `oauth`, `open-api-flexible`, or `api-key-or-dual-token`; pre-session credential-entry uses `credential-entry-bootstrap`; refresh uses `refresh-token`; internal/agent operations use their explicit profile. Credential presence must never change the declared profile.
- Protected RPC methods `MUST` require the equivalent `authorization` and `access-token` metadata unless the method is explicitly public or internal mTLS-only.
- Application login/session integration, AuthGate behavior, generated SDK token wiring, logout clearing, and Rust AppContext validation `MUST` follow `IAM_LOGIN_INTEGRATION_SPEC.md`.
- Public endpoints `MUST` explicitly declare `security: []` and `x-sdkwork-auth-mode: anonymous`, and generated SDKs `MUST` skip every automatic credential for those operations. Credential-entry endpoints are not anonymous: they require only bootstrap `AccessToken` and use `x-sdkwork-auth-mode: credential-entry-bootstrap`.
- Tokens `MUST` be signed or resolved through a trusted server-side session store.
- Token expiry, revocation, rotation, and audience checks are mandatory for production.
- SDKWork login/session creation starts without a user session but requires an application bootstrap access JWT for tenant/app isolation. Login requests `MUST NOT` use session, API-key, OAuth, ingress/agent, or SDKWork context-projection credentials as authenticated context or tenant/organization selectors. Login, registration, OAuth session creation, QR auth credential-entry, and password reset commands `MUST` use `credential-entry-bootstrap`, declare `x-sdkwork-forbid-credential-headers: true`, and reject every non-profile credential with a standard error.
- Login success, registration success, OAuth/session-bridge completion, QR completion, refresh, and current-session bootstrap `MUST NOT` be mocked or synthesized from user/profile data, cached users, user ids, emails, usernames, QR keys, bridge hints, or legacy session identifiers. SDKWork app/backend authenticated state requires a validated appbase IAM session with non-empty `authToken` and `accessToken`; incomplete or user-only results fail closed.
- Login success `MUST` resolve tenant and organization context from real IAM data: the authenticated user tenant binding and active organization memberships. It `MUST NOT` use demo tenants, hard-coded tenants, email-normalized ids, request payload tenant fields, or context headers as substitutes.
- Multi-organization login `MUST` return a short-lived organization-selection continuation state and `MUST NOT` issue normal business tokens until the selected organization membership is validated.
- Current-session bootstrap `MUST` validate stored dual-token state through the appbase current-session SDK resource when available. A failed or incomplete current-session validation clears local session/token/context state and remains anonymous; cached tokens or profiles are not sufficient to report authenticated state.
- Registration and password-reset services `MUST NOT` synthesize a missing confirmation by copying the password into `confirmPassword`; they `MUST` reject explicitly mismatched password confirmation values before calling SDK resources, and backend handlers `MUST` enforce the same rule.
- Development verification-code values may prefill UI fields only. They `MUST NOT` bypass SDK verification, challenge creation, session creation, registration creation, or password reset completion.
- Tokens and secrets `MUST NOT` be logged.
- Protected open-api requests `MUST` resolve API keys through a server-side API key lookup service when the route declares `api-key` or flexible mode selects API key. The API key record, not the raw submitted key alone, supplies tenant, organization, user, app, data scope, and permission scope.
- Protected open-api requests `MUST` resolve OAuth bearer tokens through a server-side OAuth token lookup service when the route declares `oauth` or flexible mode selects OAuth bearer. Verified token/session metadata, not the raw bearer value alone, supplies tenant, organization, user, app, data scope, and permission scope.
- Protected open-api requests using `api-key-or-dual-token` `MUST` accept only an API key alone or a complete matching auth/access token pair. API key/token mixtures and incomplete token pairs are credential contamination and `MUST` be rejected before authentication or business logic. The dual-token branch uses the same signature, claim-consistency, tenant/app isolation, expiry, revocation, and scope validation required by `dual-token`.
- API key and OAuth bearer lookup implementations `MUST` support different storage backends through service boundaries. The standard may use IAM tables, tenant-local stores, encrypted secret stores, caches, or remote IAM services.
- Web backend handlers, controller methods, services, repositories, and provider adapters `MUST` follow `WEB_BACKEND_SPEC.md`: they consume typed request context and must not reparse raw credential headers after framework context resolution.

## 1.0.1 RPC SDK Metadata Security

Generated RPC SDK security follows `RPC_SPEC.md`, `RPC_SDK_WORKSPACE_SPEC.md`, and
`SDK_SPEC.md`.

Rules:

- Generated RPC SDK clients MUST support SDKWork metadata providers for `authorization`, `access-token`, `traceparent`, `idempotency-key`, and `x-request-hash`.
- Application and backend code MUST inject metadata providers through SDK/bootstrap infrastructure instead of assembling raw RPC metadata in business modules.
- RPC SDK examples for protected methods MUST show metadata provider setup, not hard-coded tokens.
- Public reflection, health, and gRPC-Web endpoints MUST be protected by deployment policy; production reflection requires access control or an explicit governance exception.
- mTLS requirements MUST be documented in the RPC SDK README and enforced by runtime/bootstrap configuration when the deployment policy requires client certificates.

## 1.1 Tenant-Bound Token Signing

Tenant isolation requires tenant-bound signing or an equivalent server-side validation model.

Rules:

- Production and production-like deployments `MUST NOT` sign all tenant tokens with one shared global secret.
- Every token signing key or secret `MUST` belong to exactly one tenant. Token validation `MUST` prove that the key used for verification belongs to the same `tenant_id` carried by the verified claims.
- JWT headers `SHOULD` carry `kid`. Key lookup by `kid` `MUST` resolve to tenant-bound signing metadata before claim authorization decisions are made.
- If a token's verified `tenant_id`, key tenant binding, session tenant binding, or request context tenant disagree, the request `MUST` fail closed.
- Both `authToken` and `accessToken` `MUST` include `tenant_id`, `organization_id`, `login_scope`, `user_id`, and `session_id` claims or resolve those values through a trusted server-side token/session lookup.
- `login_scope` and `organization_id` `MUST` be internally consistent: personal sessions use `login_scope = TENANT` with `organization_id = 0` or absent; organization sessions use `login_scope = ORGANIZATION` with a non-zero organization id.
- Backend API requests `MUST` accept both organization sessions and personal tenant sessions (`login_scope = TENANT` with `organization_id = 0` or absent). Authorization `MUST` continue to require an authenticated principal and per-route permission checks (or an equivalent host-level admin boundary) before handler logic runs; a personal tenant session alone `MUST NOT` grant backend API access.
- Tenant signing material `MUST` be encrypted or managed by an approved secret manager/KMS, rotated, revocable, and excluded from logs, generated SDK output, public runtime config, and frontend bundles.

## 2. Authorization

Rules:

- Server-side authorization `MUST` be enforced for every protected operation.
- Permission checks `MUST` include tenant and organization context.
- Object-level authorization `MUST` be checked before returning or mutating tenant data.
- Admin/backend APIs `MUST` use least privilege and audit sensitive operations.
- Service/use-case code `MUST` enforce business authorization before repository access returns tenant-owned data. Router middleware and UI permission hints are not sufficient.
- Repositories `MUST` receive tenant, organization, owner, and data-scope inputs from typed context or explicit service parameters; they `MUST NOT` infer authorization from global request state.
- Ordinary repository access to organization-scoped data `MUST` fail closed unless both tenant and organization scope are present in trusted typed context and bound by the database operation according to `DATABASE_SPEC.md` section 16.
- Cross-organization system operations are privileged security surfaces. They `MUST` use an explicit service/worker capability or administrative authorization, a fixed bounded operation contract, least-privilege credentials, and an audit record or security-grade operational event that identifies the operation, caller identity, scope, outcome, and trace id.
- Comments, markers, feature flags, route hiding, and background execution do not authorize cross-organization access. Unknown or undeclared operations `MUST` fail closed before database access.

## 3. Input And Output Safety

Rules:

- OpenAPI schemas `MUST` declare required fields, lengths, enum values, and formats.
- Server validation `MUST` reject unknown dangerous inputs and invalid state transitions.
- Responses `MUST` exclude password hashes, token secrets, private keys, internal hostnames, SQL, stack traces, and internal implementation details.
- File upload APIs `MUST` be Drive-backed for SDKWork-owned storage and define size, type, scanning, retention, checksum, grant expiry, and access rules through `DRIVE_SPEC.md`.

## 4. Browser And Frontend Safety

Rules:

- Frontend modules `MUST NOT` manually assemble auth headers except in SDK/bootstrap infrastructure.
- Appbase IAM auth UI/runtime and generated app SDK bootstrap own browser login/session token flow; product UI must not duplicate it.
- Credential-entry wrappers `MUST` fail before network dispatch when bootstrap credentials are absent. Browser bootstrap credentials may be injected only through the lifecycle- and environment-governed private handoff in `IAM_CREDENTIAL_ENTRY_SPEC.md`; they must never use public runtime env or production artifacts.
- Sensitive tokens `SHOULD` be stored in secure host storage where available.
- CORS `MUST` be explicit and environment-specific. SDKWork development/test runtimes `MAY`
  enable the shared Web Framework private-network origin policy for dynamic LAN addresses;
  application-local subnet matchers and copied CORS middleware are forbidden. Production
  runtimes `MUST` reject that development policy and use exact origin allowlists. Registered
  first-party client origins (`WEB_FRAMEWORK_SPEC.md` §12) are merged by runtime assembly in
  every environment, and the `open-api` surface is exempt from CORS and cross-site validation
  because it serves non-browser SDK and server-to-server callers.
- CSRF protection is required for cookie-authenticated browser flows.
- UI permission checks do not replace backend authorization.

## 5. Abuse Protection

Rules:

- Login, verification, password reset, token refresh, and sensitive commands `MUST` be rate limited.
- Mandatory-sensitive HTTP operations `MUST` declare `x-sdkwork-rate-limit-tier` in authority OpenAPI and route metadata, and runtimes `MUST` enforce the matching framework policy. This includes login, registration, OAuth/QR session creation or completion, verification code send/check, password reset request/completion, token refresh, API key creation/rotation/revocation, credential binding, and high-risk mutation commands.
- Idempotency and replay protection `SHOULD` be applied to payment-like or retriable commands.
- Security events `MUST` be emitted for login failures, suspicious token use, permission changes, key creation, key revocation, and tenant changes.

## 5.1 SDKWork HTTP Framework Security Interceptor Baseline

All SDKWork HTTP frameworks for open-api, app-api, and backend-api `MUST` provide the following interceptor positions in the standard request chain. The standard Rust implementation is owned by `sdkwork-web-framework`; Java runtimes must preserve equivalent semantics according to `WEB_FRAMEWORK_SPEC.md`.

| Interceptor | Purpose | Baseline requirement |
| --- | --- | --- |
| Request identity | Generate server-owned request id. | Must overwrite client `X-Request-Id`. |
| Surface classification | Classify `open-api`, `app-api`, `backend-api`, or public path. | Must run before auth mode selection. |
| CORS | Enforce origin allowlist. | Must be explicit and environment-specific. |
| Method guard | Reject unsupported HTTP methods. | Should run before body parsing. |
| Cross-site request guard | Reject untrusted state-changing browser requests. | Required for browser-facing APIs. |
| SQL injection request guard | Block obvious injection probes in path/query/configured headers. | Defense-in-depth only; never replaces bind parameters. |
| Request size limit | Reject oversized requests before business logic. | Required for JSON APIs and stricter for upload/session endpoints. |
| Rate limit | Throttle abuse-sensitive operations. | Required for auth, key, verification, and mutation hot paths. |
| Idempotency | Enforce retry safety for commands. | Required for payment-like, purchase-like, and retryable mutation commands. |
| Request context resolution | Resolve `WebRequestContext`. | Required before protected handlers. |
| Authentication | Verify required credential mode is present and valid. | Required for protected surfaces. |
| Authorization | Enforce permission and policy decisions. | Required for every protected operation. |
| Tenant isolation | Enforce tenant, organization, owner, and data-scope boundaries. | Required before data access. |
| Context injection | Inject typed context for handlers/services. | Required; handlers must not reparse credentials. |
| Logging | Emit structured, redacted operational logs. | Must not log raw tokens, API keys, passwords, or payload secrets. |
| Audit | Emit business/security audit facts. | Required for IAM, key, tenant, billing, permission, and admin changes. |
| Header security | Apply secure response headers. | Must include `nosniff`, frame protection, referrer policy, and permissions policy where supported. |
| Response identity | Return server-owned request id. | Required for success and problem responses where possible. |

Rules:

- Security interceptors `MUST` be framework-owned or registered in the standard call chain. Business handlers `MUST NOT` implement ad hoc replacements for shared security policy.
- Business handlers and services `MUST NOT` parse `Authorization`, `Access-Token`, `X-API-Key`, request IDs, tenant IDs, organization IDs, user IDs, or permission scopes from raw headers. They consume the typed context injected by this chain.
- SQL injection guards are heuristic request filters. All database access `MUST` still use bind parameters or query builders that bind values, and raw SQL string concatenation with user input is forbidden.
- CORS and cross-site request protection are separate controls. Passing CORS does not replace authorization, CSRF protection for cookie flows, or tenant isolation.
- Rate-limit and idempotency implementations must use bounded keys that do not expose raw tokens, API keys, passwords, or PII.
- Idempotency interceptors `MUST` reject missing, empty, or greater-than-128-byte `Idempotency-Key` values before store access, hash or otherwise scope raw client keys before persistence, and redact raw keys from logs and metrics.
- Production high-availability runtimes `MUST` use a shared durable idempotency store with atomic reserve/replay/conflict behavior. Process-local memory stores are limited to development, tests, and explicitly standalone non-HA profiles.

## 6. Secure Logging

Rules:

- Logs `MUST` include correlation IDs and tenant context where safe.
- Logs `MUST NOT` contain secrets, passwords, raw tokens, verification codes, or full private payloads.
- Audit logs `MUST` be append-oriented and tamper-resistant for L3 domains.

## 6.1 Repository Workspace Safety

The source-controlled repository/application `.sdkwork/` workspace is governed by
`SDKWORK_WORKSPACE_SPEC.md` and is reviewed as source.

Rules:

- `.sdkwork/skills/`, `.sdkwork/plugins/`, approved manifests, and their README files may be
  committed when they contain reusable development knowledge only.
- `.sdkwork/local/`, `.sdkwork/tmp/`, `.sdkwork/cache/`, `.sdkwork/secrets/`, local install state,
  runtime databases, logs, generated transient outputs, and secret-bearing files `MUST` be ignored.
- `.sdkwork/` `MUST NOT` contain API keys, auth tokens, passwords, private certificates, private
  keys, provider credentials, local user data, runtime database files, generated SDK transport
  output, or copied `~/.sdkwork/<application-code>` runtime state.
- Generated SDK output `.sdkwork/sdkwork-generator-*.json` files are valid only below generated SDK
  output and are not repository workspace secrets or skills.

## 7. Acceptance Checklist

- [ ] OpenAPI security declarations are explicit.
- [ ] RPC metadata auth declarations are explicit for every service method.
- [ ] Dual-token validation is enforced server-side.
- [ ] Credential-entry requests use only bootstrap `Access-Token`, reject session/context credential contamination, and resolve user/organization context from real IAM data.
- [ ] Anonymous SDK-generated operations skip every credential, while credential-entry SDKs inject bootstrap access only and fail before dispatch when it is missing.
- [ ] Tenant-bound token signing or equivalent server-side validation prevents cross-tenant token reuse.
- [ ] Multi-organization login uses a continuation challenge and validates selected membership before issuing business tokens.
- [ ] API key open-api validation resolves a server-side API key record before context injection.
- [ ] OAuth bearer open-api validation resolves a server-side token/session record before context injection.
- [ ] `api-key-or-dual-token` open-api validation accepts both valid branches and rejects API key/token mixtures, incomplete token pairs, and missing credentials before handler execution.
- [ ] Protected HTTP routers for open-api, app-api, and backend-api run the standard interceptor chain through `sdkwork-web-framework` (Rust) or an equivalent framework (Java), or a stricter documented superset.
- [ ] Generated RPC SDK clients support metadata providers for auth, access token, trace, idempotency, and request hash metadata.
- [ ] RPC SDK examples use metadata providers and do not hard-code live tokens.
- [ ] RPC reflection and mTLS exposure are controlled by deployment policy.
- [ ] Web backend handlers/services consume typed request context and do not reparse raw credential, tenant, user, permission, request-id, locale, or language headers.
- [ ] Organization-scoped repository paths bind trusted tenant and organization context, and negative tests reject either-scope mismatch.
- [ ] Every cross-organization system operation is independently authorized, bounded, audited, machine-inventoried, and unreachable from ordinary user/API repository paths.
- [ ] Tenant/object authorization is tested.
- [ ] Drive upload/download grants are short-lived, authorized, and do not leak provider credentials or signed URL material into logs.
- [ ] Sensitive fields are write-only or omitted.
- [ ] Rate limits exist for auth-sensitive paths.
- [ ] CORS, cross-site request protection, request size, method guard, SQL injection guard, secure response headers, audit, and logging are configured through framework interceptors.
- [ ] Logs redact sensitive data.
- [ ] Source-controlled `.sdkwork/` contains no secrets, runtime data, generated SDK transport output, or user-private files.
