# MIG-2026-0720 Unified Development, Release, And Deployment Profiles

Status: active
Requirement: REQ-2026-0720
Decision: ADR-20260719-unified-development-release-profiles
Owner: SDKWork platform
Type: config, package, release

```yaml
id: MIG-2026-0720
owner: sdkwork-platform
status: active
requirement: REQ-2026-0720
type: mixed
scope:
  producers:
    - sdkwork-specs
    - sdkwork-github-workflow
    - sdkwork-app-topology
  consumers:
    - pnpm-managed SDKWork application repositories
compatibility_window:
  starts_at: 2026-07-19
  ends_at: 2026-08-31
strategy: expand-contract
rollback: retain additive profile scripts and temporarily restore checker audit behavior while application configs are repaired
framework_first: true
consumer_bulk_edit: false
```

## Entry Criteria

- Root application identity and topology spec are known.
- `standalone.development` can start the current local application unit.
- Deployed cloud development application/platform URLs and allowed local
  development origins are known.
- Release targets, deployment providers, protected environments, and rollback
  owners are inventoried.

## Framework Gate

Consumer migration `MUST NOT` begin until `sdkwork-app-topology`,
`sdkwork-github-workflow`, and `deployctl` pass their repository verification.
The workspace audit assigns each application to a migration wave. A wave is a
planning boundary, not authorization for a bulk edit; each application keeps
an application-scoped review, smoke test, release evidence set, and rollback.

Applications retain their language- and toolchain-specific commands as private
`_sdkwork:*` hooks while public scripts delegate to the shared facade. This
allows Rust, Node/Vite, Tauri, Flutter, Gradle, Xcode, Harmony, and mini-program
implementations to share lifecycle policy without pretending their build tools
are identical.

| Wave | Entry condition | Migration intent |
| --- | --- | --- |
| 0 | Shared framework or foundation dependency | Stabilize and pin framework contracts |
| 1 | Topology, workflow, and deploy declarations exist | Pilot the complete lifecycle |
| 2 | Topology and workflow declarations exist | Add deployment contract and evidence |
| 3 | Topology declaration exists | Add workflow, packaging, and deployment contracts |
| 4 | Package-manager root exists without topology | Establish topology, then adopt the facade |
| 5 | App manifest exists without a package-manager root | Classify native/non-package-manager lifecycle and add an approved adapter only where needed |

## Migration Sequence

1. Run the package-manager and topology checkers in audit/reporting context and record all
   missing scripts, profiles, URLs, local cloud autostarts, and lifecycle
   command-order debt.
2. Add `dev:standalone` and `dev:cloud`; keep existing internal runners behind
   the standard dispatcher.
3. Change bare `dev` to directly delegate to `dev:standalone`.
4. Materialize `cloud.development` with explicit deployed URLs, bounded health
   surfaces, and no local API/gateway/database/cache bootstrap.
5. Add phase-first standalone/cloud release and deploy variants. Keep package,
   publish, and deployment as separate gates.
6. Align `sdkwork.app.config.json`, `sdkwork.workflow.json`, package ids,
   `deployments/deploy.yaml`, GitHub Environments, and rollback evidence.
7. Classify client packages as fixed or runtime-configurable. Runtime-configurable
   clients declare both supported profiles, target platform, client architecture,
   isolated endpoint/credential namespaces, and `dual` package ids.
8. Upgrade topology to v5, remove application cloud-gateway identity, and
   declare explicit remote API surfaces. API host migration follows
   `MIG-2026-0720-api-assembly-gateway-hosting`.
9. Upgrade production deploy manifests to v2 typed deployment dimensions;
   remove development profiles and production source-tree installs unless an
   approved exception exists.
10. Run standalone and cloud development smoke tests, package matrix tests,
   release validation, and non-production deployment/rollback rehearsals.
11. Remove retired aliases only after all active documentation, runners, and CI
   calls use canonical commands.
12. Enable required validator enforcement and close the migration record after
   the workspace audit is clean.

## Commands

Read-only verification:

```text
node ../sdkwork-specs/tools/check-pnpm-script-standard.mjs --root . --application-code-prefix <application-code>
node ../sdkwork-specs/tools/check-topology-deployment-profiles.mjs --workspace .. --repo <repository>
```

Scoped alignment, only after reviewing dry-run output:

```text
node ../sdkwork-specs/tools/align-app-topology-deployment-profiles.mjs --workspace .. --repo <repository> --dry-run
node ../sdkwork-specs/tools/align-app-topology-deployment-profiles.mjs --workspace .. --repo <repository>
```

The aligner deliberately leaves unknown cloud development URLs empty so an
operator must supply the correct deployed endpoints. Empty or placeholder URLs
continue to fail validation.

## Compatibility And Cutover

- Canonical scripts are additive during the compatibility window.
- Topology v4 and deploy manifest v1 are read-only migration inputs. New or
  aligned contracts emit topology v5 and deploy v2.
- Legacy client package `deploymentProfile` implies `profileBinding = fixed`
  during the compatibility window. It does not silently become dual-profile.
- Retired commands may delegate to canonical scripts temporarily, but they may
  not remain in active docs or become release/deployment authority.
- Production publish/apply/rollback through ambiguous legacy aggregates is
  blocked once canonical profile variants exist.
- The cutover is complete only when every active application passes both
  checkers and its release/deploy workflow records profile-specific evidence.

## Rollback

- If the stricter checker blocks an application before its configuration can
  be repaired, revert enforcement to audit for that repository under a dated
  governance exception; do not restore cloud localhost fallback.
- Keep additive canonical scripts and topology files during rollback so the
  next migration attempt does not reintroduce naming debt.
- A failed cloud deployment rolls back by immutable artifact digest and
  deployment config; a failed standalone publication restores the previous
  download/store/update-channel target.
- Database or irreversible data migrations require their own forward-fix or
  rollback plan and are not authorized by this command migration.

## Exit Evidence

- Package-manager and topology validators pass for every migrated application.
- `pnpm dev` and `pnpm dev:standalone` resolve identically.
- `pnpm dev:cloud` starts no local API-plane dependency and reaches the declared
  cloud development surfaces.
- Standalone and cloud release matrices each select valid artifacts.
- Every side-effecting deployment records a validated artifact evidence
  document containing package identity, artifact path, digest recomputed from
  packaged bytes, source commit, SBOM,
  provenance, signature, and profile support; no deployment may rely only on a
  CLI digest string.
- Every deployable package lifecycle generates evidence before upload; aggregate
  Release downloads only `sdkwork-publishable-*` workflow artifacts.
- Topology v5 and resolved-plan schemas validate migrated declarations, and
  nginx apply/rollback integration tests cover atomic replacement and failed
  test/reload restoration.
- Publish, apply, validate, smoke, and rollback evidence is attributable to
  profile, environment, runtime target, package id, version, and digest.
