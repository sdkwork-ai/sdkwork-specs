# IAM OAuth Standard

- Version: 1.0
- Scope: third-party OAuth consumption, SDKWork OAuth provider (authorization server), provider catalog, tenant integrations, relying-party clients, surfaces, grants, and client/runtime configuration
- Related: `IAM_SPEC.md`, `IAM_LOGIN_INTEGRATION_SPEC.md`, `IAM_APPLICATION_BOOTSTRAP_SPEC.md`, `INTEGRATION_SPEC.md`, `API_SPEC.md`, `CONFIG_SPEC.md`, `REGION_SPEC.md`, `SECURITY_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`

This standard defines the canonical OAuth model for SDKWork IAM. OAuth is an extension of IAM sessions, not a separate identity domain.

## 1. Roles

SDKWork IAM operates in two OAuth roles:

| Role | Meaning | Examples |
| --- | --- | --- |
| OAuth client (inbound login) | SDKWork consumes external identity providers to create IAM sessions | WeChat, Alipay, Douyin, Google, GitHub, Facebook |
| OAuth provider (outbound login) | External or sibling applications consume SDKWork as an identity provider | Third-party SaaS, SDKWork Portal → SDKWork Forum |

Rules:

- Both roles `MUST` converge on the same IAM session and token model for app login.
- Open-api OAuth bearer tokens `MUST` remain separate from app dual-token login sessions.
- Provider secrets, client secrets, refresh tokens, authorization codes, and PKCE verifiers `MUST` be write-only and never appear in response schemas, logs, or browser bundles.

## 2. Canonical Provider Catalog

The platform provider catalog lives in `iam_oauth_provider_catalog` and is seeded from the built-in catalog in `sdkwork-iam-web-adapter`.

Each catalog entry `MUST` declare:

- `provider_code`
- `protocol_family` (`oauth2`, `oidc`, `mini_program`, `sdkwork_oidc`)
- authorization, token, userinfo, discovery, revocation, and introspection endpoints when applicable
- supported surfaces, flow kinds, scopes, PKCE, refresh-token, and id-token capabilities

Built-in provider codes include at minimum:

- Mainland: `wechat`, `wechat_mini_program`, `wechat_open`, `alipay`, `douyin`, `qq`, `weibo`
- Overseas: `google`, `github`, `twitter`, `facebook`, `microsoft`, `apple`, `linkedin`, `line`, `tiktok`, `discord`
- Platform: `sdkwork`

Rules:

- New provider integrations `MUST` register in the catalog before tenant integrations are enabled.
- Tenant integrations `MUST` reference a catalog entry through `provider_catalog_id`.
- Provider-specific HTTP exchange logic `MUST` live in provider adapters under `sdkwork-iam-web-adapter`, not in application code.

## 3. Tenant Integration Model (OAuth Client Role)

Tenant operators configure inbound OAuth through backend-api resources:

| Resource | Purpose |
| --- | --- |
| `iam.oauth.integrations` | Enable a provider for a tenant/application/environment |
| `iam.oauth.clients` | Store provider-side client identifiers |
| `iam.oauth.secrets` | Store provider-side secrets by reference/hash |
| `iam.oauth.surfaces` | Register redirect URIs and platform-specific surface metadata |
| `iam.oauth.flowConfigs` | Configure scopes, PKCE, response types, grant types |
| `iam.oauth.claimMappings` | Map provider claims to IAM user identity fields |
| `iam.oauth.accountLinks` | Bind external subjects to IAM users |

App-api resources for end-user login:

| Resource | Purpose |
| --- | --- |
| `oauth.providers.list` | List enabled login providers for the tenant/app context |
| `oauth.authorizationUrls.create` | Create provider authorization URLs |
| `oauth.callbacks.*` | Handle provider callbacks |
| `oauth.sessions.create` | Exchange provider authorization results into IAM sessions |
| `oauth.miniProgramSessions.create` | Mini-program login exchange |
| `oauth.accountLinks.*` | Self-service account linking |

Rules:

- Redirect URIs `MUST` be validated against registered surfaces and allowed hosts.
- The login provider list is the intersection of enabled integrations, the account-binding `oauth_login.enabled`/`allowedProviders` policy, and the tenant-visible provider catalog. An operator-defined catalog row `MUST` be honored (and overrides built-in metadata for the same provider code); a provider enabled only in the built-in catalog but without an enabled integration `MUST NOT` be shown.
- Authorization state `MUST` be persisted in `iam_oauth_authorization_state` with expiry, PKCE binding, and one-time consumption semantics.
- OAuth login `MUST` respect tenant account-binding policy (`iam.account_binding`).
- OAuth auto-registration `MUST` be policy-controlled and fail closed when disabled.

## 4. SDKWork OAuth Provider (Authorization Server Role)

SDKWork exposes a first-party OAuth 2.1 authorization-code server through `sdkwork-iam-open-api`.

> Capability boundary: the server issues access/refresh tokens and supports authorization code + PKCE, token, refresh, revoke, introspect, userinfo, discovery, and JWKS. It does **not** issue an OIDC `id_token` and does not implement `nonce`, `prompt`, or `max_age`. A client that requires full OIDC MUST NOT be registered as a relying party until those capabilities are implemented; the desktop/browser SDKWork login uses the OAuth flow only.

### 4.1 Canonical Endpoints

| Endpoint | Method | Auth mode | Purpose |
| --- | --- | --- | --- |
| `/.well-known/openid-configuration` | GET | public | OIDC discovery |
| `/.well-known/oauth-authorization-server` | GET | public | OAuth metadata alias |
| `/iam/v3/oauth/authorize` | GET | public | Start authorization code flow |
| `/iam/v3/oauth/token` | POST | public | Exchange code or refresh token |
| `/iam/v3/oauth/userinfo` | GET | oauth | Return authorized subject profile |
| `/iam/v3/oauth/revoke` | POST | public | Revoke grant or token |
| `/iam/v3/oauth/introspect` | POST | public | Token introspection for confidential clients |

App-api endpoints for the hosted first-party login:

| Endpoint | Method | Auth mode | Purpose |
| --- | --- | --- | --- |
| `/app/v3/api/oauth/authorizations` | POST | public | Create the pending authorization state for the hosted login (the page creates the state, renders login in place, then completes it; no browser redirect to a login route) |
| `/app/v3/api/oauth/authorizations/{authorizationStateId}/completions` | POST | dual-token | Complete pending authorization after IAM login |
| `/app/v3/api/auth/sessions/current/logout` | POST | public | Revoke the current session with its refresh token; accepted without an access token so logout still revokes the server session after the access token expired |

Rules:

- Authorization requests `MUST` require PKCE for public clients.
- Confidential clients `MUST` authenticate at the token endpoint using `client_secret_post` or `client_secret_basic`.
- Authorization codes `MUST` be one-time, short-lived, and bound to client, redirect URI, PKCE, tenant, and user.
- A new login `MUST` replace only the previous session of the same application on the same device. Completing a desktop login `MUST NOT` revoke the browser session that authorized it, and sessions of other applications or other devices `MUST` remain valid; credential changes may still revoke all sessions for the user.
- Issued OAuth access tokens `MUST` resolve through `OAuthTokenLookupService` and `iam_oauth_grant`.
- Userinfo `MUST` expose only scopes granted to the requesting client.

### 4.2 Relying Party Registration

Relying-party clients are registered through enabled `iam_tenant_application` records.

Each relying party `MUST` declare OAuth metadata under `runtimeConfig.oauth.relyingParty`:

```json
{
  "oauth": {
    "relyingParty": {
      "enabled": true,
      "clientId": "forum",
      "redirectUris": [
        "https://forum.example.com/auth/oauth/callback"
      ],
      "allowedScopes": [
        "openid",
        "profile",
        "email"
      ],
      "confidential": true,
      "clientSecretHash": "<argon2id hash>"
    }
  }
}
```

- A `clientId` `MUST` be globally unique across tenant applications; when omitted it defaults to the application's globally unique `app_id`. The database `MUST` enforce the namespace with a unique expression index over the explicit `clientId` or `app_id`, and a conflicting registration `MUST` fail instead of creating an ambiguous client id that desktop session exchange cannot resolve without a tenant hint.

Rules:

- `clientId` `MUST` equal the registration's OAuth client identifier. It is optional and defaults to the tenant application's runtime `app_id`; a deployment whose brand-level client id differs from the runtime app id (`birdcoder` for `sdkwork-birdcoder`) declares the brand id here.
- A declared `clientId` `MUST` be unique across tenant applications, and when it is declared the tenant application's `app_id` is no longer accepted as this registration's client id.
- Redirect URIs `MUST` exactly match registered values unless an explicit wildcard host policy is configured. Loopback redirects follow RFC 8252 and may omit the port.
- Disabled or non-enabled tenant applications `MUST NOT` authorize or issue tokens.
- SDKWork applications consuming SDKWork OAuth `MUST` use the same integration model as external providers with `provider_code = "sdkwork"`.

### 4.3 Standard Scopes

| Scope | Meaning |
| --- | --- |
| `openid` | OIDC baseline |
| `profile` | Display name and avatar |
| `email` | Email address |
| `phone` | Phone number |
| `tenant` | Tenant summary |
| `organization` | Organization summary |
| `offline_access` | Refresh token |

## 5. Runtime Discovery For Applications

Applications `MUST` discover auth behavior from IAM runtime metadata rather than hard-coded login modes.

Sources, in priority order:

1. `iam.runtime.retrieve`
2. `iam.accountBindingPolicy.retrieve`
3. `iam.verificationPolicy.retrieve`
4. `agent.app.config.json` fallback only when server metadata is unavailable

`iam.runtime.retrieve` `MUST` expose at minimum:

- `auth.supportsLocalCredentials`
- `auth.supportsSessionExchange`
- `auth.oauthLoginEnabled`
- `auth.oauthProviders`
- `auth.oauthProviderRegion`
- `auth.loginMethods`
- `auth.sdkworkOAuthProviderEnabled`

`auth.oauthProviderRegion` values `MUST` use active `regionCode` values from `REGION_SPEC.md`.

Applications `MUST` map this metadata through `resolveSdkworkAuthRuntimeConfigFromMetadata()`.

## 6. Client Architecture Rules

Rules:

- Applications `MUST` consume OAuth through `@sdkwork/iam-app-sdk` or approved IAM auth runtime factories.
- Applications `MUST NOT` hand-craft provider authorization, callback, token, or session exchange HTTP.
- Open-api SDK clients `MUST` use separate OAuth bearer credential providers and `MUST NOT` reuse app login TokenManager state.
- Each surface `MUST` register its own redirect URI surface (`web`, `h5`, `mini_program`, `ios`, `android`, `desktop`).
- OAuth callback, deep-link, and mini-program code exchange `MUST` survive host background/foreground transitions where supported.

## 7. Security Rules

Rules:

- Authorization, token, callback, and completion endpoints `MUST` enforce rate limits and audit events.
- State, nonce, and PKCE `MUST` be validated before code issuance.
- Provider and relying-party secrets `MUST` be stored hashed or by secret reference only.
- Production profiles `MUST NOT` trust inline OAuth claim strings or unsigned bearer payloads alone.
- Token revocation and grant deletion `MUST` invalidate server-side lookup before business handlers accept the credential.
- Logout `MUST` revoke active OAuth grants when tenant policy requires provider sign-out.

## 8. Acceptance Checklist

- [ ] Provider catalog includes `sdkwork` and all supported third-party providers required by product surfaces.
- [ ] Tenant integrations, clients, secrets, surfaces, and claim mappings are configurable through backend-api only.
- [ ] App-api OAuth login uses provider adapters and account-binding policy enforcement.
- [ ] Open-api exposes discovery, authorize, token, userinfo, revoke, and introspect endpoints for SDKWork OAuth provider mode.
- [ ] Relying-party registration uses `iam_tenant_application.runtimeConfig.oauth.relyingParty`.
- [ ] Relying-party registration is validated on the write path (client id, redirect URIs, scopes, hashed secret) and applied by the application bootstrap when the auto-registration policy allows it.
- [ ] Authorization completion after IAM login uses app-api dual-token protection.
- [ ] Runtime metadata drives login method selection across PC, H5, Flutter, mini program, and native surfaces.
- [ ] Contract tests cover provider login, account linking, authorization code + PKCE, token exchange, userinfo scope filtering, revocation, and missing/invalid client configuration.
