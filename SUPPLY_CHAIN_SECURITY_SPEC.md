# Supply Chain Security Standard

- Version: 1.1
- Scope: dependency integrity, build integrity, artifact signing, SBOM, provenance, attestations, release supply-chain evidence
- Related: `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `APP_MANIFEST_SPEC.md`, `RELEASE_SPEC.md`, `QUALITY_GATE_SPEC.md`, `CODE_REVIEW_SPEC.md`, `COMPOSABLE_ARCHITECTURE_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `SDK_PACKAGE_NAMING_SPEC.md`, `SDK_MANIFEST_SPEC.md`, `DOCUMENTATION_SPEC.md`, `TEST_SPEC.md`, `GOVERNANCE_SPEC.md`

This standard defines how SDKWork proves that source, dependencies, build steps, generated artifacts, and release artifacts are traceable and tamper-resistant. It aligns with NIST SSDF, SLSA, CycloneDX, SPDX, and in-toto concepts without requiring every repository to reach the same maturity level on day one.

## 1. Supply Chain Model

SDKWork supply-chain evidence covers:

```text
source -> dependencies -> build environment -> generated artifacts -> packaged artifacts -> published release
```

Rules:

- Source-controlled config must not contain secrets, private keys, or live credentials.
- Dependency versions and generator versions must be traceable.
- Build artifacts must trace to source revision, workflow run, toolchain, package target, and dependency refs.
- Generated SDK artifacts must trace to OpenAPI/proto/generator inputs.
- Generated or derived composition artifacts, including `generated/composition.resolved.json` and SDK family `sdk-manifest.json`, must trace to native dependency manifests, component specs, route manifests, OpenAPI/proto authorities, and approved resolver or generator commands.
- Release artifacts must include checksums and signing/SBOM/provenance evidence when required by release policy.
- Evidence identity `MUST` include deployment profile and runtime target so
  standalone and cloud artifacts from one version cannot overwrite or borrow
  each other's checksum, signature, SBOM, provenance, or attestation.

## 2. Dependency Integrity

Rules:

- Package managers should use lockfiles or equivalent reproducible dependency manifests.
- Dependency refs in workflow config must be pinned or validated as safe refs before checkout.
- Application workflow YAML must not hide dependency checkout logic outside `agent.workflow.json` and the reusable workflow framework.
- Native build-tool dependency declarations, source/build dependency paths, release checkout refs, stale dependency cleanup, and dependency-owned SDK/API boundaries must follow `DEPENDENCY_MANAGEMENT_SPEC.md`.
- Dependencies with known critical vulnerabilities require remediation, mitigation, or an approved exception.
- New third-party runtime dependencies should have license, maintenance, security, and package-source review.
- Source dependencies under `external/`, `third_party/`, or `vendor/` `MUST` record an immutable upstream revision or release identity, canonical source location, license review, and the native lockfile or dependency-graph impact.
- Verification `MUST` prove a packaged upstream source tree is unchanged from its recorded revision. Local patches, untracked SDKWork-authored files, generated output, and runtime state invalidate that evidence.
- Packaged applications that embed upstream source dependencies `MUST` include those dependencies in SBOM/provenance and record the exact upstream revision used by the build.
- Upstream upgrades `MUST` be reviewed as dedicated dependency changes so source diff, license, vulnerability, lockfile, feature, and native-link impact remain attributable.

## 3. Build Integrity

Rules:

- Production builds must run in controlled CI/release environments or documented trusted build hosts.
- Build steps must not download and execute unauthenticated scripts as release authority.
- Build logs must not print tokens, API keys, private keys, signing credentials, or credential-bearing URLs.
- Toolchain versions should be declared through standard workflow/toolchain config.
- Build output must not include local override files, runtime databases, logs, caches, or user-private state.
- Build output must not include `cloud.development` endpoints, developer CORS
  origins, local tunnel configuration, or development bootstrap credentials.
- Deployment jobs consume immutable published artifact evidence and must not
  rebuild source after approval or substitute a mutable container tag for the
  approved digest.

## 4. SBOM And Provenance

Rules:

- SBOMs should use CycloneDX or SPDX.
- Provenance should use SLSA or in-toto-compatible attestations where tooling supports it.
- SBOM and provenance files are release evidence and must match the artifact version and package id.
- A package requiring `sbomRequired` must fail release validation when SBOM evidence is missing.
- A package requiring artifact attestations must fail release validation when provenance/attestation evidence is missing.
- Deployment-consumable evidence uses
  `schemas/sdkwork.artifact-evidence.schema.v1.json`; `artifactId`, digest,
  version, source commit, package id, SBOM, provenance, and signature are
  mandatory and the selected deployment profile must be supported by the
  evidence.

## 5. Signing And Checksums

Rules:

- Release artifacts should have immutable checksums.
- Signing keys must not be committed to source.
- Signing references may be stored in manifest or workflow config; private material belongs in secret managers or protected CI environments.
- When a build tool requires decoded signing material, it `MUST` be written only to a private
  runner/OS temporary directory outside every source checkout, use the narrowest supported file
  permissions, and be removed in `finally` and registered signal handlers. Repository/application
  ignored directories, including `.runtime/`, are forbidden signing-material locations.
- When signing is required globally, target-level config must not disable signing without governance approval.
- Signature verification instructions should be documented for externally distributed artifacts.

### 5.1 Runtime Target Supply-Chain Evidence

Artifact evidence `MUST` match the package runtime target and distribution
channel.

| Runtime target class | Required evidence |
| --- | --- |
| `browser` and H5 web | Build provenance, asset checksums when packaged, public runtime config provenance, and CDN/edge publication trace. |
| `desktop` | Installer/app bundle checksum, OS signing or notarization evidence where applicable, update feed provenance, and bundled dependency inventory. |
| `tablet-*`, `capacitor-*`, `flutter-*`, native mobile | Platform signing/provisioning evidence, app-store/private track record, package checksum when directly distributed, and toolchain provenance. |
| `mini-program` | Upload identity, platform app id, package checksum when exported, review/release record, and platform key custody evidence. |
| `server` | Archive/service checksum, build provenance, SBOM, signing when required, and runtime config template provenance. |
| `container` | Immutable OCI digest or Docker-compatible image digest, SBOM/provenance, base image trace, and attestation when enabled. |
| `test-runner` | Workflow/test artifact provenance; `non-deployable` binding and no production signing claim. |

Rules:

- Docker-compatible image tags are not immutable evidence. Release records must
  store the digest used by the deployment or publication.
- OCI image evidence `MUST` set `artifactKind = oci-image`, bind `digest` to
  the remote registry `artifactLocator` suffix, and preserve a local image
  manifest at `artifactPath` whose `repoDigest` exactly equals that locator.
  A local image id, mutable tag, or hash of the image-manifest JSON file
  `MUST NOT` substitute for the remote registry digest.
- Mobile, tablet, desktop, and mini program signing credentials `MUST` live in
  protected CI environments, platform key stores, or approved secret managers,
  not in source-controlled manifests, config, or package assets.
- Browser and H5 packages must not embed private SDK endpoints, auth tokens,
  API keys, or tenant-specific runtime config in static assets.
- Runtime-configurable client provenance `MUST` record the exact supported
  deployment-profile set, default profile, target platform, client
  architecture, and runtime config schema version. Endpoint runtime config is
  separately versioned and integrity-protected; it is not allowed to mutate
  the signed binary identity silently.
- Switching profile/origin must not reuse credentials or mutable offline state
  across issuer/security boundaries. Release evidence includes tests for
  secure-storage namespace isolation and re-authentication.

## 6. Generated Artifacts

Rules:

- Generated SDK output must be produced from approved generator inputs and recorded generator versions.
- Generated composition output must be produced by `resolve-composition.mjs`; hand-edited composition output is not valid supply-chain evidence.
- SDK family manifests must be source-controlled family-root metadata and must not be regenerated from unreviewed generated transport output.
- Generated output must not be hand-edited outside approved custom extension points.
- Generated artifact provenance should identify the source OpenAPI/proto, generator command, generator version/ref, and output package.
- Consumers must not regenerate dependency-owned APIs into application-owned SDK families.

## 7. Review And Exceptions

Rules:

- Supply-chain exceptions require owner, reason, risk, expiry, and compensating control.
- Security-critical dependency or build-system changes require code review under `CODE_REVIEW_SPEC.md`.
- Release gate evidence under `QUALITY_GATE_SPEC.md` must include supply-chain evidence when artifacts are packaged or distributed.

## 8. Acceptance Checklist

- [ ] Dependency refs and lockfiles are traceable.
- [ ] Read-only upstream source revisions, canonical sources, licenses, clean-tree evidence, and packaged SBOM/provenance entries are traceable.
- [ ] Build environment and toolchains are declared.
- [ ] Generated artifacts trace to source contracts and generator inputs.
- [ ] Artifacts have checksums.
- [ ] Signing, SBOM, and provenance are present when required.
- [ ] Secrets are not committed or logged.
- [ ] Exceptions have owner, expiry, and compensating control.
