# Static Web (Pure HTML) Application Architecture Standard

- Version: 1.0
- Scope: SDKWork pure-HTML/static web application roots built from framework-free HTML, CSS, and vanilla ES modules, content-only page-group packages, Adaptive Web static delivery (`<share>/web/static/` and the optional `deployments/webserver/static/` fallback), public runtime config, static i18n pages, and cross-client route alignment
- Related: `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APPLICATION_SPEC.md`, `NAMING_SPEC.md`, `APP_SDK_INTEGRATION_SPEC.md`, `FRONTEND_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `FRONTEND_CODE_SPEC.md`, `TYPESCRIPT_CODE_SPEC.md`, `MODULE_SPEC.md`, `COMPONENT_SPEC.md`, `SDK_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `APP_MANIFEST_SPEC.md`, `SDKWORK_DEPLOY_SPEC.md`, `SDKWORK_WEBSERVER_SPEC.md`, `NGINX_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `I18N_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `TEST_SPEC.md`

This standard defines the application-root architecture for SDKWork static web clients: landing/marketing pages, help and documentation pages, status/error/fallback pages, download pages, and other framework-free HTML surfaces delivered as prebuilt static files. It is the root standard for the Adaptive Web "static fallback" surface (`APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` section 2.1: `<share>/web/static/`).

Static web roots are **content clients, not application clients**. They must not own user business workflows, login/session behavior, or admin surfaces. Anything requiring authentication, tenant context, or user state belongs in the PC, H5, or other client roots. If a static page needs public data, it consumes approved public/open-api surfaces or build-time generated content only.

## 1. Core Model

```text
static web root
  -> thin shared layout + bootstrap scripts
  -> page-group packages under packages/ (optional for single-group roots)
  -> public runtime config loaded from config/browser materialization
  -> no session, no TokenManager, no app/backend SDK login surfaces
  -> optional public/open-api read-only clients or build-time content
  -> route ids aligned with other client roots for shared page identity
```

Rules:

- Static web roots `MUST NOT` implement login, registration, token storage, refresh, organization selection, or any authenticated workflow.
- Static web roots `MUST NOT` embed secrets: no API keys, tokens, private endpoints, database URLs, or signing material in HTML, CSS, JS, or build output.
- Every page must remain functional as static HTML; JavaScript enhances progressively and must not be required for primary content visibility.
- Shared identity (brand, layout, tokens, footer legal links) is provided by `core`; page groups own their content.
- When a shared workflow (privacy policy, download page, help center) exists in other client roots, route ids and i18n keys align by route id even though delivery is static.

## 2. Standard Root Layout

```text
apps/sdkwork-<application-code>-static-web/
  AGENTS.md
  sdkwork.app.config.json
  .sdkwork/
    README.md
    skills/
      README.md
    plugins/
      README.md
  etc/
    README.md
    sdkwork.deployment.config.json
  config/
    browser/
      runtime.config.<deployment-profile>.<environment>.json
  docs/
  scripts/
  specs/
  src/
    pages/
      <route-group>/
        index.html
    assets/
      media/
    styles/
      tokens.css
      base.css
    scripts/
      bootstrap/
        environment.js
        runtime.js
      core/
        layout.js
        i18n.js
        runtimeConfig.js
    i18n/
      <locale>/
        <domain>/
          <capability>.json
    favicon.ico
    robots.txt
  packages/
    sdkwork-<application-code>-static-web-core/
    sdkwork-<application-code>-static-web-<page-group>/
  tests/
  package.json
```

Rules:

- The root name `apps/sdkwork-<application-code>-static-web` and package segment `static-web` are canonical. New static web roots `MUST NOT` use the shorter `apps/<application-code>-static-web/` form.
- A root with one simple page group may keep a flat `src/` tree (the `core` role folded into `src/scripts/core/`) and record that decision in its `specs/component.spec.json`. A root with two or more page groups `MUST` split page groups into packages.
- `src/pages/<route-group>/index.html` is the canonical page unit: one directory per route group, `index.html` as the directory entry, relative asset references only.
- `config/browser/` owns the public runtime config template (SDK base URLs for approved public surfaces, public feature flags, brand/legal metadata). It contains non-secret values only and is materialized per profile/environment per `ENVIRONMENT_SPEC.md` section 5.1 (`profile id = <deploymentProfile>.<environment>`).
- `sdks/` exists only when the root consumes generated public/open-api SDKs; authenticated app/backend SDK families are forbidden.
- Build output is `dist/<profile>/<envAlias>/` (for example `dist/standalone/prod/`) using the browser build-output layout of `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` §2.1; bare `dist/` and environment-only layouts are forbidden.

## 3. Package Taxonomy

| Package | Owns | Must not own |
| --- | --- | --- |
| `sdkwork-<application-code>-static-web-core` | shared layout includes, header/footer partials, design tokens, base CSS, bootstrap scripts, runtime-config loader, i18n helpers, legal/brand fragments | page content, domain copy ownership, business logic |
| `sdkwork-<application-code>-static-web-<page-group>` | one content domain: pages (`.html`), page CSS/JS, media assets, locale fragments, route metadata for its group | other groups' pages, shared layout overrides, any authenticated flow |

Rules:

- The `<page-group>` segment is a concrete content domain in lower kebab-case, such as `landing`, `docs`, `help`, `status`, `download`, or `legal`. It `MUST NOT` be a placeholder such as `common`, `misc`, `pages`, or `web`.
- Page groups depend on `core` through its public exports/includes; `core` must not import page groups.
- A page group owns its media; shared brand media lives in `core` or root `src/assets/media/`.
- Console/admin package families are forbidden on static web roots. Operator content belongs in backend/admin UI or backend-owned doc surfaces.

## 4. Package Internal Shape

```text
packages/sdkwork-<application-code>-static-web-<page-group>/
  package.json
  README.md
  pages/
    <page>/
      index.html
  styles/
  scripts/
  media/
  i18n/
    <locale>/
      <page>.json
  routes/
    routes.js
  tests/
  specs/
```

Rules:

- `routes/routes.js` declares the group's route contributions (route id, title key, locale availability, canonical path) without API URLs or SDK methods.
- Page HTML references shared layout/tokens through `core` public paths only; page groups must not copy base styles or footer markup.
- Locale fragments split by page under the group `i18n/` directory per `I18N_SPEC.md`; page-level localized HTML is generated from fragments or locale directories, never hand-duplicated per locale without generation tooling.
- Media is optimized at source (no build-time secret injection); alt text is required for informative images.

## 5. Data And API Boundary

Rules:

- Static web pages must not create sessions or carry user credentials. `localStorage`/`sessionStorage`/cookies must not hold tokens or personal data beyond explicit consent-tracked preferences.
- Approved data sources, in order: build-time generated content, materialized public runtime config (`config/browser/`), and generated public/open-api SDK clients (or approved read-only public wrappers) for declared public surfaces.
- Public API clients load through `core` with the materialized runtime config base URL; feature pages must not hard-code API origins or fetch raw endpoints inline.
- Protected app-api/backend-api/open-api surfaces are forbidden from static web roots even when CORS would allow them.
- Forms on static pages submit to declared, owned endpoints (for example a public contact/lead open-api command) with server-side validation; static pages must not collect credentials or payment data.
- Third-party scripts (analytics, maps, chat widgets) are declared in the root component spec, loaded with SRI hashes where the vendor publishes them, and documented in privacy evidence per `PRIVACY_SPEC.md`.

## 6. Route And Page Alignment

Rules:

- Static page route ids follow `<surface>.<domain>.<capability>.<screen>` with `surface = "app"` for public product pages, and align with PC/H5 route ids where the same page identity exists.

```js
export const landingRoutes = [
  {
    id: "app.brand.landing.index",
    surface: "app",
    domain: "brand",
    capability: "landing",
    screen: "index",
    titleKey: "brand.landing.index.title",
    path: "/",
    locales: ["zh-CN", "en-US"],
  },
];
```

- Physical paths are the static directory paths (`/`, `/docs/`, `/help/`, `/status/`); canonical URLs, `hreflang`, and sitemap entries are generated from route metadata.
- Locale-prefixed delivery (`/en/`, `/zh/`) is generated from locale fragments; the default locale serves at the root path with `hreflang` alternates.
- Error/fallback pages (`404.html`, `503.html`) are owned by the root and are the Adaptive Web static-fallback targets.
- Route metadata must not declare API URLs, SDK methods, tokens, or secrets.

## 7. Config, Build, And Release

Rules:

- The build copies/optimizes `src/` and selected packages into exactly one `dist/<profile>/<envAlias>/` output, inlining or materializing the selected `config/browser/runtime.config.<profile-id>.json` at the declared public path.
- The build must fail when the output contains secrets, localhost production endpoints, unresolved placeholders, or undeclared third-party scripts.
- Installed delivery follows `RUNTIME_DIRECTORY_SPEC.md` and `SDKWORK_DEPLOY_SPEC.md`: static output installs to `<share>/web/static/`, and the optional module-owned fallback source lives under `deployments/webserver/static/` per `SDKWORK_WEBSERVER_SPEC.md` static mounting rules. The webserver serves it read-only; the root must not write runtime files into the share.
- Cache headers are the webserver's responsibility (`SDKWORK_WEBSERVER_SPEC.md`); the root provides content-hashed asset filenames when a build step exists, or stable paths when hand-authored.
- `sdkwork.app.config.json` uses `runtime.family = "web"`, `runtime.framework = "static-html"`, `clientArchitectures = ["static-web"]`, and `publish.platforms = ["WEB"]`.
- Security headers (CSP, `X-Content-Type-Options`, referrer policy) are declared in webserver config; the root's markup must be CSP-compatible: no inline event handler attributes for logic, no `eval`, and documented nonces/hashes for required inline blocks.

## 8. Standard Commands

```text
pnpm install
pnpm dev
pnpm dev:standalone
pnpm dev:cloud
pnpm build:static-web
pnpm build:static-web:staging
pnpm build:static-web:prod
pnpm preview:static-web
pnpm test
pnpm test:config
pnpm test:routes
```

Rules:

- `pnpm dev` serves the static root locally with the standalone development profile materialized; it must not start gateways or data services.
- Production build commands must run link integrity, route/sitemap generation, secret scans, and CSP-compatibility checks before publishing.

## 9. Verification

Required verification for static web architecture changes:

| Verification | Evidence |
| --- | --- |
| Root layout | Static check proves the root path uses `apps/sdkwork-<application-code>-static-web/` and `.sdkwork/`, `config/browser`, `src/pages` or page-group packages, scripts, and tests exist. |
| Package naming | Static check proves packages use `sdkwork-<application-code>-static-web-*` with reserved `core`/`<page-group>` roles and no console/admin families. |
| Content-only boundary | Static scan proves no login/session/token code, no authenticated SDK imports, and no credential/payment collection forms. |
| Secret-free output | Build/CI scan proves `dist/` output contains no API keys, tokens, private endpoints, or database URLs. |
| Data boundary | Static scan proves page groups fetch only through `core` runtime-config-resolved public clients or build-time content, with no inline hardcoded origins. |
| Route alignment | Tests prove route metadata follows the shared route id format, generates sitemap/canonical entries, and aligns with other client roots where applicable. |
| i18n | Tests prove locale fragments split by page and locale-prefixed output is generated, not hand-duplicated. |
| Progressive function | Checks prove primary content is visible without JavaScript for representative pages. |
| Output layout | Build evidence proves `dist/<profile>/<envAlias>/` layout and successful install mapping to `<share>/web/static/`. |

Acceptance checklist:

- [ ] Static web root uses `apps/sdkwork-<application-code>-static-web/` and follows `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.
- [ ] The root owns content only; no authenticated workflows, sessions, or admin surfaces.
- [ ] Page groups are split into packages (or the single-group flat form is recorded in `component.spec.json`).
- [ ] Shared identity comes from `core`; page groups do not copy layout/tokens.
- [ ] Data comes from build-time content, public runtime config, or approved public/open-api clients only.
- [ ] Route ids align with other client architectures where page identities match.
- [ ] Build output uses `dist/<profile>/<envAlias>/` and deploys to `<share>/web/static/` secret-free.
- [ ] Verification evidence is recorded before completion.
