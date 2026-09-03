# SDK Publish Orchestrator

Multi-language SDK publish tool for the SDKWork workspace. Discovers SDK families
across all repositories, builds and publishes each language package to its
official registry, and emits a JSON report as release evidence.

Authority: `SDK_SPEC.md`, `SDK_MANIFEST_SPEC.md`, `SDK_PACKAGE_NAMING_SPEC.md` §1.1,
`RELEASE_SPEC.md` §2/§4.

## Quick start

From `sdkwork-specs/`:

```bash
# Dry-run across the whole workspace (safe, no credentials needed)
pnpm release:sdk:publish:dry-run

# Publish all TypeScript SDKs (requires NPM_TOKEN)
NPM_TOKEN=xxxx pnpm release:sdk:publish -- --language typescript --allow-pre-release

# Publish one family, one language
pnpm release:sdk:publish -- --family sdkwork-iam-app-sdk --language typescript

# Publish everything in one repository
pnpm release:sdk:publish -- --repo sdkwork-iam --language all
```

## What it does

1. **Discovers** every `sdks/<family>/sdk-manifest.json` across `sdkwork-space/*`
   and `sdkwork-space/*/apps/*/sdks/*`.
2. **Filters** by `--repo`, `--filter`, `--family`, `--language`.
3. Unless `--skip-standard-check` is set, runs `check-sdk-standard` once for the workspace.
4. For each package:
   - Reads `packageName` + `version` from the language manifest.
   - Skips pre-release versions unless `--allow-pre-release` is set.
   - Skips when the registry already has that version.
   - Skips when the required credential is missing (publish mode only).
   - Builds the package.
   - Publishes to the registry.
4. Emits a JSON report (`--report <path>`) as release evidence.

## Hard rules

- **Never publishes transport packages.** Any `package.json#name` ending in
  `-generated-typescript` or located under `generated/server-openapi/` is
  rejected. See `SDK_PACKAGE_NAMING_SPEC.md` §1.1.
- **Dry-run never builds or publishes.** It only discovers, reads versions,
  and probes the registry.
- **Credentials come from the environment**, never from manifests or config.
- **Failures are isolated.** One package failing does not stop others; the
  exit code is non-zero only if at least one package failed.

## Supported languages

| Language | Registry | Build | Publish | Credential |
| --- | --- | --- | --- | --- |
| TypeScript | npmjs.com | `pnpm run build` | `npm publish --access public --tag <tag>` | `NPM_TOKEN` |
| Rust | crates.io | `cargo build --release` | `cargo publish --no-verify` | `CARGO_REGISTRY_TOKEN` |
| Java | Maven Central | `mvn package` | `mvn deploy` | `MAVEN_USERNAME` + `MAVEN_PASSWORD` |
| Flutter/Dart | pub.dev | `dart pub get` | `dart pub publish --force` | `PUB_DEV_TOKEN` |
| Python | PyPI | `python -m build` | `twine upload dist/*` | `PYPI_TOKEN` |
| Go | git tag + GitHub Release | `go vet` + `go build` | `git tag v<x>` + `git push` | git remote creds |

Packages with `publish_to: none` (Flutter) are skipped as private.

## CLI options

```
--workspace <path>            workspace root (default: parent of sdkwork-specs)
--repo <name[,name...]>       limit to one or more repositories
--filter <prefix>             limit to repositories whose name starts with <prefix>
--family <stem>               limit to one SDK family
--language <lang|all>         typescript | rust | java | flutter | python | go | all
--list                        list discovered packages without publishing
--dry-run                     discover + version-check only
--tag <npm-dist-tag>          npm dist-tag (default: latest)
--access <public|restricted>  npm scoped package access (default: public)
--skip-build                  skip per-package build step
--allow-pre-release           allow 0.x / -rc / -beta versions
--skip-standard-check         skip pre-publish check-sdk-standard gate
--bump <patch|minor|major>    bump version before publishing
--report <path>               write JSON report to this path
--help                        show usage
```

## CI integration

A reusable GitHub Actions workflow lives at
`templates/.github/workflows/publish-sdks.yml`. Call it from any repository:

```yaml
jobs:
  publish:
    uses: sdkwork-ai/sdkwork-specs/.github/workflows/publish-sdks.yml@main
    with:
      language: typescript
      dry-run: true
    secrets: inherit
```

The workflow sets up Node, pnpm, and per-language toolchains, configures
registry auth from secrets, runs `pnpm release:sdk:publish`, and uploads the JSON
report as an artifact.

## Adding a new language

1. Create `tools/lib/sdk-publish/publishers/<language>.mjs` exporting:
   - `language` (string)
   - `registry` (string, for reporting)
   - `detect(familyRoot, manifest)` → `{ packageName, version, packagePath }` or null
   - `build(pkgPath, { skipBuild })` → `{ ok, detail }`
   - `publish(pkgPath, { tag, access, version, env })` → `{ ok, detail }`
   - `hasCredentials(env)` → boolean
   - `credentialName()` → string
2. Register it in `tools/lib/sdk-publish/publisher-registry.mjs`.
3. Add the language to `SUPPORTED_LANGUAGES` in `discover-publishable-sdks.mjs`.
4. Add a version probe in `version-check.mjs` if the registry exposes one.

## Verification

```bash
# Unit tests
node --test tools/publish-sdk.test.mjs

# Workspace dry-run
node tools/publish-sdk.mjs --workspace .. --dry-run --language all --allow-pre-release --skip-build
```
