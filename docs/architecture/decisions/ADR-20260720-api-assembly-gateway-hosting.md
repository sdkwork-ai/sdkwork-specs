# ADR-20260720 API Assembly And Gateway Hosting

Status: accepted
Requirement: REQ-2026-0720-api-assembly-gateway-hosting
Owner: SDKWork platform
Date: 2026-07-20
Specs: `API_ASSEMBLY_SPEC.md`, `APPLICATION_GATEWAY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `PNPM_SCRIPT_SPEC.md`

## Context

Gateway processes and application API composition currently share naming,
dependencies, configuration, and lifecycle behavior. This causes applications
to start the platform cloud gateway during standalone development and causes
standalone gateways to duplicate implementation dependencies already present
in a API assembly.

## Decision

- API composition becomes a first-class host-neutral component named
  `sdkwork-api-<application-code>-assembly`.
- Every application assembly includes all application-owned app-api,
  backend-api, and open-api route surfaces exactly once.
- Application standalone HTTP uses
  `sdkwork-api-<application-code>-standalone-gateway`.
- `sdkwork-api-cloud-gateway` is the only cloud HTTP gateway role and is owned
  exclusively by its platform repository.
- Both hosts consume API assemblies. Applications never depend on, start,
  configure, package, or publish the platform cloud gateway.
- Application-level HTTP cloud gateways are retired. Protocol-specific edge or
  realtime ingress remains a separate ADR-governed role.
- `pnpm dev` remains exactly `pnpm dev:standalone`; `pnpm dev:cloud` remains a
  remote-client-only development profile.
- Client topology and composition output identify deployed API surfaces and
  endpoint provenance, not the platform gateway process or crate.

This decision supersedes the gateway composition and application cloud-gateway
parts of `ADR-20260719-unified-development-release-profiles`. Its lifecycle,
release, and deployment-profile decisions remain active.

## Alternatives

- Keep `gateway-assembly`: rejected because API composition is reusable by two
  hosts and is not owned by either gateway.
- Let applications embed cloud-gateway router builders: rejected because it
  reverses platform ownership and couples local development to a platform host.
- Keep dedicated application HTTP cloud gateways: rejected because the same API
  assembly can be hosted by the platform gateway; exceptional non-HTTP ingress
  needs a protocol-specific role rather than a second generic HTTP gateway.

## Consequences

- Public crate and command names require a governed migration.
- Application roots lose cloud-gateway config bundles and autostart behavior.
- Gateway hosts become thin, while assemblies own API bootstrap dependencies.
- The platform gateway must select assemblies and validate cross-assembly route
  collisions from its own repository.
- Consumer repositories migrate independently after the standards/tooling gate.
- Existing `external-via-platform-gateway` and
  `requiresPlatformGatewayProcess` fields become migration-only inputs and are
  replaced by `external-via-platform-surface` and
  `requiresPlatformApiSurface`.
- Component `integration.foundationApiGateway` is retired because it duplicates
  topology URL provenance, SDK ownership, and dependency runtime availability.
  Its data is decomposed into `platform.api-gateway`, `sdkDependencies`, and
  `dependencyApiSurfaces`; no replacement gateway-identity field is added.

## Verification

- API assembly completeness and deterministic-manifest validation.
- Application cloud-gateway boundary scan.
- Thin-host dependency and direct-route-merge scan.
- Single HTTP ingress and package lifecycle checks.
- Cross-assembly route collision audit in the platform gateway workspace.

## Supersedes / Superseded By

Supersedes gateway-hosting portions of
`ADR-20260719-unified-development-release-profiles`.

Extended by `ADR-20260809-platform-gateway-realtime-hosting` (the platform
cloud gateway may host a declared application realtime plane).
