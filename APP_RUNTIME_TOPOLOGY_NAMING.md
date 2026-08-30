# Application Runtime Topology Naming Registry

* Version: 5.7

* Scope: canonical names for deployment profile, runtime topology vocabulary, profiles, surfaces, environment keys, CLI flags, and documentation

* Related: `APP_RUNTIME_TOPOLOGY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_ARCHETYPES.md`, `NAMING_SPEC.md`, `DEPLOYMENT_SPEC.md`, `CONFIG_SPEC.md`

This file is the naming authority for application runtime topology. If another
document uses a retired synonym, that document is wrong.

## 1. Design Principles

1. Speak in full words. Profile ids and CLI values must be readable in standups
   without decoding: `standalone.production`, not `std.prod`.
2. One concept, one term. Do not create parallel public synonyms such as
   `gateway-mode`, `local-minimal`, `web-gateway`, `private`, or `saas`.
3. Deployment profile before runtime target. `standalone` and `cloud` describe
   the application deployment architecture; runtime target describes the package
   or host surface that starts or consumes that deployment.
4. Internal process layout stays internal. Process count, upstream fan-out, and
   binary decomposition do not appear in profile ids, env key axes, public
   scripts, SDK package names, or application integration manifests.
5. Plane before application line. Connectivity names describe route ownership,
   not marketing names.
6. Env keys are scannable. Fixed segment order is
   `SDKWORK_<APPLICATION_CODE>_<PLANE>_<SURFACE>_<PROPERTY>`.
7. Retire, do not alias. Unreleased applications delete old keys; bridging is
   forbidden outside approved migration tools.

## 2. Axis Registry

| Canonical key                    | Spoken name        | Allowed values                                              | Meaning                                                                                             |
| -------------------------------- | ------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `deploymentProfile`              | deployment profile | `standalone`, `cloud`                                       | Active application API/runtime topology                                                             |
| `environment`                    | environment tier   | `development`, `test`, `staging`, `production`, `demo`      | Lifecycle stage from `ENVIRONMENT_SPEC.md`; `demo` is the independent demonstration/deployment tier |
| `connectivityPlane`              | connectivity plane | `application`, `platform`, `operations`, `edge`             | Who owns the route and protocol termination                                                         |
| `orchestration.processes[].role` | process role       | `client`, gateway/API/data/migration/worker roles, `tunnel` | Machine authority for local-process safety checks in topology v5                                    |

### Deployment Profile

| Value        | When to say it                                                                                    | Typical deployment                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `standalone` | APIs terminate at the application-owned standalone gateway                                        | Local dev, desktop-local gateway, private appliance/host, single service/container                  |
| `cloud`      | Clients consume explicit deployed API surfaces without naming their remote gateway implementation | SDKWork hosted cloud, customer VPC/private cloud, Kubernetes, or local clients consuming cloud APIs |

Rules:

* `standalone` and `cloud` are the only deployment profile values.

* Do not use `saas`, `private`, `local`, `test`, `server`, `container`,
  `desktop`, `browser`, `web`, `mobile`, `mini-program`, `docker`, or hosting
  aliases as deployment profile values.

* SaaS/customer-private ownership is release environment metadata, not a
  topology axis.

* `server`, `container`, `desktop`, browser, mobile, mini-program, and
  `test-runner` are runtime targets in `CONFIG_SPEC.md` and `ENVIRONMENT_SPEC.md`.

* `dual` is the package-id artifact-binding token for a runtime-configurable client, not a
  deployment profile or topology profile-id segment.

### Retired Public Topology Vocabulary

| Retired concept                                                            | Replacement                                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| hosting axis                                                               | `deploymentProfile`                                                                   |
| self-hosted/cloud-hosted labels                                            | `standalone` or `cloud` plus deployment ownership metadata                            |
| topology/distribution as profile axes                                      | `deploymentProfile` plus internal implementation documentation                        |
| ambiguous `profile` shorthand                                              | `environment` or full two-segment profile id                                          |
| deployment mode as SaaS/private/local/test                                 | `deploymentProfile` plus environment/release metadata                                 |
| deployment mode as server/container/desktop/web/mobile/mini-program/docker | `runtimeTarget` plus package metadata; Docker-compatible artifacts map to `container` |
| plane names product/foundation/admin/device                                | `connectivityPlane`: `application`, `platform`, `operations`, `edge`                  |
| local/split/gateway mode labels                                            | exact `deploymentProfile` plus declared surfaces                                      |

Rules:

* New application standards, repository specs, env files, and scripts `MUST NOT`
  introduce a public process-layout axis.

* Migration tooling may recognize retired values as input only, then normalize
  to `deploymentProfile`, `environment`, runtime target, and declared surfaces
  before application code sees them.

## 3. Profile Id Formula

```text
<deploymentProfile>.<environment>
```

Examples:

| Profile id               | Short spoken form |
| ------------------------ | ----------------- |
| `standalone.development` | standalone dev    |
| `standalone.demo`        | standalone demo   |
| `standalone.production`  | standalone prod   |
| `cloud.staging`          | cloud staging     |
| `cloud.demo`             | cloud demo        |
| `cloud.production`       | cloud prod        |

Profile env file path:

```text
etc/topology/<deploymentProfile>.<environment>.env
```

CLI:

```bash
--deployment-profile standalone --environment development
--deployment-profile cloud --environment production
```

Rules:

* Profile ids `MUST` have exactly two segments.

* Profile ids `MUST NOT` contain runtime target, database engine, process
  layout, provider name, hosting owner, or package format.

## 4. Connectivity Planes

| Plane         | Owns                                            | Example routes / protocols                                                                     |
| ------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `application` | Application-owned APIs and application realtime | `/im/v3/api/*`, HTTP + WebSocket on same ingress                                               |
| `platform`    | Shared SDKWork platform APIs                    | IAM, Drive, Notary, Agent through a deployed platform URL or approved standalone assembly host |
| `operations`  | Operator / control APIs                         | Governance, drain, provider registry                                                           |
| `edge`        | Device and edge protocols                       | Device WebSocket, MQTT bridge, UDP                                                             |

## 5. Surface Id Formula

```text
<connectivityPlane>.<surfaceRole>
```

| Surface id                   | Plane       | Role                              | Protocols                   |
| ---------------------------- | ----------- | --------------------------------- | --------------------------- |
| `application.public-ingress` | application | Client-facing application ingress | `http`, `ws`                |
| `platform.api-gateway`       | platform    | Shared platform HTTP entry        | `http`                      |
| `operations.control-ingress` | operations  | Operator entry                    | `http`                      |
| `edge.device-ingress`        | edge        | Device entry                      | `http`, `ws`, `mqtt`, `udp` |

Retired surface ids: `product-ingress`, `foundation-gateway`,
`admin-ingress`, and bare `device-ingress`.

## 6. Environment Key Formula

### Deployment And Runtime

| Key                                             | Meaning                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SDKWORK_<APPLICATION_CODE>_DEPLOYMENT_PROFILE` | `standalone` or `cloud`                                                                                                                                                                                                                                                               |
| `SDKWORK_<APPLICATION_CODE>_RUNTIME_TARGET`     | One exact `CONFIG_SPEC.md` runtime target: `browser`, `desktop`, `tablet-ipados`, `tablet-android`, `capacitor-ios`, `capacitor-android`, `flutter-ios`, `flutter-android`, `android-native`, `ios-native`, `harmony-native`, `mini-program`, `server`, `container`, or `test-runner` |

Browser/public runtime documents may expose `deploymentProfile` and
`runtimeTarget` only as non-secret normalized values.

### Server-Side Surfaces

```text
SDKWORK_<APPLICATION_CODE>_<PLANE>_<SURFACE>_<PROPERTY>
```

| Property        | Meaning                              | Example                                       |
| --------------- | ------------------------------------ | --------------------------------------------- |
| `BIND`          | `host:port` listen address           | `SDKWORK_IM_APPLICATION_PUBLIC_INGRESS_BIND`  |
| `HTTP_URL`      | Public HTTP base URL                 | `SDKWORK_IM_APPLICATION_PUBLIC_HTTP_URL`      |
| `WEBSOCKET_URL` | Public WebSocket origin without path | `SDKWORK_IM_APPLICATION_PUBLIC_WEBSOCKET_URL` |
| `AUTOSTART`     | Dev orchestrator autostart           | `SDKWORK_IM_PLATFORM_API_GATEWAY_AUTOSTART`   |

Plane segment is uppercase single word: `APPLICATION`, `PLATFORM`,
`OPERATIONS`, or `EDGE`.

Surface segment uses uppercase with underscores: `PUBLIC_INGRESS`,
`API_GATEWAY`, `CONTROL_INGRESS`, or `DEVICE_INGRESS`.

### Realtime Server-Side

Application realtime surfaces (WebSocket upgrade plus client link transports)
use the application realtime key family:

```text
SDKWORK_<APPLICATION_CODE>_REALTIME_<PROPERTY>
```

| Property             | Meaning                                     | Example                                  |
| -------------------- | ------------------------------------------- | ---------------------------------------- |
| `TCP_BIND_ADDR`      | Client link TCP `host:port` listen address  | `SDKWORK_IM_REALTIME_TCP_BIND_ADDR`      |
| `UDP_BIND_ADDR`      | Client link UDP `host:port` listen address  | `SDKWORK_IM_REALTIME_UDP_BIND_ADDR`      |
| `QUIC_BIND_ADDR`     | Client link QUIC `host:port` listen address | `SDKWORK_IM_REALTIME_QUIC_BIND_ADDR`     |
| `QUIC_TLS_CERT_PATH` | QUIC TLS certificate file path              | `SDKWORK_IM_REALTIME_QUIC_TLS_CERT_PATH` |
| `QUIC_TLS_KEY_PATH`  | QUIC TLS key file path                      | `SDKWORK_IM_REALTIME_QUIC_TLS_KEY_PATH`  |
| `CLUSTER_BUS_URL`    | Realtime cluster bus URL (Redis)            | `SDKWORK_IM_REALTIME_CLUSTER_BUS_URL`    |
| `ROUTE_STORE_URL`    | Realtime route store URL                    | `SDKWORK_IM_REALTIME_ROUTE_STORE_URL`    |
| `NODE_ID`            | Realtime node identity                      | `SDKWORK_IM_REALTIME_NODE_ID`            |

Link transport binds are server-side declarations of the application realtime
surface. They are non-HTTP listeners, `MUST NOT` be counted as HTTP ingress,
and `MUST NOT` become client bootstrap keys. WebSocket upgrade stays on the
surface's HTTP listener and keeps the `WEBSOCKET_URL` key from
Server-Side Surfaces.

Platform gateway realtime hosting toggle:

| Key                                          | Meaning                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `SDKWORK_API_CLOUD_GATEWAY_REALTIME_ENABLED` | Platform cloud gateway hosts declared application realtime planes (`true`/`false`/`1`/`0`) |

### Internal Upstream

Cloud profiles and advanced standalone profiles may define internal upstream
keys for gateway-to-service communication:

```text
SDKWORK_<APPLICATION_CODE>_INTERNAL_<SERVICE>_BIND
```

Example: `SDKWORK_IM_INTERNAL_SESSION_GATEWAY_BIND`.

These keys are server-side only. They `MUST NOT` become client bootstrap keys or
additional required public HTTP surfaces.

### Client-Side Mirror

```text
VITE_<APP_CODE>_<PLANE>_<SURFACE>_<PROPERTY>
```

Example: `VITE_SDKWORK_IM_APPLICATION_PUBLIC_HTTP_URL`.

Rules:

* One env key `MUST NOT` serve two connectivity planes.

* WebSocket URL keys use `WEBSOCKET_URL`, not `WS_URL` or
  `WEBSOCKET_BASE_URL`.

* `SDKWORK_<APPLICATION_CODE>_DEPLOYMENT_MODE` is retired and `MUST` be rejected by new
  application startup, checked-in examples, workflow config, and runtime config.
  New applications use `SDKWORK_<APPLICATION_CODE>_DEPLOYMENT_PROFILE` plus
  `SDKWORK_<APPLICATION_CODE>_RUNTIME_TARGET`.

* Public process-layout env keys are forbidden. Implementation-specific
  upstream config must use internal surface/upstream keys.

## 7. Archetype Registry

| Archetype id                    | Spoken name                                | Use when                                             |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| `application-http-gateway`      | application HTTP gateway                   | Single application HTTP ingress                      |
| `realtime-application-platform` | realtime application plus platform gateway | HTTP + WS product ingress with platform dependencies |
| `application-rest-edge-device`  | application REST plus edge device          | REST services plus separate device ingress           |

Retired archetype ids: `http-product-gateway`,
`multi-plane-realtime`, and `dual-plane-connected`.

## 8. Documentation Phrases

Use these exact phrases in reviews and runbooks:

* "This change affects `application.public-ingress` only."

* "Foundation SDKs must use `platform.api-gateway` URLs unless standalone embeds an approved platform adapter."

* "Default standalone profile is `standalone.development`."

* "Default cloud release profile is `cloud.production`."

* "WebSocket terminates on `application.public-ingress`, not `platform.api-gateway`."

Avoid:

* "the gateway" without naming application ingress or platform gateway.

* "server URL" without naming application HTTP URL or platform HTTP URL.

* "local mode"; say `standalone` plus the exact profile id.

* "SaaS mode" as a deployment profile; say `cloud` plus release environment metadata.

* "chat host" for IM. IM is `im.sdkwork.com`; `chat.sdkwork.com` is reserved for LLM dialogue apps.

* public process-layout mode names in docs, scripts, env files, or SDK bootstrap.

## 9. SDKWork Public Host Registry

Application-plane public hosts `MUST` match product domain, not feature nicknames.

### 9.1 Environment Host Formula

Public hosts follow one formula per lifecycle environment and per registered
base domain. Non-production hosts carry an environment suffix between the host
role and the base domain; production hosts carry no suffix.

```text
<public-host> = <host-role>[-<environment-suffix>].<base-domain>   (non-production)
<public-host> = <host-role>.<base-domain>                          (production)
<base-domain> ∈ the product's registered base domain set
```

| environment   | environment-suffix | `<application-code>` role example (IM) | `api` role example        |
| ------------- | ------------------ | -------------------------------------- | ------------------------- |
| `development` | `-dev`             | `im-dev.sdkwork.com`                   | `api-dev.sdkwork.com`     |
| `test`        | `-test`            | `im-test.sdkwork.com`                  | `api-test.sdkwork.com`    |
| `staging`     | `-staging`         | `im-staging.sdkwork.com`               | `api-staging.sdkwork.com` |
| `demo`        | `-demo`            | `im-demo.sdkwork.com`                  | `api-demo.sdkwork.com`    |
| `production`  | (no suffix)        | `im.sdkwork.com`                       | `api.sdkwork.com`         |

Rules:

* The platform gateway role is always `api`: `api.sdkwork.com` in production,
  `api-<suffix>.sdkwork.com` in every non-production environment.

* The application public-ingress role is the canonical lowercase
  `topology.applicationCode` (for example `im`): `im.sdkwork.com` in production,
  `im-<suffix>.sdkwork.com` in every non-production environment. A product MAY
  bind a different explicitly registered role host (for example
  `sdkwork-birdcoder` binding `code.sdkwork.com` with
  `applicationCode = birdcoder`) when the host is registered in
  `cloudPublicHosts` and in the section 9.2 registry; the registered host
  takes precedence over the formula.

* Production public hosts `MUST NOT` carry an environment suffix. A domain such
  as `api-prod.sdkwork.com` or `im-prod.sdkwork.com` is never a valid public
  host.

* Non-production public hosts `MUST` use suffix style (`im-test.sdkwork.com`,
  `api-staging.sdkwork.com`). Prefix style (`test-im.sdkwork.com`,
  `staging-api.sdkwork.com`) is retired and `MUST NOT` appear in new
  configuration, examples, certificates, or documentation.

* `dev`, `test`, `staging`, and `demo` are domain-registry-only suffixes.
  They apply to
  public hostnames, certificates, and nginx site file names; they `MUST NOT`
  replace canonical `environment` values (`development`, `test`, `staging`,
  `demo`, `production`) in profile ids, env keys, or materialized runtime
  documents (`ENVIRONMENT_SPEC.md` section 5.1). A profile id stays
  `cloud.development`; its public host is `im-dev.sdkwork.com`.

* `sdkwork.com` is the primary base domain for SDKWork-managed cloud
  deployments. SDKWork-managed cloud products `MUST` bind every base domain
  in the Base Domain Registry (section 9.3) unless a dated governance
  exception documents a narrower set in release metadata and
  `cloudPublicHosts`.

* Customer-managed deployments may substitute their own base domain set with
  the same formula and `MUST` record the substitution in release metadata.

* Hosts `MUST` be registered per environment in `cloudPublicHosts.environments`
  (`APP_RUNTIME_TOPOLOGY_SPEC.md` section 4) or derivable from the
  `topology.applicationCode` formula. Multi-host surfaces use the `httpHosts`
  array in `cloudPublicHosts`. Deviations require a dated governance
  exception.

* WebSocket hosts follow the same formula and share the HTTP host unless the
  topology spec declares a separate realtime host.

* A multi-domain site binds the primary host as `expose.domain` and every
  additional registered host as `aliases` (`SDKWORK_DEPLOY_SPEC.md` section
  7.2): aliases share the primary site file, TLS certificate, and routing;
  each alias is an extra `server_name` value.

### 9.2 Host Registry

| Application               | `application.public-ingress` hosts (production / dev / test / staging)                                                                                                                                                                                                                         | Platform gateway (production / dev / test / staging)                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `sdkwork-im`              | `im.<base-domain>` on every registered base domain (for example `im.sdkwork.com`, `im.birdcoder.com`, `im.dtupay.com`, `im.sdkwork.cn`, `im.birdcoder.cn`, `im.dtupay.cn`, `im.skubc.com`, `im.zowalk.cn`, `im.offer86.com`, `im.86offer.cn`, …) / `im-<suffix>.<base-domain>` per environment | `api.<base-domain>` / `api-<suffix>.<base-domain>` per environment                             |
| LLM / Agent dialogue apps | `chat.sdkwork.com` / `chat-dev.sdkwork.com` / `chat-test.sdkwork.com` / `chat-staging.sdkwork.com`                                                                                                                                                                                             | `api.sdkwork.com` / `api-dev.sdkwork.com` / `api-test.sdkwork.com` / `api-staging.sdkwork.com` |
| `sdkwork-drive`           | `drive.sdkwork.com` / `drive-dev.sdkwork.com` / `drive-test.sdkwork.com` / `drive-staging.sdkwork.com`                                                                                                                                                                                         | `api.sdkwork.com` / `api-dev.sdkwork.com` / `api-test.sdkwork.com` / `api-staging.sdkwork.com` |
| `sdkwork-cloudrouter`     | `router.sdkwork.com` + `router.birdcoder.com` + `router.dtupay.com` / `router-dev.<base-domain>` / `router-test.<base-domain>` / `router-staging.<base-domain>` (every registered base domain)                                                                                                 | `api.sdkwork.com` / `api-dev.sdkwork.com` / `api-test.sdkwork.com` / `api-staging.sdkwork.com` |
| `sdkwork-knowledgebase`   | `knowledgebase.sdkwork.com` / `knowledgebase-dev.sdkwork.com` / `knowledgebase-test.sdkwork.com` / `knowledgebase-staging.sdkwork.com`                                                                                                                                                         | `api.sdkwork.com` / `api-dev.sdkwork.com` / `api-test.sdkwork.com` / `api-staging.sdkwork.com` |
| `sdkwork-birdcoder`       | `code.sdkwork.com` / `code-dev.sdkwork.com` / `code-test.sdkwork.com` / `code-staging.sdkwork.com`                                                                                                                                                                                             | `api.sdkwork.com` / `api-dev.sdkwork.com` / `api-test.sdkwork.com` / `api-staging.sdkwork.com` |
| `sdkwork-appstore`        | `appstore.sdkwork.com` / `appstore-dev.sdkwork.com` / `appstore-test.sdkwork.com` / `appstore-staging.sdkwork.com`                                                                                                                                                                             | `api.sdkwork.com` / `api-dev.sdkwork.com` / `api-test.sdkwork.com` / `api-staging.sdkwork.com` |
| `sdkwork-manager`         | `admin.sdkwork.com` / `admin-dev.sdkwork.com` / `admin-test.sdkwork.com` / `admin-staging.sdkwork.com`                                                                                                                                                                                         | `api.sdkwork.com` / `api-dev.sdkwork.com` / `api-test.sdkwork.com` / `api-staging.sdkwork.com` |
| `sdkwork-webserver`       | `server.sdkwork.com` / `server-dev.sdkwork.com` / `server-test.sdkwork.com` / `server-staging.sdkwork.com`                                                                                                                                                                                     | `api.sdkwork.com` / `api-dev.sdkwork.com` / `api-test.sdkwork.com` / `api-staging.sdkwork.com` |

Rules:

* IM HTTP and WebSocket share `im.sdkwork.com` (and `im-<suffix>.sdkwork.com`
  per environment) unless the topology spec declares a separate realtime host.

* Do not reuse `chat.sdkwork.com` for IM.

* Platform SDKs use `api.sdkwork.com` (and `api-<suffix>.sdkwork.com` per
  environment) in cloud deployments.

* `sdkwork-cloudrouter` binds the `router` role on every registered base
  domain; the primary host on `sdkwork.com` is the `expose.domain` and the
  remaining hosts are `aliases`.

* `sdkwork-knowledgebase` uses the full `knowledgebase` role on
  `sdkwork.com` (single base domain). Its auxiliary surfaces follow the same
  suffix formula on their own roles: backend/admin = `knowledgebase-admin.sdkwork.com`
  (`knowledgebase-admin-<suffix>.sdkwork.com` per environment), open =
  `knowledge.sdkwork.com` (`knowledge-<suffix>.sdkwork.com` per environment).
  These auxiliary hosts are registered in `cloudPublicHosts` and bound as
  `expose.aliases` (or per-surface hosts) in `deployments/deploy.yaml`.

* `sdkwork-birdcoder` binds the `code` role host on `sdkwork.com` while
  keeping `topology.applicationCode = birdcoder`: an explicitly registered
  role host MAY differ from `applicationCode` when it is registered in
  `cloudPublicHosts` and in this registry (section 9.1). Crate names, env key
  prefixes (`SDKWORK_BIRDCODER_*`), and runtime directories
  (`/etc/sdkwork/birdcoder`) keep following `applicationCode`.

* `sdkwork-manager` binds the `admin` role host on `sdkwork.com` while
  keeping `topology.applicationCode = manager` (same explicit-registration
  rule as `sdkwork-birdcoder`). Bare `admin.sdkwork.com` is this product's
  primary role host; it is distinct from the `*-admin.sdkwork.com` auxiliary
  surface form used by other products (for example
  `knowledgebase-admin.sdkwork.com`). Crate names, env key prefixes
  (`SDKWORK_MANAGER_*`), and runtime directories (`/etc/sdkwork/manager`)
  keep following `applicationCode`.

* `sdkwork-webserver` binds the `server` role host on `sdkwork.com` while
  keeping `topology.applicationCode = webserver` (explicit-registration
  precedence). Auxiliary surfaces follow the same suffix formula:
  app-api = `server-app.sdkwork.com` (`server-app-<suffix>.sdkwork.com`),
  backend-admin = `server-admin.sdkwork.com` (`server-admin-<suffix>.sdkwork.com`).
  Crate names, env key prefixes (`SDKWORK_WEBSERVER_*`), and runtime
  directories (`/etc/sdkwork/webserver`) keep following `applicationCode`.
  Retired nicknames `server.sdkwork.com`, `web-<suffix>.sdkwork.com`, and
  `testserver.sdkwork.com` MUST NOT appear in new configuration.

### 9.3 Base Domain Registry

| Base domain     | Kind    | Owned by | Notes                                                                 |
| --------------- | ------- | -------- | --------------------------------------------------------------------- |
| `sdkwork.com`   | primary | SDKWork  | Default global TLD; wildcard `*.sdkwork.com` covers environment hosts |
| `birdcoder.com` | partner | SDKWork  | Partner `.com` brand domain                                           |
| `dtupay.com`    | partner | SDKWork  | Partner `.com` brand domain                                           |
| `sdkwork.cn`    | primary | SDKWork  | Default China TLD; wildcard `*.sdkwork.cn` covers environment hosts   |
| `birdcoder.cn`  | partner | SDKWork  | Partner `.cn` brand domain                                            |
| `dtupay.cn`     | partner | SDKWork  | Partner `.cn` brand domain                                            |
| `skubc.com`     | partner | SDKWork  | Partner `.com` brand domain                                           |
| `skubc.cn`      | partner | SDKWork  | Partner `.cn` brand domain                                            |
| `zowalk.com`    | partner | SDKWork  | Partner `.com` brand domain                                           |
| `zowalk.cn`     | partner | SDKWork  | Partner `.cn` brand domain                                            |
| `offer86.com`   | partner | SDKWork  | Partner `.com` brand domain                                           |
| `offer86.cn`    | partner | SDKWork  | Partner `.cn` brand domain                                            |
| `86offer.com`   | partner | SDKWork  | Partner `.com` brand domain                                           |
| `86offer.cn`    | partner | SDKWork  | Partner `.cn` brand domain                                            |

Rules:

* SDKWork-managed cloud products `MUST` register hosts on every base domain
  in this table in `cloudPublicHosts` unless a dated governance exception
  documents a narrower set.

* Every registered base domain follows the same environment suffix formula:
  `router-dev.birdcoder.com`, `router-test.dtupay.com`, `router.sdkwork.com`,
  and so on.

* Multi-base-domain certificates: a site binding hosts on multiple base
  domains `MUST` use a SAN certificate covering all bound hosts or one
  wildcard/SAN certificate per base domain (`NGINX_SPEC.md` section 3).

* Retired brand domains are removed from this registry and from product
  `cloudPublicHosts` before their DNS entries are withdrawn.

## 10. API Assembly And Gateway Registry

Naming authority lives in `API_ASSEMBLY_SPEC.md`,
`APPLICATION_GATEWAY_SPEC.md`, and `NAMING_SPEC.md` section 4.3.1.

| Scope       | Role            | Canonical crate                                     | Primary surface                    | Consumer           |
| ----------- | --------------- | --------------------------------------------------- | ---------------------------------- | ------------------ |
| application | API assembly    | `sdkwork-api-<application-code>-assembly`           | app/backend/open API capability    | both gateway hosts |
| application | standalone host | `sdkwork-api-<application-code>-standalone-gateway` | `application.public-ingress`       | standalone runtime |
| platform    | cloud host      | `sdkwork-api-cloud-gateway`                         | deployed application/platform HTTP | platform runtime   |

Rules:

* Bare application gateways and application cloud gateways are retired.
  Reviews and manifests distinguish API assemblies,
  application standalone hosts, and the platform cloud host.

* Application `gateway:*:standalone` commands target the standalone host;
  `gateway:*:cloud` commands exist only in the platform gateway repository.

* `sdkwork-<application-code>-api-server` is not a substitute for an application gateway crate when
  the process composes or proxies dependency/platform surfaces for a deployment profile.

* Internal capability gateways such as `session-gateway` remain internal service names and do not
  replace application gateway crate naming unless they terminate `application.public-ingress` for
  a declared deployment profile.

Retired crate naming:

| Retired                                       | Replacement                                                    |
| --------------------------------------------- | -------------------------------------------------------------- |
| `sdkwork-api-cloud-gateway-api-server`        | `sdkwork-api-cloud-gateway`                                    |
| `sdkwork-<application-code>-gateway-assembly` | `sdkwork-api-<application-code>-assembly`                      |
| `sdkwork-<application-code>-gateway`          | `sdkwork-api-<application-code>-standalone-gateway`            |
| `sdkwork-<application-code>-cloud-gateway`    | platform-hosted API assembly or protocol-specific edge ingress |
| `gateway:bundle:*`                            | `gateway:package:*`                                            |
| `gateway:bundle:validate:*`                   | `gateway:validate:*`                                           |

## 11. Version History

| Version | Change                                                                                                                                                                                                                     | <br />                                                                                                           |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 5.9     | Registered partner base domains (`skubc.com`, `skubc.cn`, `zowalk.com`, `zowalk.cn`, `offer86.com`, `offer86.cn`, `86offer.com`, `86offer.cn`); SDKWork-managed products MUST bind every registered base domain by default | <br />                                                                                                           |
| 5.8     | Registered `.cn` base domains (`sdkwork.cn`, `birdcoder.cn`, `dtupay.cn`); SDKWork-managed products MUST bind every registered base domain by default                                                                      | <br />                                                                                                           |
| 5.7     | Restored `sdkwork-webserver` role host to `server.sdkwork.com` (`server-<suffix>.sdkwork.com`); auxiliary `server-app` / `server-admin`; retired `web.*` and `testserver` nicknames                                        | <br />                                                                                                           |
| 5.6     | Temporarily registered `server.sdkwork.com` role host (superseded by 5.7); auxiliary `web-app` / `web-admin`                                                                                                               | <br />                                                                                                           |
| 5.5     | Registered `sdkwork-manager` host row (`admin.sdkwork.com` role host with `applicationCode = manager`) and the bare-admin role-host precedence note                                                                        | <br />                                                                                                           |
| 5.4     | Registered `sdkwork-appstore` host row (`appstore.sdkwork.com` role host)                                                                                                                                                  | <br />                                                                                                           |
| 5.3     | Registered `sdkwork-birdcoder` host row (`code.sdkwork.com` role host with `applicationCode = birdcoder`) and the explicit-registration precedence rule                                                                    | <br />                                                                                                           |
| 5.2     | Registered `sdkwork-knowledgebase` host row and its auxiliary surfaces (admin/open roles) in the public host registry                                                                                                      | <br />                                                                                                           |
| 5.1     | Added multi-base-domain support: Base Domain Registry (§9.3), `httpHosts` multi-host surfaces, Cloud Router host registration (`router.*`), alias semantics for multi-domain sites                                         | <br />                                                                                                           |
| 5.0     | Added environment host formula and per-environment public host registry (`<role>[-<env-suffix>].sdkwork.com`); production keeps the bare role host                                                                         | <br />                                                                                                           |
| 4.0     | Collapsed topology profiles to `deploymentProfile.environment`; public process-layout axis removed from application integration                                                                                            | <br />                                                                                                           |
| 3.2     | Platform gateway crate standardized as `sdkwork-api-cloud-gateway`; retired listener crate                                                                                                                                 | <br />                                                                                                           |
| 3.1     | Gateway crates must use scope plus `standalone` or `cloud` deployment qualifiers                                                                                                                                           | <br />                                                                                                           |
| 3.0     | Promoted \`deploymentProfile = standalone                                                                                                                                                                                  | cloud\` as the application deployment architecture and retired hosting/self-hosted/cloud-hosted as topology axes |

