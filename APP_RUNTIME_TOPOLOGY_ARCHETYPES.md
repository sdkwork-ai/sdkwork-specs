# Application Runtime Topology Archetypes

- Version: 4.0
- Scope: reusable runtime topology patterns referenced by `specs/topology.spec.json` `archetype`
- Related: `APP_RUNTIME_TOPOLOGY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_NAMING.md`, `DEPLOYMENT_SPEC.md`, `CONFIG_SPEC.md`, `APPLICATION_GATEWAY_SPEC.md`

Archetypes are normative templates. Application specs instantiate them with
concrete deployment profiles, surfaces, binds, dependencies, and orchestration.
They describe connectivity, ingress ownership, and runtime integration shape.
Browser, desktop, tablet, mobile, mini program, server, container, and test
targets are runtime targets governed by `CONFIG_SPEC.md` and
`DEPLOYMENT_SPEC.md`; they do not create separate topology archetypes.

**Naming:** all profile ids, surface ids, env keys, and plane names must match
`APP_RUNTIME_TOPOLOGY_NAMING.md`.

## 1. Archetype Index

| Archetype id | Spoken name | Reference applications |
| --- | --- | --- |
| `application-http-gateway` | application HTTP gateway | `sdkwork-drive` |
| `realtime-application-platform` | realtime application plus platform gateway | `sdkwork-im`, future collaboration/RTC apps |
| `application-rest-edge-device` | application REST plus edge device | `sdkwork-aiot`, future IoT/edge apps |
| `application-client-root` | browser-only client root | `sdkwork-mall`, `sdkwork-music`, `sdkwork-sandbox`, `sdkwork-web-framework` |

Retired archetype ids: `http-product-gateway`,
`multi-plane-realtime`, and `dual-plane-connected`.

## 2. `application-http-gateway`

Single application HTTP ingress; optional platform gateway or embedded platform
adapter for IAM and cross-application SDKs.

### Connectivity Planes

- `application` is required.
- `platform` is required when IAM or cross-application SDKs are used.
- `operations` is optional for operator-only control APIs.

### Surfaces

| Surface id | Plane | Protocols |
| --- | --- | --- |
| `application.public-ingress` | application | `http` |
| `platform.api-gateway` | platform | `http` |
| `operations.control-ingress` | operations | `http` |

### Allowed Profiles

| Profile id | deploymentProfile | environment | Default |
| --- | --- | --- | --- |
| `standalone.development` | standalone | development | Yes |
| `standalone.production` | standalone | production | Yes for standalone release |
| `cloud.development` | cloud | development | Required remote-consumer profile for pnpm-managed application roots |
| `cloud.staging` | cloud | staging | Optional cloud pre-prod |
| `cloud.production` | cloud | production | Yes for cloud release |

Rules:

- Standalone deployments embed application app/backend/open/admin routes behind
  one application ingress and may embed an approved IAM adapter.
- Cloud deployments use managed platform URLs and may proxy to internal
  upstream services declared in topology and deployment manifests.
- All HTTP `*-api` surfaces must integrate `sdkwork-web-framework` or the
  language-equivalent profile required by `WEB_FRAMEWORK_SPEC.md`.

## 3. `realtime-application-platform`

Application HTTP + WebSocket ingress; platform HTTP gateway for IAM, Drive,
Agent, and other shared APIs; optional operations control ingress.

### Connectivity Planes

- `application` is required for product APIs and realtime WebSocket.
- `platform` is required for IAM and cross-application SDKs unless the standalone
  profile embeds an approved platform adapter.
- `operations` is optional for governance/control APIs.

### Surfaces

| Surface id | Plane | Protocols | Notes |
| --- | --- | --- | --- |
| `application.public-ingress` | application | `http`, `websocket` | Single host:port for HTTP and WS upgrade |
| `platform.api-gateway` | platform | `http` | External in cloud; external or embedded adapter in standalone |
| `operations.control-ingress` | operations | `http` | Optional; may be internal-only in development |

### Allowed Profiles

| Profile id | deploymentProfile | Default |
| --- | --- | --- |
| `standalone.development` | standalone | Local dev and smoke |
| `standalone.production` | standalone | Requires ADR for realtime operational limits |
| `cloud.development` | cloud | Cloud integration |
| `cloud.staging` | cloud | Cloud pre-prod |
| `cloud.production` | cloud | Default production |

Rules:

- Cloud production for realtime apps defaults to `cloud.production`.
- `standalone.production` for realtime apps requires an architecture decision
  that proves embedded or external platform dependency coverage, message
  delivery semantics, persistence, Redis/cache behavior, and operational limits.
- IAM-capable clients still use the platform surface contract even when a
  standalone profile embeds an adapter.
- Internal realtime workers, projection services, and upstream service binaries
  may exist, but they must remain internal implementation details behind
  `application.public-ingress` and declared platform surfaces.

### Capability Matrix

| Capability | `standalone` | `cloud` |
| --- | --- | --- |
| Application HTTP/WebSocket | yes | yes |
| IAM login | embedded adapter or platform surface | platform gateway |
| Drive media upload | embedded adapter or dependency SDK base URL | platform/dependency SDK base URL |
| Per-service scaling | implementation-specific | yes |
| Upstream service matrix | optional internal detail | explicit internal topology/deployment detail |

### Client Env Model

```text
SDKWORK_<APPLICATION_CODE>_APPLICATION_PUBLIC_HTTP_URL
SDKWORK_<APPLICATION_CODE>_APPLICATION_PUBLIC_WEBSOCKET_URL
SDKWORK_<APPLICATION_CODE>_PLATFORM_API_GATEWAY_HTTP_URL
VITE_SDKWORK_<APPLICATION_CODE>_APPLICATION_PUBLIC_HTTP_URL
VITE_SDKWORK_<APPLICATION_CODE>_APPLICATION_PUBLIC_WEBSOCKET_URL
VITE_SDKWORK_<APPLICATION_CODE>_PLATFORM_API_GATEWAY_HTTP_URL
```

Forbidden: `SDKWORK_<APPLICATION_CODE>_SERVER_API_BASE_URL`, `commonSdkRootEnv`
pointing at application URLs for platform SDKs, and undocumented WebSocket URL
shapes.

### Cloud Public URL Policy

Choose one canonical pattern per deployment and declare it in the app topology spec:

- Pattern A: HTTP and WSS share one public application host. WebSocket path is
  fixed, for example `/im/v3/api/realtime/ws` on `im.sdkwork.com`.
- Pattern B: Dedicated realtime host. Both hosts must appear explicitly in the
  `cloud.production` profile.
- Pattern C: Platform-hosted realtime. The deployed platform cloud gateway
  terminates the application realtime plane (WebSocket upgrade on its HTTP
  listener plus declared client link transports TCP/UDP/QUIC) per
  `ADR-20260809-platform-gateway-realtime-hosting`. The application declares
  `realtimeHosting: "platform-cloud-gateway"` on
  `application.public-ingress`; SDK-facing URLs and env keys are unchanged.
  `standalone` profiles always terminate realtime on the application ingress.

## 4. `application-rest-edge-device`

Human/admin application REST planes plus separate edge device ingress; platform
gateway when consoles use IAM. Application REST `MUST` terminate on a single
`application.public-ingress` bind that embeds app-api and admin/backend routes
through `sdkwork-api-<application-code>-assembly` hosted in-process by
`sdkwork-api-<application-code>-standalone-gateway` or by the deployed platform host.

### Connectivity Planes

- `application` is required for app-api and backend/admin REST.
- `platform` is required when consoles use IAM.
- `edge` is required for device gateway protocols.

### Surfaces

| Surface id | Plane | Protocols |
| --- | --- | --- |
| `application.public-ingress` | application | `http` |
| `operations.control-ingress` | operations | `http` |
| `edge.device-ingress` | edge | `http`, `websocket`, `mqtt`, `udp` |
| `platform.api-gateway` | platform | `http` |

### Allowed Profiles

| Profile id | deploymentProfile |
| --- | --- |
| `standalone.development` | standalone |
| `standalone.production` | standalone |
| `cloud.development` | cloud |
| `cloud.staging` | cloud |
| `cloud.production` | cloud |

Rules:

- Edge ingress is never proxied by `sdkwork-api-cloud-gateway`.
- OTA/device activation responses `MUST` use public URLs from the active profile.
- Standalone edge deployments must still use explicit edge/device surfaces
  instead of hiding device protocols behind application HTTP URLs.
- Internal edge bridges and worker processes may scale independently, but the
  public application profile remains either `standalone.*` or `cloud.*`.

## 5. `application-client-root`

Browser-only client root. It ships PC/H5 browser bundles and consumes deployed
platform APIs through the deployed platform gateway. It owns no application HTTP
ingress, so its nginx webserver profile stays disabled and no application-plane
listener is published.

### Connectivity Planes

- `platform` is required: every browser API call resolves through the platform
  gateway surface.
- `application` is **not** owned. A client root `MUST NOT` declare
  `application.public-ingress`, `application.app-http`, or any other
  application-plane HTTP surface.
- `operations` and `edge` are not used.

### Surfaces

| Surface id | Plane | Protocols | Required |
| --- | --- | --- | --- |
| `platform.api-gateway` | platform | `http` | Yes |

### Allowed Profiles

| Profile id | deploymentProfile |
| --- | --- |
| `standalone.development` | standalone |
| `standalone.production` | standalone |
| `cloud.development` | cloud |
| `cloud.production` | cloud |

Rules:

- `platform.api-gateway` `MUST` declare `httpUrlEnv`; a browser consumer also
  declares `clientHttpEnv`.
- The archetype `MUST NOT` declare an `api-standalone-gateway` process in any
  orchestration profile: it terminates no application HTTP API, so its
  `standalone` profile starts no local ingress process (see
  `APP_RUNTIME_TOPOLOGY_SPEC.md` section 5).
- Browser bundle delivery is owned by the application's own dev/build tooling in
  `standalone` and by the deployed platform host in `cloud`.
- A client root that later grows an owned application HTTP API `MUST` migrate to
  `application-http-gateway` instead of adding an application-plane surface here.

## 6. Adding A New Archetype

1. Propose archetype id, deployment profile support, and connectivity planes in
   an architecture decision.
2. Add a section to this file and register names in
   `APP_RUNTIME_TOPOLOGY_NAMING.md`.
3. Extend `sdkwork-app-topology` JSON Schema v5 enum when archetype validation
   is enforced.
4. Add a reference `examples/<application-code>/topology.spec.json` in
   `sdkwork-app-topology`.

Do not create `APP_<PRODUCT>_TOPOLOGY_SPEC.md` platform files.
