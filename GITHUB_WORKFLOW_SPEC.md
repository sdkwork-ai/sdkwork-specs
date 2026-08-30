# GitHub Workflow Standard

- Version: 1.0
- Scope: SDKWork application GitHub Actions packaging, release workflow integration, artifact publication, deployment workflow integration, supply-chain policy execution, and the reusable `sdkwork-github-workflow` framework
- Related: `SOUL.md`, `AGENTS_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, `CODE_STYLE_SPEC.md`, `TYPESCRIPT_CODE_SPEC.md`, `APP_MANIFEST_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `DEPENDENCY_MANAGEMENT_SPEC.md`, `COMPOSABLE_ARCHITECTURE_SPEC.md`, `APP_COMPOSITION_SPEC.md`, `APP_PERMISSION_COMPOSITION_SPEC.md`, `DEPLOYMENT_SPEC.md`, `RELEASE_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `QUALITY_GATE_SPEC.md`, `SECURITY_SPEC.md`, `DOCUMENTATION_SPEC.md`, `TEST_SPEC.md`

This standard defines how SDKWork applications integrate with GitHub Actions for packaging and deployment. The goal is one reusable framework and one application-side contract, not copied release YAML in every application repository.

Release policy is governed by `RELEASE_SPEC.md`. Supply-chain security policy is governed by `SUPPLY_CHAIN_SECURITY_SPEC.md`. This workflow standard defines how `sdkwork-github-workflow` executes and verifies those policies through reusable workflow configuration.

## 1. System Model

Rules:

- The canonical reusable workflow framework is the `sdkwork-github-workflow` repository.
- Application repositories own `sdkwork.workflow.json`.
- Application repositories own one thin `.github/workflows/package.yml` entrypoint that calls `sdkwork-ai/sdkwork-github-workflow/.github/workflows/sdkwork-package.yml@<ref>`.
- Application-specific build, package, validation, signing, SBOM, deploy, and publish commands live in lifecycle steps inside `sdkwork.workflow.json`.
- Framework-level behavior lives in reusable workflows, composite actions, and tested planner code in `sdkwork-github-workflow`.
- Application repositories `MUST NOT` copy large framework workflow bodies, dependency checkout scripts, matrix planners, release upload logic, or attestation logic into local workflow YAML.

The standard integration shape is:

```text
<application-root>/
  sdkwork.workflow.json
  .github/
    workflows/
      package.yml
```

## 2. Application Entrypoint

Rules:

- `.github/workflows/package.yml` `MUST` be a thin reusable workflow call.
- The workflow `uses:` target `MUST` point to `sdkwork-ai/sdkwork-github-workflow/.github/workflows/sdkwork-package.yml@<pinned-ref>`.
- The workflow `MUST` pass `config_path: sdkwork.workflow.json` unless the configuration file has an explicitly documented alternate location.
- The workflow `SHOULD` support these standard triggers:
  - tag push for release packaging.
  - `release.published` for release packaging and configured deployments.
  - `workflow_dispatch` for manual deployment-profile/platform/profile/architecture/format selection.
- Manual dispatch inputs `MUST` use event-safe expressions such as `github.event.inputs.*` with tag and release fallbacks for non-manual events.
- Production deployments `MUST` use GitHub Environments for approval rules and environment-scoped secrets.
- Application workflows `MUST NOT` request broader GitHub permissions than the reusable framework requires unless the exception is documented and reviewed.
- Application repositories `MUST NOT` keep copied packaging/release workflow
  files such as `.github/workflows/release-package.yml` or
  `.github/workflows/package-release.yml`. Package, release upload,
  dependency checkout, changelog, attestation, and deployment packaging logic
  belongs in the reusable framework plus `sdkwork.workflow.json`.

## 3. Configuration Contract

`sdkwork.workflow.json` is the application packaging contract consumed by `sdkwork-github-workflow`.

Required top-level fields:

- `schemaVersion`
- `app`
- `release`
- `targets`

Supported top-level optional fields:

- `$schema`
- `dependencies`
- `verificationDependencies`
- `toolchains`
- `lifecycle`
- `security`
- `publish`
- `deployments`

Rules:

- Unknown top-level and nested fields `MUST` fail validation. The planner and JSON Schema must stay aligned.
- `schemaVersion` `MUST` match the framework schema version supported by the target framework ref.
- `$schema`, when present in application config examples or generated output, `MUST` be explicitly allowed by both JSON Schema and planner validation.
- `app.id` `MUST` be a stable lowercase identifier. `release.artifactPrefix` `MUST` be a stable lowercase kebab token suitable for artifact names.
- `app.name`, when present, `MUST` be a non-empty string.
- `app.repository` and dependency repositories `MUST` use `owner/repo` form.
- `release.changelog`, when present, `MUST` declare a framework-supported changelog source: `auto`, `app-manifest`, `file`, `git`, or `none`.
- `release.changelog.source: auto` `MUST` resolve release notes from `sdkwork.app.config.json` `release.notes[]`, then a repository-root `CHANGELOG.md`, then recent git commit subjects.
- `release.changelog.source: app-manifest` `MUST` read the application manifest selected by `app.configPath` or `sdkwork.app.config.json` and require a matching release note for the package version, tag, or current manifest note.
- `release.changelog.source: file` `MUST` require `release.changelog.path`, and that path `MUST` be a safe relative markdown path.
- `release.changelog.maxCommitSubjects`, when present, `MUST` be an integer from 1 to 200.
- Package version resolution `MUST` be consistent across matrix planning, lifecycle steps, and changelog rendering. Explicit `package_version` input wins; when it is omitted, the framework `MUST` derive the package version from the release tag or tag ref by stripping `refs/tags/` and a leading `v` before falling back to `release.defaultVersion`.
- Toolchain version fields such as `node`, `pnpm`, `python`, `java`, `go`, `rust`, `flutter`, `dotnet`, and `wix` `MUST` be strings. Boolean toolchain toggles such as `android` and `xcode` `MUST` be booleans.
- Paths such as `app.sourcePath`, `app.configPath`, dependency checkout paths, lifecycle working directories, and output globs `MUST` be safe relative paths. They must not be absolute, escape the repository with `..`, or use platform-specific backslash traversal.
- Package target identifiers and optional `packageId` values `MUST` be stable
  because they appear in artifact names, deployment selection, and lifecycle
  environment variables.
- Deployable package targets `MUST` declare one fixed `deploymentProfile` or a
  runtime-configurable supported-profile set, and `runtimeTarget` separately
  from the package `profile`.
- `publish` and `security` fields `MUST` be consumed by the reusable workflow, not only stored as documentation.
- Manual profile selection uses one normalized `deployment_profile` input with
  `standalone`, `cloud`, or `all`. `all` is valid for planning, building,
  packaging, and validation; side-effecting publish or deploy jobs require an
  explicit profile or a source-controlled approved all-profile release plan.
- Deployment selection also requires `deploy_environment`; it must not derive
  production from a tag, branch, profile default, or package target alone.

## 4. Lifecycle Steps

Supported lifecycle phases, in package-job order:

1. `preflight`
2. `install`
3. `build`
4. `stage`
5. `package`
6. `sign`
7. `sbom`
8. `validate`

Supported deployment lifecycle phases:

- `deploy`
- `publish`

Rules:

- Lifecycle steps support `run` commands only.
- Lifecycle steps `MUST NOT` declare dynamic `uses:` entries. Shared actions belong in the framework as composite actions.
- Lifecycle step `name`, when present, `MUST` be a non-empty string.
- Supported shells are `bash`, `sh`, `pwsh`, `powershell`, `cmd`, and `node`.
- Step `env` values `MUST` be strings.
- Step `workingDirectory` values `MUST` be safe relative paths.
- Lifecycle execution `MUST` stop on the first failed step.
- Release workflows for composable applications `MUST` run the applicable composition validators in `preflight` or `validate` before artifact publication when module, dependency SDK, route, permission, frontend package, Rust backend, or resolver behavior is part of the release scope.
- The framework `MUST` provide standard environment variables to every package
  target lifecycle step:
  - `SDKWORK_APP_ID`
  - `SDKWORK_APP_REPOSITORY`
  - `SDKWORK_APP_SOURCE_PATH`
  - `SDKWORK_RELEASE_TAG`
  - `SDKWORK_PACKAGE_VERSION`
  - `SDKWORK_PACKAGE_TARGET_ID`
  - `SDKWORK_PACKAGE_ID`
  - `SDKWORK_DEPLOYMENT_PROFILE` for fixed targets, or
    `SDKWORK_SUPPORTED_DEPLOYMENT_PROFILES` for runtime-configurable targets
  - `SDKWORK_RUNTIME_TARGET`
  - `SDKWORK_PACKAGE_PROFILE`
  - `SDKWORK_PACKAGE_PLATFORM`
  - `SDKWORK_PACKAGE_ARCHITECTURE`
  - `SDKWORK_PACKAGE_FORMAT`
- Linux native `deb` and `rpm` package lifecycle steps `MUST` also receive `SDKWORK_PACKAGE_DISTRIBUTION`.
- Package targets with `targets[].variant` `MUST` also receive `SDKWORK_PACKAGE_VARIANT`.
- Deployment lifecycle steps `MUST` also receive:
  - `SDKWORK_DEPLOYMENT_PROFILE`
  - `SDKWORK_RUNTIME_TARGET`
  - `SDKWORK_DEPLOY_ENVIRONMENT`
  - `SDKWORK_DEPLOY_URL` when configured.
  - `SDKWORK_DEPLOY_LIFECYCLE`
- Aggregate GitHub Release publish lifecycle steps `MUST` run in a framework-defined aggregate context instead of inheriting the first package target context. They receive:
  - `SDKWORK_RELEASE_AGGREGATE=true`
  - `SDKWORK_PACKAGE_TARGET_ID=aggregate-release`
  - `SDKWORK_PACKAGE_ID=aggregate-release`
  - `SDKWORK_PACKAGE_PROFILE=library`
  - `SDKWORK_PACKAGE_PLATFORM=web`
  - `SDKWORK_PACKAGE_ARCHITECTURE=noarch`
  - `SDKWORK_PACKAGE_FORMAT=zip`
  - `SDKWORK_AGGREGATE_ARTIFACT_PATH`
  - `SDKWORK_AGGREGATE_UPLOAD_GLOBS`
- Aggregate publish steps are not deployable target contexts and `MUST NOT`
  synthesize a non-standard `deploymentProfile` or `runtimeTarget` value.

## 5. Targets And Matrix Planning

### 5.0 Shared Framework Boundary

`sdkwork-github-workflow` is the single workflow planner and reusable GitHub
Actions implementation for application release matrices. It is composed with
`sdkwork-app-topology` for local development/topology resolution and
`sdkwork-specs/tools/deployctl.mjs` for typed deployment apply/rollback. An
application repository `MUST NOT` copy matrix, artifact publication, release
notes, attestation, or deployment selection logic into its local workflow YAML.
Application-specific build commands remain lifecycle steps or private
`_sdkwork:*` pnpm hooks behind the public facade described by
`PNPM_SCRIPT_SPEC.md`.

Rules:

- Matrix planning `MUST` be deterministic and implemented in tested code, not duplicated YAML expressions.
- `targets[]` `MUST` declare profileBinding, runtimeTarget, profile, platform,
  architecture, formats, runner, and output globs. Fixed targets declare one
  deploymentProfile; runtime-configurable client targets declare
  supportedDeploymentProfiles and defaultDeploymentProfile.
- New client targets `MUST` also declare `targetPlatform` and
  `clientArchitecture` using the canonical values from `APP_MANIFEST_SPEC.md`.
  `targetPlatform` must match the workflow `platform`; the planner carries both
  client axes into package matrices and lifecycle environments without treating
  either as a deployment profile. Existing targets may omit the pair only
  during the compatibility migration window.
- `targets` `MUST` contain at least one target.
- `targets[].platform` identifies the delivery ecosystem or package platform,
  such as `web`, `h5`, `h5-weixin`, `windows`, `macos`, `linux`, `container`,
  `android`, `ios`, `harmony`, `ipados`, `android-tablet`, `mp-weixin`,
  `mp-alipay`, `mp-dingtalk`, or another approved lower kebab platform token.
- `targets[].profile` is the package profile segment. Standard profiles are
  `browser`, `desktop`, `mobile`, `tablet`, `mini-program`, `server`,
  `container`, `worker`, `library`, and `test`. It is not a deployment profile
  and must not use `web`, `docker`, `standalone`, or `cloud`.
- `targets[].profileBinding` is `fixed`, `runtime-configurable`, or
  `non-deployable`.
- Fixed deployable targets `MUST` declare `targets[].deploymentProfile` as
  `standalone` or `cloud` and `MUST NOT` declare a supported-profile set.
- Runtime-configurable targets are limited to browser, desktop, tablet,
  Capacitor, Flutter, native mobile, Harmony, and mini-program clients. They
  `MUST` declare exactly the unique `supportedDeploymentProfiles` values
  `standalone` and `cloud`, plus a supported default. Server, gateway, worker,
  and container targets `MUST NOT` use runtime-configurable binding.
- `targets[].runtimeTarget` `MUST` describe where the package runs using the
  runtime target vocabulary from `CONFIG_SPEC.md`, such as `server`,
  `container`, `desktop`, `browser`, `tablet-ipados`, `tablet-android`,
  `capacitor-ios`, `capacitor-android`, `flutter-ios`, `flutter-android`,
  `android-native`, `ios-native`, `harmony-native`, `mini-program`, or
  `test-runner`. It must not be used as a deployment profile.
- `non-deployable` targets are limited to `runtimeTarget = test-runner`; they
  emit workflow/test evidence, must not declare a deployment profile, and must
  not appear in publication or deployment job selectors.
- `targets[].formats` `MUST` contain unique format values so one target cannot emit duplicate package jobs or duplicate artifact names.
- Selecting no targets for a requested deployment profile/platform/profile/architecture/format `MUST` fail before package jobs run.
- A dual-profile application matrix `MUST` cover both profiles through fixed
  targets, a runtime-configurable client target, or both. The planner must not
  clone a signed client binary merely to change an endpoint profile.
- Every fixed matrix package item `MUST` have a canonical `packageId` using
  `<platform>-<architecture>-<deployment-profile>-<profile>-<format-token>`.
- Every runtime-configurable matrix package item `MUST` use
  `<platform>-<architecture>-dual-<profile>-<format-token>`.
  `dual` is an artifact-binding token and `MUST NOT` be accepted as a
  deploymentProfile value.
- Linux native `deb` and `rpm` package items `MUST` use `linux-<distribution>-<architecture>-<deployment-profile>-<profile>-<format-token>`.
- Package targets with a real package variant `MUST` insert the lowercase kebab `variant` segment before the format token: `<platform>-<architecture>-<deployment-profile>-<profile>-<variant>-<format-token>`. Linux native package variants use `linux-<distribution>-<architecture>-<deployment-profile>-<profile>-<variant>-<format-token>`.
- Use `targets[].variant` only when two or more releasable artifacts would otherwise share the same platform, architecture, deployment profile, profile, and format. Common examples are container or deployment packages split by `cpu`, `nvidia-cuda`, or `amd-rocm`.
- `format-token` `MUST` be lowercase kebab-case. Format values with separators normalize those separators to hyphens; for example `tar.gz` becomes `tar-gz`.
- GitHub workflow artifact names `MUST` use `<release.artifactPrefix>-<packageId>`.
- Multi-format targets `MUST` produce distinct package ids and artifact names for each format.
- Single-format `targets[].id` `MUST` equal the canonical package id.
  Multi-format fixed ids use
  `<platform>-<architecture>-<deployment-profile>-<profile>`; runtime-configurable
  ids use `<platform>-<architecture>-dual-<profile>`.
- When `sdkwork.app.config.json` has a current release note, every enabled
  `release.notes[].packageIds` entry `MUST` resolve to one exact single-format
  workflow target. The package id, runtime target, deployment profile, and
  architecture must match. This includes container packages whose manifest URL
  still points at the previously published digest.
- Explicit `targets[].packageId`, when present, `MUST` equal the canonical package id for a single-format target. Multi-format targets `MUST` omit `packageId` so the planner can generate one package id per format.
- Targets with format-specific output globs `SHOULD` be split into separate single-format targets. Windows desktop packages that produce both `.msi` and `.exe` installers SHOULD use `windows-x64-standalone-desktop-msi` and `windows-x64-standalone-desktop-exe` as separate targets unless one lifecycle command deliberately emits only the active `SDKWORK_PACKAGE_FORMAT`.
- `targets[].distribution` is required for `platform: linux` with `formats: ["deb"]` or `formats: ["rpm"]`, and it is invalid for generic Linux archive formats such as `tar.gz`.
- `targets[].variant`, when present, `MUST` be lowercase kebab-case and `MUST` be part of `targets[].id`, generated `packageId`, artifact names, lifecycle environment, and deployment selection.
- `deb` targets `MUST` use `distribution: debian` or `distribution: ubuntu`.
- `rpm` targets `MUST` use `distribution: rhel`, `distribution: centos`, `distribution: fedora`, `distribution: opensuse`, or `distribution: suse`.
- Linux native `deb` and `rpm` targets `MUST` be single-format targets. Do not mix `deb` or `rpm` with generic formats in one target because native Linux package metadata is distribution-specific while archives are generic.
- Do not use `service` as a server package alias. The package profile segment is
  `server`; the deployment profile segment remains `standalone` or `cloud`.
- Tablet packages are first-class package targets when the app supports large-screen tablet behavior. Use profile `tablet` with platforms such as `ipados`, `android-tablet`, or `windows-tablet`.
- Docker-compatible packages use platform/profile metadata for `container` and
  format `oci` or a Docker image format. `docker` must not be used as
  `deploymentProfile`, `runtimeTarget`, package profile, or topology profile.

Examples:

| App surface | Platform | Distribution | Architecture | Format | Package id |
| --- | --- | --- | --- | --- | --- |
| Cloud browser web URL | `web` | omitted | `universal` | `web-url` | `web-universal-cloud-browser-web-url` |
| Cloud H5 mobile URL | `h5` | omitted | `universal` | `web-url` | `h5-universal-cloud-mobile-web-url` |
| Cloud WeChat H5 URL | `h5-weixin` | omitted | `universal` | `web-url` | `h5-weixin-universal-cloud-mobile-web-url` |
| Standalone server Debian package | `linux` | `debian` | `x64` | `deb` | `linux-debian-x64-standalone-server-deb` |
| Standalone server Ubuntu package | `linux` | `ubuntu` | `arm64` | `deb` | `linux-ubuntu-arm64-standalone-server-deb` |
| Standalone server RHEL package | `linux` | `rhel` | `x64` | `rpm` | `linux-rhel-x64-standalone-server-rpm` |
| Standalone desktop Fedora package | `linux` | `fedora` | `x64` | `rpm` | `linux-fedora-x64-standalone-desktop-rpm` |
| Standalone server Linux archive | `linux` | omitted | `x64` | `tar.gz` | `linux-x64-standalone-server-tar-gz` |
| Standalone container | `container` | omitted | `arm64` | `oci` | `container-arm64-standalone-container-oci` |
| Cloud CPU container bundle | `container` | omitted | `x64` | `tar.gz` | `container-x64-cloud-container-cpu-tar-gz` |
| Cloud NVIDIA CUDA container bundle | `container` | omitted | `x64` | `tar.gz` | `container-x64-cloud-container-nvidia-cuda-tar-gz` |
| Standalone PC desktop | `windows` | omitted | `x64` | `msi` | `windows-x64-standalone-desktop-msi` |
| Runtime-configurable PC desktop | `windows` | omitted | `x64` | `msi` | `windows-x64-dual-desktop-msi` |
| Standalone PC desktop | `windows` | omitted | `x64` | `exe` | `windows-x64-standalone-desktop-exe` |
| Standalone PC desktop | `macos` | omitted | `arm64` | `dmg` | `macos-arm64-standalone-desktop-dmg` |
| Standalone Capacitor Android | `android` | omitted | `arm64` | `aab` | `android-arm64-standalone-mobile-aab` |
| Standalone Capacitor iOS | `ios` | omitted | `universal` | `ipa` | `ios-universal-standalone-mobile-ipa` |
| Runtime-configurable iOS client | `ios` | omitted | `universal` | `ipa` | `ios-universal-dual-mobile-ipa` |
| Standalone Flutter Android | `android` | omitted | `arm64` | `aab` | `android-arm64-standalone-mobile-aab` |
| Standalone Flutter iOS | `ios` | omitted | `universal` | `ipa` | `ios-universal-standalone-mobile-ipa` |
| Standalone mobile phone | `android` | omitted | `arm64` | `aab` | `android-arm64-standalone-mobile-aab` |
| Standalone mobile phone | `ios` | omitted | `universal` | `ipa` | `ios-universal-standalone-mobile-ipa` |
| Standalone Harmony mobile | `harmony` | omitted | `arm64` | `other` | `harmony-arm64-standalone-mobile-other` |
| Standalone tablet | `ipados` | omitted | `universal` | `ipa` | `ipados-universal-standalone-tablet-ipa` |
| Standalone Android tablet | `android-tablet` | omitted | `arm64` | `aab` | `android-tablet-arm64-standalone-tablet-aab` |
| Standalone tablet | `windows-tablet` | omitted | `x64` | `msix` | `windows-tablet-x64-standalone-tablet-msix` |
| Cloud WeChat mini program | `mp-weixin` | omitted | `universal` | `mini-program-package` | `mp-weixin-universal-cloud-mini-program-mini-program-package` |

Rows with the same package id are alternative architecture examples for the
same platform/package shape. One workflow config `MUST NOT` declare duplicate
package ids; use `targets[].variant` when one application intentionally ships
multiple artifacts for the same platform, architecture, deployment profile,
profile, and format.

## 6. Dependency Checkout

Dependency relationship policy, native build-tool dependency management, cross-platform source path rules, stale dependency cleanup, release dependency refs, and dependency-owned SDK/API ownership are governed by `DEPENDENCY_MANAGEMENT_SPEC.md`. This section defines how the GitHub workflow framework executes release and CI dependency checkout policy.

Rules:

- Dependencies `MUST` be declared in `sdkwork.workflow.json`, not hidden in application YAML.
- Runtime, build, package, or release dependencies `MUST` use `dependencies[]`.
- `dependencies[]` `MUST` be complete: every sibling repository referenced by
  the repository's native build-tool workspace (Cargo `path = "../sdkwork-*"`,
  `pnpm-workspace.yaml` `../sdkwork-*` members, pubspec `dependency_overrides`)
  `MUST` have a matching `dependencies[]` entry so the checkout materializes
  the same `../<id>` layout local development resolves. Verify with
  `sdkwork-specs/tools/check-dependency-list-completeness.mjs` before pushing
  a tag or running `workflow_dispatch`.
- Packaging and release workflows `MUST` be rehearsable locally through a
  pnpm script that runs
  `sdkwork-specs/tools/simulate-release-build.mjs` (or an equivalent
  repository-local script) in the CI layout — clone this repository and every
  pinned sibling into a throwaway tree, frozen-lockfile install, run the
  package step (DEPENDENCY_MANAGEMENT_SPEC.md §5.2).
- CI-only or boundary-test-only repositories `MAY` use
  `verificationDependencies[]` when the repository must be checked out for
  verification but is not a runtime, package, source, SDK/API ownership, or
  release dependency.
- `verificationDependencies[]` entries follow the same repository, ref,
  token, submodule, and safe checkout path rules as `dependencies[]`, and
  `SHOULD` declare `purpose`.
- `verificationDependencies[]` `MUST NOT` be used to smuggle a stale runtime,
  build, package, API, SDK, or release dependency past dependency management
  checks.
- Dependency refs may come from a fixed `ref` or from a declared `refInput` supplied through workflow variables.
- Every dependency or verification dependency with `refInput` in
  `sdkwork.workflow.json` `MUST` be exposed by the thin package workflow as a
  matching `workflow_dispatch` input and passed through `dependency_refs_json`
  to the reusable workflow. For example `SDKWORK_WEB_FRAMEWORK_REF` maps to
  `github.event.inputs.sdkwork_web_framework_ref` with a
  `vars.SDKWORK_WEB_FRAMEWORK_REF` fallback.
- Every dependency ref `MUST` be validated as a safe Git ref before checkout. Unsafe refs with control characters, whitespace, path traversal, option-like prefixes, ref lock suffixes, or Git ref metacharacters must fail.
- The v1 framework supports `SDKWORK_RELEASE_TOKEN` as the dependency checkout token. Other per-dependency token secret names are not valid unless a future framework version adds a documented token map.
- Checkout implementations `MUST NOT` put tokens in clone URLs. Use Git credential headers or first-party checkout actions so tokens are masked and not persisted in remote URLs.
- Workflow inputs such as `dependency_refs_json` `MUST NOT` be interpolated directly into shell commands. Pass them through environment variables or files before invoking planner commands.
- When `dependencies[].path` is omitted, the framework `MUST` choose a safe workflow-local checkout directory. That default is an implementation detail and `MUST NOT` be documented as a source dependency path for local development.
- Composite actions that execute shell commands `MUST` read action inputs from environment variables or structured argument arrays rather than embedding `${{ inputs.* }}` expressions directly inside shell script bodies.
- GitHub expression contexts such as `env:`, `with:`, `if:`, `name:`, `environment:`, and `concurrency:` may reference workflow inputs when GitHub evaluates them before shell execution. The unsafe boundary is the shell script body itself.
- Dependency checkout paths `MUST` be safe relative paths and must not overlap or overwrite the application source path or framework checkout path.

## 7. Publication And Supply Chain Policy

Publication workflow fields execute release and supply-chain policy; they do not define the policy authority. Release readiness follows `QUALITY_GATE_SPEC.md` and `RELEASE_SPEC.md`. Dependency, signing, SBOM, provenance, checksum, and attestation requirements follow `SUPPLY_CHAIN_SECURITY_SPEC.md`.

Rules:

- The reusable workflow `MUST` use explicit least-privilege permissions.
- Release workflows `SHOULD` use OIDC-capable publication where external cloud providers are involved.
- `security.signingRequired: true` `MUST` require non-empty `lifecycle.sign` steps.
- `security.sbomRequired: true` `MUST` require non-empty `lifecycle.sbom` steps.
- Logging-only `echo`, `Write-Host`, or `console.log` placeholders do not
  satisfy required signing or SBOM lifecycle policy. Required steps must invoke
  an executable producer that fails when the requested evidence cannot be
  created.
- A target `MUST NOT` set `signing: false` when global signing is required.
- `security.artifactAttestations: false` disables framework artifact attestation. When omitted, attestation is enabled by default for package jobs.
- `publish.workflowArtifact: false` disables workflow artifact upload even when the caller passes `upload_artifact: true`.
- `publish.githubRelease: false` disables GitHub Release upload even when the caller passes `publish_release: true`.
- `publish.aggregateRelease: true` defers GitHub Release upload from per-target package jobs to one final framework publish job. Package jobs still upload workflow artifacts when workflow artifact publication is enabled.
- `publish.aggregateArtifactPath`, when set, `MUST` be a safe relative directory where the aggregate publish job downloads package workflow artifacts. When omitted, the framework default is `release-assets`.
- `publish.aggregateUploadGlobs`, when set, `MUST` be a non-empty list of globs uploaded by the aggregate publish job after `lifecycle.publish` completes. When omitted, the framework default is `release-assets/**/*`.
- `publish.retentionDays`, when set, controls workflow artifact retention and must stay within the GitHub-supported retention range.
- Release upload steps `MUST` fail when selected output globs match no files.
- GitHub Release upload steps `MUST` write framework-rendered Release notes through `--notes-file` or an equivalent first-party action input, not hard-coded generic release bodies in each application repository.
- The framework `MUST` render Release notes before GitHub Release upload when `publish.githubRelease` and the caller release publication input are enabled.
- When `publish.aggregateRelease: true`, the framework `MUST` download package workflow artifacts, run `lifecycle.publish` once in aggregate release context, render Release notes through the standard changelog planner, and upload only the configured aggregate upload globs to GitHub Release.
- Application repositories `MUST NOT` copy final GitHub Release upload, aggregate artifact download, changelog rendering, release readiness, or manifest finalization logic into local workflow YAML. App-specific finalization commands belong in `sdkwork.workflow.json` `lifecycle.publish`.
- Application repositories `MUST NOT` implement copied Release body generation in local workflow YAML. App-specific release note generation belongs in `sdkwork.workflow.json` `release.changelog` or in a local file/manifest consumed by the framework.
- `release.changelog.source: auto` `MUST NOT` reuse stale `sdkwork.app.config.json` `release.notes[]` entries whose version does not match the requested package version or release tag; it must fall back to `CHANGELOG.md` or git commit subjects instead.
- When a workflow is triggered by a Git tag and no explicit `package_version` input is provided, changelog matching `MUST` use the tag-derived package version before `release.defaultVersion` so an old default manifest note cannot be reused for a newer tag.
- Framework logs `MUST` redact secret-like values and must not print raw tokens, API keys, or credentials.
- Reusable workflows that expose application signing or container publication
  hooks `MUST` pass private keys and registry credentials through declared
  secrets. They `MUST NOT` model those values as workflow inputs or lifecycle
  config fields.

## 8. Deployment Jobs

Rules:

- Deployment targets are declared under `deployments[]`.
- Deployment matrix items `MUST` bind to selected package targets through
  active deploymentProfile, runtimeTarget, profile binding/support set,
  package profile, platform, architecture, variant, format, target id, or
  package id selectors. Selecting a runtime-configurable client requires the
  requested active profile to be present in its supported set.
- Each configured deployment `MUST` match at least one package target in the full application workflow config. Selector typos must fail validation instead of silently producing no deployment jobs.
- Deployment jobs `MUST` bind to GitHub Environments using the configured environment name and URL when present.
- Deployment lifecycle jobs `MUST` explicitly pass deployment environment, URL, and lifecycle values to the lifecycle runner.
- Every lifecycle selected by `deployments[]` `MUST` have non-empty executable
  `lifecycle.deploy` or `lifecycle.publish` steps. An empty deployment phase is
  a configuration error and must not be treated as a successful deployment.
- Production deployment approvals, environment secrets, and provider credentials belong to GitHub Environments or OIDC provider configuration, not source-controlled workflow config.
- Apply and rollback jobs `MUST` select one deployment profile, one lifecycle
  environment, and one immutable artifact/package identity before acquiring
  environment credentials.
- Deployment jobs `MUST NOT` rebuild artifacts. They consume digests,
  checksums, signatures, attestations, or equivalent immutable publication
  evidence from the package/publish jobs. The deployment selector must verify
  an artifact evidence document against the selected artifact id, digest,
  package id, profile support, SBOM, provenance, and signature references.
- `deployments[].artifactEvidencePath` may override the canonical
  `.sdkwork/evidence/{packageId}.json` path and may use only `{packageId}` or
  `{targetId}` placeholders. The reusable workflow `MUST` download the selected
  package artifact and run the framework evidence validator before invoking
  `lifecycle.deploy` or `lifecycle.publish`; merely exporting an unchecked path
  is not sufficient evidence.
- A deployable package target `MUST` declare or generate an evidence document
  before workflow artifact upload. The document `MUST` include a safe relative
  `artifactPath`; the framework `MUST` recompute that file's SHA-256 digest and
  bind its SemVer and source commit to the current package job. The shared
  `evidence:create` command is the canonical generator. Deployment validation
  repeats the byte-level digest check against the downloaded artifact root.
- A target with one primary packaged file `SHOULD` declare the safe relative
  `targets[].artifactPath`. The framework projects it as
  `SDKWORK_PACKAGE_ARTIFACT_PATH`; `evidence:create` may consume that value
  together with the injected target id, version, evidence path, and
  SBOM/provenance/signature references. `outputGlobs` remains the upload set and
  must include referenced SBOM or signature files that deployment consumers
  need; it is not a substitute for the primary byte-bound artifact path.
- Container targets use `artifactKind = oci-image`: the evidence `digest`
  `MUST` match the remote `repository@sha256` locator and the target's local
  image-manifest `artifactPath` `MUST` repeat that exact locator. Framework
  verification `MUST` fail on local-only image ids, mutable tags, missing
  registry digests, and attempts to use the image-manifest file checksum as
  the OCI deployment digest.
- Workflow artifact names `MUST` use the framework scopes
  `sdkwork-publishable-` and `sdkwork-non-deployable-`. Aggregate Release jobs
  `MUST` download only the publishable scope; a wildcard over all workflow
  artifacts is forbidden because test-only outputs are not release assets.
- Standalone and cloud deployments have independent approval, smoke,
  monitoring, and rollback evidence even when they originate from the same
  source version.

## 9. Framework Repository Requirements

Rules:

- `sdkwork-github-workflow` `MUST` have `AGENTS.md`, `CLAUDE.md` when compatibility is required, and a source-controlled `.sdkwork/` workspace according to `SDKWORK_WORKSPACE_SPEC.md`.
- The framework `init-app` generator `MUST` emit canonical package targets for
  each requested deployment profile and package profile. Standalone server
  starter targets `MUST` include `linux-debian-x64-standalone-server-deb`,
  `linux-rhel-x64-standalone-server-rpm`, and
  `linux-x64-standalone-server-tar-gz`. Standalone desktop starter targets
  `MUST` include `windows-x64-standalone-desktop-msi`,
  `windows-x64-standalone-desktop-exe`, and
  `macos-arm64-standalone-desktop-dmg`. Cloud starter targets `MUST` include a
  `cloud` deployment profile segment, such as
  `container-x64-cloud-container-oci`. Browser, H5, mobile, tablet, and mini
  program starter targets `MUST` use the same package id formula and exact
  `runtimeTarget` values from `CONFIG_SPEC.md` when those profiles are
  requested.
- The framework `init-app` generator `MUST` emit a default `release.changelog.source: auto` configuration so new applications publish Release notes from the app manifest, `CHANGELOG.md`, or git commit subjects without local workflow YAML.
- Generated lifecycle placeholder steps `MUST` be shell-neutral across Linux, Windows, and macOS runners. Placeholders SHOULD use the planner-supported `node` shell and read SDKWork values through `process.env` instead of Bash-only `$SDKWORK_*` or PowerShell-only `$env:SDKWORK_*` syntax.
- The framework `MUST` keep the application workflow template as a single source of truth for generator output.
- The framework `MUST` validate examples and generated application bootstrap output.
- The framework `MUST` keep planner validation, JSON Schema, examples, and reusable workflow consumption in sync.
- The framework `MUST` keep changelog planner output, JSON Schema, reusable workflow Release upload, and publish-release action `notes-file` handling in sync.
- The framework `MUST` keep aggregate Release planner fields, JSON Schema, reusable workflow aggregate publish job, lifecycle action inputs, and publish-release upload globs in sync.
- The framework setup-toolchains action `MUST` consume every supported toolchain output from the planner, including language versions and boolean mobile/native toggles.
- Repository validation for shell injection rules `MUST` inspect only YAML literal `run` script blocks by YAML block boundaries or a parser, not by greedy text matching that includes later `env:`, `with:`, `if:`, or reusable workflow metadata.
- The framework `MUST` run `npm test` and `npm run validate` before reporting a framework change complete.

## 10. Verification

Application integration verification `MUST` check:

- `sdkwork.workflow.json` validates with the framework planner.
- `.github/workflows/package.yml` calls the standard reusable workflow.
- Application workflow inputs use event-safe expressions for manual, tag push, and release events.
- Matrix selection works for all declared deployment profiles, runtime targets,
  target profiles, platforms, architectures, variants, and formats.
- Package ids and artifact names follow `<platform>-<architecture>-<deployment-profile>-<profile>-<format-token>` and `<artifactPrefix>-<packageId>` for browser, H5, server, PC desktop, Capacitor, Flutter, native mobile, tablet, mini program, container/Docker-compatible, and multi-format targets, Linux native `deb`/`rpm` package ids include the `distribution` segment, and variant targets insert `<variant>` before `<format-token>`.
- Package lifecycle steps receive `SDKWORK_DEPLOYMENT_PROFILE` for fixed
  targets or `SDKWORK_SUPPORTED_DEPLOYMENT_PROFILES` for runtime-configurable
  targets, plus `SDKWORK_RUNTIME_TARGET`. Deployment jobs always select and
  receive one active `SDKWORK_DEPLOYMENT_PROFILE`.
- Linux native package lifecycle and deployment lifecycle receive `SDKWORK_PACKAGE_DISTRIBUTION`.
- Variant package lifecycle and deployment lifecycle receive `SDKWORK_PACKAGE_VARIANT`.
- Lifecycle steps receive the standard package and deployment environment variables.
- Lifecycle steps receive `SDKWORK_WORKFLOW_CLI` and deployable package steps
  receive newline-delimited `SDKWORK_ARTIFACT_EVIDENCE_PATHS`, allowing private
  hooks to call the shared evidence generator without a fixed workspace path.
- Targets that declare `artifactPath` project it as
  `SDKWORK_PACKAGE_ARTIFACT_PATH`, and the evidence CLI accepts all canonical
  lifecycle values from the injected environment when equivalent CLI flags are
  omitted.
- Signing, SBOM, attestation, workflow artifact, GitHub Release, dependency checkout, and deployment policies are enforced by executable tests or framework validation.
- Runtime dependencies and verification-only dependencies are both checked out
  by the framework, but dependency plans preserve their dependency type so
  release evidence and API/runtime ownership checks do not confuse the two.
- Release gate evidence from `QUALITY_GATE_SPEC.md` and `RELEASE_SPEC.md` is available before publishing release artifacts.
- Supply-chain evidence from `SUPPLY_CHAIN_SECURITY_SPEC.md` is available for published artifacts, including dependency integrity, build integrity, SBOM/provenance/signing/checksum/attestation evidence required by the target policy.
- GitHub Release notes are rendered by framework changelog planning from `release.changelog`, manifest `release.notes[]`, a declared changelog file, or git commit subjects.
- Aggregate Release publication, when configured, downloads workflow artifacts, runs final `lifecycle.publish` in aggregate context, renders framework Release notes, and uploads configured aggregate assets only once.
- Output globs resolve to the expected release artifacts during package validation.

Application repositories may call the canonical entrypoint validator with:

```text
node ../sdkwork-specs/tools/check-agent-workflow-standard.mjs --root .
node ../sdkwork-specs/tools/check-app-manifest-deployment-standard.mjs --root . --strict-release-targets
```

The validator checks the thin packaging workflow, pinned reusable workflow ref,
`sdkwork.workflow.json` target metadata, absence of copied release workflow
bodies, and the repository/application `AGENTS.md` dynamic loading contract.

Framework verification `MUST` check:

- Planner validation rejects unknown fields, schema-declared type violations, empty target lists, duplicate target formats, unsafe paths, dependency checkout path overlaps, unsafe Git refs, unsupported token secrets, dynamic lifecycle `uses`, invalid lifecycle env values, duplicate target ids, missing or invalid deployment profiles, deployment selectors that match no package target, and unsupported enum values.
- Planner validation allows `verificationDependencies[]` only with the same safe
  ref, checkout, token, and submodule contract as `dependencies[]`, and
  dependency checkout plans expose `dependencyType` for each item.
- Planner validation rejects non-canonical target ids, non-canonical explicit
  package ids, multi-format target package ids, missing Linux native package
  distributions, distribution/format mismatches, malformed package variants,
  invalid package profiles, non-canonical runtime targets, platform/profile/
  runtimeTarget/deploymentProfile mixups, and Linux native package targets that
  mix `deb` or `rpm` with generic formats.
- JSON Schema stays aligned with planner validation.
- The generated application workflow matches the checked-in application template.
- The setup-toolchains action consumes every declared toolchain output from the planner.
- Dependency ref JSON inputs are passed to shell commands through environment variables or files, not through direct expression interpolation.
- Shell-based composite actions pass action inputs through environment variables or structured argument arrays before command execution.
- Repository validation rejects `${{ inputs.* }}` inside literal `run` shell bodies while allowing those expressions in GitHub-evaluated `env:`, `with:`, and workflow metadata contexts.
- The reusable workflow gates upload, Release publishing, and attestation through the resolved config policy.
- Release and supply-chain gates align with `QUALITY_GATE_SPEC.md`, `RELEASE_SPEC.md`, and `SUPPLY_CHAIN_SECURITY_SPEC.md`.
- Version resolution tests prove matrix summaries, lifecycle environments, and changelog planning prefer explicit package versions, then normalized release tags, then `release.defaultVersion`.
- Changelog tests prove `release.changelog` validation, manifest release note rendering, file-based changelog rendering, git fallback behavior, and GitHub Release `notes-file` upload wiring.
- Aggregate Release tests prove per-target GitHub Release upload is disabled, the aggregate publish job downloads workflow artifacts, `lifecycle.publish` receives aggregate release context, Release notes are rendered by the framework, and upload uses `publish.aggregateUploadGlobs`.
- Deploy jobs pass deployment context explicitly to lifecycle execution.
- Repository validation checks `AGENTS.md`, compatibility shims, `.sdkwork/` files, workflow YAML, actions, schema, examples, and generator output.

## 11. Acceptance Checklist

- [ ] Application has `sdkwork.workflow.json`.
- [ ] Application has a thin `.github/workflows/package.yml` reusable workflow call.
- [ ] Application workflow uses a pinned framework ref.
- [ ] Config validates against the framework planner and schema.
- [ ] Package targets cover the required deployment profiles, runtime targets, package profiles, platforms, architectures, formats, runners, and output globs.
- [ ] Lifecycle steps use safe paths, supported shells, string env values, and `run` commands only.
- [ ] Dependency refs and checkout paths are safe.
- [ ] Signing, SBOM, attestation, artifact upload, Release upload, and deployment policies are declared and enforced.
- [ ] Release gate evidence follows `QUALITY_GATE_SPEC.md` and `RELEASE_SPEC.md`.
- [ ] Supply-chain evidence follows `SUPPLY_CHAIN_SECURITY_SPEC.md`.
- [ ] Release changelog policy is declared or defaults to `release.changelog.source: auto`, and GitHub Release upload receives framework-rendered notes.
- [ ] Aggregate Release publication is declared when final manifest/readiness/changelog aggregation is required, and finalization logic lives in `lifecycle.publish` instead of copied local workflow YAML.
- [ ] Deployment jobs use GitHub Environments when deployments are configured.
- [ ] Framework changes pass `npm test` and `npm run validate`.
