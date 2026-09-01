# Region And Geographic Partition Standard

- Version: 1.0
- Scope: SDKWork region semantics, region code registry, market/billing/compliance partitions, cloud provider region mapping, storage region, data residency, cross-region synchronization, API/database/config field naming
- Related: `NAMING_SPEC.md`, `ENVIRONMENT_SPEC.md`, `CONFIG_SPEC.md`, `DEPLOYMENT_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `DISCOVERY_SPEC.md`, `DRIVE_SPEC.md`, `PRIVACY_SPEC.md`, `I18N_SPEC.md`, `DOMAIN_SPEC.md`, `API_SPEC.md`, `DATABASE_SPEC.md`, `IAM_OAUTH_SPEC.md`, `MIGRATION_SPEC.md`, `GOVERNANCE_SPEC.md`, `TEST_SPEC.md`
- Reference implementation: `sdkwork-models` (`models/<vendorCode>/<regionCode>/`, `regionCode`, `marketScope`, `billingCurrency`, `billingJurisdiction`)

This standard defines the unified SDKWork meaning of **region**. It prevents market partitions, cloud provider regions, storage bucket regions, and availability zones from being collapsed into one ambiguous field. It uses the `sdkwork-models` vendor-region design as the first production reference and aligns with common cloud partitioning models (cloud region/AZ, ISO 3166, ISO 4217, data residency).

Intelligence-domain catalog, pricing, and vendor-region file layout details remain documented in `sdkwork-models/README.md` and `sdkwork-models/schemas/*.schema.json`. This file is the L0 platform authority for region vocabulary and layering.

## 1. Design Goals

Region modeling must satisfy these goals:

- One SDKWork semantic region (`regionCode`) can express market scope, billing currency, compliance jurisdiction, and catalog/pricing partitions.
- Cloud infrastructure regions (`providerRegion`) use each provider's canonical identifiers and must not be stored in `regionCode`.
- Object storage regions (`storageRegion`) belong to Drive storage provider contracts; business tables must not treat bucket region as source of truth.
- Stable business identifiers such as `catalogKey` must not encode region; region is an explicit dimension.
- `standalone` and `cloud` deployments can declare deployment region and must remain consistent with tenant data residency policy.
- Cross-region replication and cross-border synchronization must be explicit and auditable per `PRIVACY_SPEC.md`.
- New regions are governed through a registry; applications must not invent incompatible region strings.

## 2. Terms

| Term | Meaning |
| --- | --- |
| SDKWork region | Platform market/billing/compliance partition. Field names: `regionCode` (camelCase API), `region_code` (snake_case DB). |
| Provider region | Cloud infrastructure region such as `us-east-1`, `cn-hangzhou`, `eastus`. Field names: `providerRegion` / `provider_region`. |
| Availability zone | Cloud provider AZ such as `us-east-1a`. Field names: `availabilityZone` / `availability_zone`. |
| Storage region | Object storage provider bucket/endpoint region. Field names: `storageRegion` / `storage_region`. Owned by `DRIVE_SPEC.md`. |
| Market scope | Market range enum: `china_mainland`, `global`, `international`. |
| Billing jurisdiction | Billing/tax jurisdiction identifier, usually ISO 3166-1 alpha-2 uppercase or platform reserved value `GLOBAL`. |
| Region registry | Canonical SDKWork-maintained region code table and metadata in this document. |
| Vendor-region partition | Boundary keyed by `vendorCode + regionCode` for catalog, evidence, and pricing (`sdkwork-models` pattern). |
| Deployment region | SDKWork region or provider region binding for an application or service instance. |
| Data residency policy | Policy defining where tenant data may be stored and processed. |

## 3. Region Type Taxonomy

SDKWork distinguishes four region layers. One field must not carry multiple layers:

```text
L1  SDKWork region (regionCode)       market / billing / compliance / catalog partition
L2  Provider region (providerRegion)  cloud infrastructure region
L3  Storage region (storageRegion)     object storage bucket region
L4  Availability zone                  optional HA subdivision
```

Rules:

- API, database, and config field names must reflect the layer. Do not use bare `region` for any layer.
- When only one "region" can be written in context, use the full name: `regionCode`, `providerRegion`, or `storageRegion`.
- `environment` (`development`/`production`), `deploymentProfile` (`standalone`/`cloud`), and discovery `namespace` are orthogonal to `regionCode` and must not substitute for it.

## 4. SDKWork Region Code (`regionCode`)

### 4.1 Format

```text
^[a-z][a-z0-9_]*$
```

Rules:

- Lowercase ASCII only; first character must be a letter.
- Length `MUST NOT` exceed 64 characters.
- Default value `MUST` be `global` when no region is specified.
- API JSON uses `regionCode`; database columns use `region_code`; environment variables use the `REGION_CODE` suffix per `ENVIRONMENT_SPEC.md`.
- Validation matches `sdkwork-models` `schemas/vendor.schema.json` and admin catalog normalization.

### 4.2 Canonical Registry

| `regionCode` | Display name | `marketScope` | Default currency | Default `billingJurisdiction` | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `global` | Global | `global` | USD | `GLOBAL` | active | Default region; most international vendors |
| `cn` | China mainland | `china_mainland` | CNY | `CN` | active | China mainland market; used in production `sdkwork-models` |
| `us` | United States | `global` | USD | `US` | reserved | Reserved for future US partition; requires governance promotion |
| `eu` | European Union | `international` | EUR | `EU` | reserved | Reserved; requires GDPR residency policy before promotion |
| `asia` | Asia-Pacific | `international` | USD | `GLOBAL` | reserved | Regional aggregate; not an ISO country code |

Rules:

- **active** regions may be used in catalog, pricing, deployment declarations, and production APIs.
- **reserved** regions may appear in types and documentation but must not receive production data until promoted through `GOVERNANCE_SPEC.md`.
- New `regionCode` values `MUST` be added to this table before catalog files, API enums, or DB check constraints use them.
- `regionCode` `MUST NOT` equal a cloud provider region string such as `us-east-1`.

### 4.3 `marketScope` Enum

| Value | Meaning |
| --- | --- |
| `china_mainland` | China mainland market and compliance boundary |
| `global` | Global unified market without special localization boundary |
| `international` | International/multi-jurisdiction market outside a single global currency boundary |

Rules:

- Every vendor-region record `MUST` declare `marketScope`.
- The same `vendorCode` may use different `marketScope` values per `regionCode` (for example `alibaba/cn` → `china_mainland`, `alibaba/global` → `international`).

### 4.4 Currency And Jurisdiction

- `billingCurrency` `MUST` be an [ISO 4217](https://www.iso.org/iso-4217-currency-codes.html) three-letter code such as `USD` or `CNY`.
- `billingJurisdiction` `SHOULD` be ISO 3166-1 alpha-2 uppercase such as `CN` or `US`, or platform reserved values `GLOBAL` or `EU`.
- Registry default currency may be used when currency is omitted (`cn` → `CNY`, otherwise → `USD`), but explicit currency always wins.

### 4.5 `operatingRegions`

- Vendor-level `operatingRegions` describes geographic coverage for a vendor-region record.
- Legacy catalog JSON may use uppercase values such as `GLOBAL` or `CN`.
- New APIs and schemas `SHOULD` use lowercase `regionCode` values in new fields. Legacy uppercase `operatingRegions` values are read-only compatible and must not be written into `regionCode`.
- `operatingRegions` must not replace `regionCode` as a partition primary key.

## 5. Identity Rules (sdkwork-models alignment)

### 5.1 Vendor-Region Partition

```text
models/<vendorCode>/<regionCode>/
  vendor.json
  families.json
  models/<modelId>.json
  pricing/<modelId>.json
```

Rules:

- `vendorCode` `MUST NOT` encode region.
- The same `modelId` may appear under multiple `regionCode` values for one vendor with different pricing, currency, and shelf state.
- Source evidence, official snapshots, and release hashes are keyed by `vendorCode/regionCode`.

### 5.2 Stable Catalog Key

```text
catalogKey = <vendorCode>/<modelId>
```

Rules:

- `catalogKey` `MUST NOT` include `regionCode`.
- Routing, lookup, and pricing selection use explicit `regionCode` or resolved deployment/tenant region.
- Admin multi-region pricing uses `regionPrices[]` with `regionCode`, `currency`, and price fields. A `global` entry is the required fallback when multi-region admin pricing is used.

### 5.3 Intelligence Domain

Rules:

- Domain `intelligence` catalog, model admin, and official verification flows `MUST` follow this standard for `regionCode` vocabulary.
- `sdkwork-models` schemas and README remain the reference contracts for vendor-region file layout and release evidence.

## 6. Provider Region (Cloud Infrastructure)

Align with industry provider region identifiers:

| Provider | Example | Pattern |
| --- | --- | --- |
| AWS | `us-east-1`, `ap-northeast-1` | `<geo>-<direction>-<n>` |
| GCP | `us-central1`, `asia-east1` | `<geo>-<location><n>` |
| Azure | `eastus`, `chinaeast2` | `<location><n>` |
| Alibaba Cloud | `cn-hangzhou`, `us-west-1` | `<cc>-<city>` or `<geo>-<direction>-<n>` |

Rules:

- `providerRegion` `MUST` use the provider's documented canonical ID with provider-native casing.
- Configuration `SHOULD` declare both `cloudProvider` (such as `aws`, `gcp`, `azure`, `aliyun`) and `providerRegion`.
- One `regionCode` may map to multiple `providerRegion` values for multi-AZ or multi-site deployments. Mapping belongs in deployment topology or discovery config, not in `catalogKey`.
- `providerRegion` `MUST NOT` be written into `regionCode`.

Recommended deployment shape:

```yaml
deployment:
  sdkworkRegion: cn
  cloudProvider: aliyun
  providerRegion: cn-hangzhou
  availabilityZones:
    - cn-hangzhou-h
    - cn-hangzhou-i
```

## 7. Storage Region

Rules per `DRIVE_SPEC.md` and `MEDIA_RESOURCE_SPEC.md`:

- Bucket region, endpoint, path style, and credentials belong to `drive_storage_provider` contracts.
- Business tables and API resources `MUST NOT` treat bucket or `storageRegion` as source of truth; use Drive references.
- When an API must expose storage geography, use `storageRegion` and identify the provider.
- When `storageRegion` and `regionCode` differ, data residency policy `MUST` document cross-region access.

## 8. Deployment And Runtime Binding

### 8.1 Application Deployment Region

`cloud` deployments `SHOULD` declare:

| Field | Requirement |
| --- | --- |
| `sdkworkRegion` | Primary SDKWork operating region |
| `providerRegion` | Primary compute/data-plane cloud region |
| `dataResidencyRegions` | Allowed SDKWork regions for tenant data persistence |
| `failoverRegions` | Optional disaster-recovery region list |

`standalone` deployments `SHOULD` declare `sdkworkRegion`. `providerRegion` may be `local` or omitted for on-prem/private installs.

Tenant default `sdkworkRegion` may be added in IAM or tenant policy in a future slice. Until then, deployment config and explicit request context are the authoritative runtime sources.

### 8.2 Environment Variables

```text
SDKWORK_<APPLICATION_CODE>_REGION_CODE
SDKWORK_REGION_CODE              (shared fallback key, framework bootstraps)
SDKWORK_<APPLICATION_CODE>_PROVIDER_REGION
SDKWORK_<APPLICATION_CODE>_CLOUD_PROVIDER
```

Rules:

- Follow `ENVIRONMENT_SPEC.md` naming. These are private process variables and must not appear under `VITE_*` or `PORTAL_PUBLIC_*`.
- Public runtime config for catalog default pricing region must be served through controlled runtime config, not raw cloud account region details.
- Every installable application `SHOULD` declare `SDKWORK_<APPLICATION_CODE>_REGION_CODE` in its deployment environment; framework bootstraps fall back to the shared `SDKWORK_REGION_CODE` key, then to `global` (§8.4).

### 8.3 Discovery And RPC

- Discovery `namespace` and `environment` are unchanged. `regionCode` `MAY` be registered as instance metadata key `sdkwork_region`.
- Cross-`regionCode` RPC calls `MUST` use explicit resolver policy. Production must not silently fall back to `global` instances.

### 8.4 Startup Default Region (Normative)

Every installable/startable SDKWork application `MUST` be able to resolve its
deployment default region during startup, before serving traffic:

- The startup default region `MUST` resolve from, in order: the
  `SDKWORK_<APPLICATION_CODE>_REGION_CODE` environment key, the shared
  `SDKWORK_REGION_CODE` key, then the `global` default (§4.1).
- A set-but-invalid value (failing the §4.1 format) `MUST` fail startup with a
  diagnosable error rather than silently continuing.
- The resolved region `MUST` be validated against the active region registry;
  codes outside the registry `MUST` be rejected or downgraded to `global` with
  an emitted observability event.
- Each process `MUST` publish the resolved region as a process-wide runtime
  accessor so any module can read the startup default region identifier
  without threading configuration through call sites. Reference
  implementation: `sdkwork-web-framework` `RuntimeRegion`
  (`runtime_region_code()`), integrated through the `WebFrameworkBuilder`
  (framework bootstraps probe application keys plus `SDKWORK_REGION_CODE`).
- The resolved region `MUST` be recorded in startup logs/banners and `MAY` be
  attached to request traces (for example cloudrouter's
  `gateway_region_code_snapshot`).
- Installers and deployment manifests `SHOULD` persist `SDKWORK_<APPLICATION_CODE>_REGION_CODE`
  into the deployment environment (see `ENVIRONMENT_SPEC.md` §5 and the
  `ensure-region-keys` tooling); existing deployments without the key keep the
  `global` default.
- Runtime consumers (pricing, routing, locale, compliance) `SHOULD` follow the
  §9 resolution order and use the startup default region as the deployment
  step of that chain.

## 9. Region Resolution

Recommended resolution order for pricing, routing, and compliance consumers:

1. Explicit request `regionCode` when the API contract allows it.
2. Tenant or organization data residency policy bound `sdkworkRegion` when present.
3. Deployment `sdkworkRegion`.
4. Registry default: `global`.

Rules:

- Resolved `regionCode` `MUST` be in the active registry set or return a diagnosable error.
- Pricing lookup `MAY` fall back to the same model's `global` regional price when the target region price is missing, but must not mix currencies silently. Fallback should emit an observability event.
- A billing-required invocation `MUST NOT` be recorded or settled as zero-priced usage when no billable rate resolves for its meters (fail-closed): the deployment region `MUST NOT` be forced onto a model that has no price or upstream route in that region, and resolution failures for required meters `MUST` fail the invocation with a diagnosable error instead of silently unbilling. Free endpoints are the only zero-charge path, and they `MUST` be declared `FreeEndpoint` rather than priced at zero.

## 10. Data Residency And Cross-Region

Rules aligned with `PRIVACY_SPEC.md`:

- Tenant data storage and processing `sdkworkRegion` `MUST` be documentable.
- Cross-`regionCode` or cross-border synchronization `MUST` be explicit, including legal basis and user/operator consent where required.
- `china_mainland` market scope data `SHOULD NOT` leave the `cn` `regionCode` without a governed exception.
- Logs, backups, search indexes, and derived read models belong in residency and deletion plans.
- IAM OAuth `auth.oauthProviderRegion` uses the `regionCode` vocabulary from this registry.

## 11. API And Database Conventions

| Surface | SDKWork region | Provider region | Storage region |
| --- | --- | --- | --- |
| OpenAPI / JSON | `regionCode` | `providerRegion` | `storageRegion` |
| Rust / SQL | `region_code` | `provider_region` | `storage_region` |
| Java | `regionCode` | `providerRegion` | `storageRegion` |
| Dart | `regionCode` | `providerRegion` | `storageRegion` |
| Env suffix | `REGION_CODE` | `PROVIDER_REGION` | `STORAGE_REGION` |

Rules:

- Common composite uniqueness patterns: `(tenant_id, vendor_code, region_code, ...)`, `(vendor_code, region_code, model_id)`.
- Indexes `SHOULD` include `region_code` when region filtering is a hot path.
- Migrations that add a region dimension follow `MIGRATION_SPEC.md`. Historical empty values `MUST` backfill to `global`.

## 12. Industry Alignment

| Standard | SDKWork usage |
| --- | --- |
| ISO 3166-1 alpha-2 | `billingJurisdiction`; country-aligned `regionCode` such as `cn`, `us` |
| ISO 4217 | `billingCurrency`, `currency` |
| Cloud provider region IDs | `providerRegion` only |
| GDPR / data localization | `marketScope` + `dataResidencyRegions` + `PRIVACY_SPEC.md` |
| Multi-region SaaS catalog | `vendorCode/regionCode` partition + `regionPrices[]` |

## 13. Extension And Governance

- Adding `regionCode`: update this registry, `README.md`, affected domain specs, validators, and `TEST_SPEC.md` cases.
- Promoting `reserved` → `active`: requires residency, billing, and compliance review plus migration plan.
- Application-private region vocabularies that conflict with this registry require a `GOVERNANCE_SPEC.md` exception with removal plan.

## 14. Acceptance Checklist

- [ ] New API/DB fields use layered naming (`regionCode` / `providerRegion` / `storageRegion`).
- [ ] Stable identifiers do not encode region (`catalogKey`, operationId, SDK family names).
- [ ] `regionCode` passes format validation and exists in the registry (or documented reserved value).
- [ ] Billing currency is ISO 4217; cross-border prices do not mix currencies.
- [ ] Deployment manifests declare `sdkworkRegion`; cloud deployments declare `providerRegion`.
- [ ] Every installable application resolves its startup default region (§8.4) and publishes a process-wide accessor; invalid configured values fail startup.
- [ ] Cross-region sync and residency behavior are documented and auditable.
- [ ] Default and fallback region behavior has tests or validator coverage.
