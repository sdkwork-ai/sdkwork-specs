# MIG-2026-0720 API Assembly And Gateway Hosting

Status: active
Requirement: REQ-2026-0720-api-assembly-gateway-hosting
Decision: ADR-20260720-api-assembly-gateway-hosting
Owner: SDKWork platform
Type: naming, composition, runtime topology

```yaml
id: MIG-2026-0720-api-assembly-gateway-hosting
owner: sdkwork-platform
status: active
scope:
  producer: sdkwork-specs
  consumers:
    - SDKWork application repositories with HTTP APIs
    - sdkwork-api-cloud-gateway
compatibility_window:
  starts_at: 2026-07-20
  ends_at: 2026-08-31
strategy: assembly-first-contract
rollback: return validators to audit mode without restoring application cloud-gateway ownership
```

## Migration Sequence

1. Materialize `sdkwork-api-<application-code>-assembly` from component specs,
   route manifests, and Cargo metadata.
2. Validate complete app-api/backend-api/open-api ownership and route uniqueness.
3. Introduce `sdkwork-api-<application-code>-standalone-gateway` and make it
   consume only assemblies for application API capabilities.
4. Remove duplicate route/service/repository/database dependencies and direct
   route merges from the gateway host.
5. Change `pnpm dev` to the canonical standalone host and prove one listener.
6. Remove application cloud-gateway dependencies, startup scripts, TOML files,
   topology ownership, tests, deployment bundles, and release assets.
7. Register the application assembly from the `sdkwork-api-cloud-gateway`
   repository and validate cross-assembly collisions.
8. Rename composition output from `external-via-platform-gateway` to
   `external-via-platform-surface` and from
   `requiresPlatformGatewayProcess` to `requiresPlatformApiSurface`.
9. Decompose component `integration.foundationApiGateway` into topology
   `platform.api-gateway` URL provenance, `sdkDependencies`, and
   `dependencyApiSurfaces`, then remove the legacy field.
10. Remove retired names and enable required workspace gates.

## Compatibility

- Old assembly manifests are read-only migration inputs.
- New materialization always writes `sdkwork.api.assembly` and canonical names.
- Temporary command aliases may exist only during the compatibility window and
  must emit deprecation diagnostics; they are not accepted as release evidence.
- Application source may consume deployed API URLs but may not identify or
  operate the remote cloud gateway implementation.
- `integration.foundationApiGateway` may be read only as migration input; new
  component specs and generated output must not emit it.

## Rollback

- Revert checker enforcement to audit for the affected consumer under a dated
  governance exception.
- Keep the canonical assembly and standalone command additions.
- Do not restore application dependencies on or autostart of
  `sdkwork-api-cloud-gateway`.
- Roll back a failed runtime release using the previous immutable application
  artifact; database changes require their own migration plan.

## Exit Evidence

- Canonical assembly and standalone gateway identities are active.
- Assembly completeness, deterministic materialization, route collisions,
  thin-host dependencies, single ingress, and package lifecycle checks pass.
- Application cloud-gateway boundary scan reports zero findings.
- Application component specs contain no `integration.foundationApiGateway`.
- Platform cloud gateway composition consumes the assembly from the platform side.
