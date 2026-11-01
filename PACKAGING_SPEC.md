# Packaging Content Standard

- Version: 1.1
- Scope: package artifact content minimization and installer target layout across container images, server archives, Linux (Ubuntu/Debian/RPM/AppImage), Windows (MSI/EXE/NSIS), macOS, mobile, and web distributions; build context isolation; forbidden and required content; package content evidence
- Related: `RELEASE_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `DEPLOYMENT_SPEC.md`, `SUPPLY_CHAIN_SECURITY_SPEC.md`, `APP_MANIFEST_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `RUNTIME_DIRECTORY_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, `QUALITY_GATE_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `TEST_SPEC.md`

This standard defines what a packaging pipeline `MUST` and `MUST NOT` place
into a shipped artifact. A release artifact is a runtime-consumable
distribution (container image, server archive, `.deb`/`.rpm`/`.AppImage`,
`.msi`/`.exe`, mobile bundle, or static web package). The goal is that every
packaged byte is either (a) required at runtime, (b) required for correct
installation, or (c) required as release evidence. Everything else is
forbidden.

This standard is about artifact **content**. Artifact **identity**, evidence,
signing, and publication are governed by `RELEASE_SPEC.md` and
`SUPPLY_CHAIN_SECURITY_SPEC.md`; runtime behavior and deployment profiles are
governed by `DEPLOYMENT_SPEC.md` and `APP_RUNTIME_TOPOLOGY_SPEC.md`.

## 1. Content Minimization Principle

Rules:

- A package `MUST` contain only the smallest set of files needed to install,
  configure, run, and verify the product on its declared
  `runtimeTarget`/`targetPlatform` and `deploymentProfile`.
- Packaging `MUST` be declarative: the packaging plan lists every entry with
  its archive path, source path, mode, and required flag. Anything not listed
  is excluded, never included by directory glob default.
- Packaging `MUST NOT` copy build workspaces, dependency install directories,
  VCS metadata, or build caches into any artifact, even transitively through
  directory copies.
- When the same product packages multiple formats (container, `.deb`, `.msi`,
  `.tar.gz`), each format's content is derived from one shared declarative
  file-entry model; format-specific additions must be explicit.
- Content rules apply to the **uncompressed** artifact, the compressed
  archive, and the mounted/running filesystem view of container images.
- Packaging `MUST` record a content manifest (file list with sizes and
  hashes) as part of the package; the manifest is release evidence
  (`RELEASE_SPEC.md` §4).
- Packaging content is deterministic: rebuilding from the same inputs and
  version `MUST` produce the same file set (not necessarily byte-identical
  binaries).

## 2. Forbidden Content

The following content `MUST NOT` appear in any release artifact, in any
format, at any path:

### 2.1 Build And Tooling State

- Build workspaces and target directories (`target/`, `build/`, `dist/`
  except the declared packaged output itself, `out/`, `.gradle/`, `.mvn/`,
  `bin/` from toolchains).
- Dependency install directories (`node_modules/`, `.pnpm/`, `vendor/`
  vendored at build time, `~/.cargo/registry` mirrors, `Pods/`,
  `.dart_tool/`, `__pycache__/`, `.venv/`, `venv/`).
- Compiler/package-manager caches and lockfiles whose content is only build
  inputs (`*.lock` for build reproducibility may ship only when the runtime
  or install flow consumes it; a lockfile is not itself a runtime need).
- Build scripts, CI workflows, linter/format config, editor/IDE config
  (`.vscode/`, `.idea/`, `.editorconfig`, `.prettierrc*`), and code style
  tooling.
- Source code of the product itself when the package is a binary/container
  distribution (source archives are separate artifacts). Generated source
  required at runtime (e.g. embedded migration SQL, catalog JSON) is allowed
  when it is a runtime input, not when it duplicates repository source.
- Test fixtures, unit/integration test sources, mock providers, and test
  runner binaries.

### 2.2 VCS And Repository Metadata

- `.git/`, `.svn/`, `.hg/` directories and any VCS metadata files
  (`.gitignore`, `.gitattributes`, `.gitmodules` are repository rules, not
  runtime inputs).
- CI workflow files (`.github/workflows/`, `.gitlab-ci.yml`, `azure-pipelines.yml`).
- `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `CODEX.md`, `.sdkwork/` agent
  metadata, and repository README trees are repository documentation; they
  are allowed only when the package explicitly ships documentation as a
  declared entry.

### 2.3 Secrets And Private State

- Environment files with real or dev values. A package `MUST NOT` ship `.env` or
  any `.env.<deployment-profile>.<environment>` file, and the composed names
  (`.env.local`, `.env.release`, `.env.release.local`, `.env.development*`) are
  retired by `ENVIRONMENT_SPEC.md` §5.1.7 and `MUST NOT` exist at all.
- Credentials: passwords, API keys, access/refresh tokens, private keys,
  signing keys, client secrets, cookie/session secrets, and their files.
- Local configuration overrides, user-private runtime state, local test
  databases (`*.sqlite`, `*.db` produced by a run), and local logs.
- Cloud/development endpoints, developer origins, local tunnel config, and
  development bootstrap credentials (`SUPPLY_CHAIN_SECURITY_SPEC.md` §3).

### 2.4 Unused Runtime Code And Data

- Unused language runtimes, SDKs, or providers compiled into a binary when a
  per-application feature can exclude them (see `DATABASE_SPEC.md` §7.2 for
  the SQLite/server boundary; `RUST_CODE_SPEC.md` for cargo feature
  minimization).
- Debug symbols and un-stripped release binaries unless the format
  explicitly requires them (e.g. a debugging package): release binaries
  `MUST` be stripped (`strip`, `strip -s`, `--strip-unneeded`, `cargo
  strip`, or the toolchain equivalent) unless the format contract requires
  symbol tables.
- Locale, translation, and asset variants not declared by the package's
  `targetPlatform`/`i18n` contract.
- Documentation source (`.md` sources, design docs, spec trees) when the
  package ships only generated install guides; generated `INSTALL.md` and
  format-specific install docs are allowed as declared entries.

### 2.5 Container Image Specific

- Build context files that are not staged runtime inputs. A container build
  `MUST` use either (a) an explicit staging directory containing only
  declared entries, or (b) a `.dockerignore`/`.containerignore` that excludes
  build workspaces, dependency directories, VCS metadata, and repository
  tooling before `COPY`. Copying the repository root into the image is
  forbidden.
- Build-time-only packages installed for compilation (`build-essential`,
  compilers, package managers) `MUST` be removed in the same layer or the
  image `MUST` use multi-stage builds that copy only runtime artifacts.
- Image history `MUST NOT` retain secrets: secret-bearing files copied in a
  build stage then deleted still exist in intermediate layers; use BuildKit
  secret mounts (`RUN --mount=type=secret`) instead.
- Healthcheck, `psql`/client tools, and operational utilities are allowed
  only when the image declares an operator workflow that consumes them; each
  such tool `MUST` be justified in the packaging plan.
- The image `MUST NOT` contain the unpacked source, `target/`, `node_modules/`,
  `.git/`, or any build cache; image size bloat from these is a packaging
  defect.

## 3. Required Content

A release artifact `MUST` contain:

- All declared runtime binaries for the target platform/architecture,
  stripped, with execute permissions and runtime library dependencies
  satisfied (either statically linked or with declared system packages).
- Generated runtime configuration template (e.g.
  `config/cloudrouter.toml.example`) with no real secrets; `CONFIG_SPEC.md`.
- The runtime directory layout required by `RUNTIME_DIRECTORY_SPEC.md`
  (config, secrets, data, cache, log mount points) either pre-created or
  created by the installer/entrypoint.
- Installer/entrypoint scripts with declared paths and modes.
- Generated `install-manifest.json` (or format-equivalent) listing every
  packaged file with path, size, and hash, plus package id, version, target,
  and runtime target (`RELEASE_SPEC.md` §4).
- Format-required metadata: image `LABEL`s, `.deb` control metadata, `.msi`
  upgrade codes, app icon, version resources, license notices, and NOTICE
  files required by bundled dependencies.
- Only the static assets, catalogs, migration SQL, and schema files that the
  runtime actually reads, with their declared app-root environment paths.
- Signed checksums (`SUPPLY_CHAIN_SECURITY_SPEC.md` §5) where the release
  policy requires them.

## 4. Build Context Isolation

Rules:

- Packaging commands `MUST NOT` run with the repository root as the build
  context unless a complete `.dockerignore`/`.containerignore` excludes every
  forbidden path (target, node_modules, `.git`, tests, docs, tooling).
- The preferred pattern is a **staging directory**: assemble only the
  declared runtime entries into `<workspace>/dist/install-package-staging/`
  (or equivalent), then package from the staging root. Staging `MUST` be
  rebuilt from declared sources; reusing a stale staging directory without a
  content snapshot check is forbidden.
- Staging and output directories (`dist/`, `out/`, `artifacts/`) `MUST` be
  excluded from VCS via `.gitignore`; the packaging plan and content manifest
  are the only packaging outputs that are source-controlled.
- When a packaging snapshot is used to skip re-staging, the snapshot `MUST`
  hash every declared input (binaries, dist assets, modules, config) so
  stale content cannot be silently packaged.
- `COPY`/`ADD` in container files `MUST` reference declared staging paths or
  explicit file lists, never `.` from a repository root.

## 5. Format-Specific Content

### 5.1 Container Images

- Build from a staging directory or a `.dockerignore` that excludes §2
  content; the image `MUST NOT` contain repository source, workspaces, or
  dependency installs.
- Prefer multi-stage builds: compile in a toolchain stage, copy only runtime
  artifacts into the slim runtime stage.
- Runtime stage `MUST` install only runtime libraries
  (`--no-install-recommends`), remove apt lists, and avoid build toolchains.
- `EXPOSE`, `USER`, healthcheck, and entrypoint must match
  `DEPLOYMENT_SPEC.md` §5 and `APP_RUNTIME_TOPOLOGY_SPEC.md`; probes and
  utilities must be justified.
- Layer size is an acceptance metric: packaging `MUST` record layer sizes in
  the content manifest and flag unexplained large layers for review.

### 5.2 Linux Distributions (Ubuntu/Debian, RPM, AppImage, tar.gz)

- `.deb`/`.rpm` `MUST` declare real runtime dependencies
  (`Depends`/`Requires`: `libssl3`, `ca-certificates`, locale packs, etc.)
  and `MUST NOT` bundle those libraries when the distro provides them.
- Binaries `MUST` be stripped; debug variants are separate `-dbgsym`/`-debug`
  packages.
- `postinst`/`prerm` scripts `MUST` only configure the runtime layout and
  service registration; they `MUST NOT` embed secrets or dev config.
- Desktop `.deb`/`.AppImage` `MUST` include the declared icon/`.desktop`
  entry only for the packaged app id.
- The archive entry list `MUST` be the declarative plan (§1); no recursive
  copy of the build root.
- Server, gateway, worker, and migration-capable binaries `MUST` expose
  `--help` and `--version` before runtime configuration, database, Redis,
  network, tracing exporter, or owner assembly initialization. These
  information commands `MUST` have no durable or external side effects.
- A target-host Linux installer `MUST` execute the installed or staged primary
  binary with `--version` before service registration/start. Failure due to
  architecture, dynamic linking, or runtime initialization `MUST` fail the
  install with a clear diagnostic.

### 5.3 Windows (MSI, EXE, NSIS)

- The installer `MUST` contain only the declared application payload, runtime
  DLLs actually required, and installer metadata; it `MUST NOT` include
  dev/build tools, `target/` trees, `node_modules/`, or PDB/debug files
  unless a declared debug package.
- Unused language runtimes and provider modules `MUST` be excluded by feature
  configuration before packaging (§2.4).
- Signing certificates and their private keys `MUST` never enter the
  payload; signing happens at publication with the key held outside the build
  (`SUPPLY_CHAIN_SECURITY_SPEC.md` §5).
- Per-user/per-machine install layout `MUST` follow the declared
  `RUNTIME_DIRECTORY_SPEC.md` mapping; the installer `MUST NOT` copy VCS or
  repository metadata.

### 5.4 macOS / Mobile / Web

- `.dmg`/`.pkg`/notarized bundles `MUST` contain only the signed app bundle
  and declared resources; `xcodebuild` intermediate products `MUST` not leak.
- Mobile bundles `MUST` exclude source maps, debug symbols, and dev signing
  profiles unless declared; store-upload metadata follows
  `APP_MANIFEST_SPEC.md`.
- Web/static packages `MUST` contain only built assets (`dist/` output),
  runtime config templates, and the install manifest; source maps may ship
  only as declared opt-in artifacts.

### 5.5 Installer Target Layout Matrix

The canonical directory mapping in `RUNTIME_DIRECTORY_SPEC.md` section 4 is
the authority for host layout. This matrix projects those directories onto
the concrete target paths each native installer format `MUST` install into.
An installer/package `MUST NOT` place files outside its format row below, and
`postinst`/`prerm`/installer scripts `MUST` only configure the runtime layout
(create directories, set ownership/modes) and register the service; they
`MUST NOT` embed secrets or dev config values.

| Asset role | `.deb` / `.rpm` (Linux) | `.msi` / `.exe` (Windows) | `.dmg` / `.pkg` (macOS) |
| --- | --- | --- | --- |
| Private immutable runtime assets (binaries) | `/usr/lib/sdkwork/<application-code>` | `%ProgramFiles%\sdkwork\<application-code>` | App bundle `Contents/MacOS/` |
| Shared read-only assets | `/usr/share/sdkwork/<application-code>` | `%ProgramFiles%\sdkwork\<application-code>` | App bundle `Contents/Resources/` |
| Documentation | `/usr/share/doc/sdkwork/<application-code>` | `%ProgramFiles%\sdkwork\<application-code>\doc` | App bundle `Contents/Resources/Documentation/` |
| Runtime config | `/etc/sdkwork/<application-code>` | `%ProgramData%\sdkwork\<application-code>` | `/Library/Application Support/sdkwork/<application-code>` |
| Durable mutable data | `/var/lib/sdkwork/<application-code>` | `%ProgramData%\sdkwork\<application-code>\Data` | `/Library/Application Support/sdkwork/<application-code>/Data` |
| Logs | `/var/log/sdkwork/<application-code>` | `%ProgramData%\sdkwork\<application-code>\Logs` | `/Library/Logs/sdkwork/<application-code>` |
| Cache | `/var/cache/sdkwork/<application-code>` | `%ProgramData%\sdkwork\<application-code>\Cache` | `/Library/Caches/sdkwork/<application-code>` |
| Runtime state | `/run/sdkwork/<application-code>` | `%ProgramData%\sdkwork\<application-code>\Run` | `/Library/Application Support/sdkwork/<application-code>/Run` |
| Workspace database config/secret | `/etc/sdkwork/database` | `%ProgramData%\sdkwork\database` | `/Library/Application Support/sdkwork/database` |
| Service registration | `/usr/lib/systemd/system/sdkwork-<application-code>.service` | Windows Service Control Manager (service name `sdkwork-<application-code>`) | `/Library/LaunchDaemons/sdkwork.<application-code>.plist` |
| GUI application bundle | Desktop entry/`.desktop` per packaged app id | Per-machine installer payload | `/Applications/<DisplayName>.app` |

Rules:

- Database connections inside an installed service `MUST` resolve exclusively
  through `SDKWORK_DATABASE_*` with secret material referenced by
  `password_file` from the workspace database secret path of the format row
  (`ENVIRONMENT_SPEC.md` sections 7.1 and 7.3); installers `MUST NOT` write
  credentials into env files, unit files, or config templates. A
  single-application host installer may reference the secret from the
  application config directory (`/etc/sdkwork/<application-code>/secrets/`)
  per the `ENVIRONMENT_SPEC.md` section 7.3 exception, declared in its
  documentation.
- The `.deb`/`.rpm` service unit `MUST` reference a `EnvironmentFile` under
  `/etc/sdkwork/<application-code>/` (mode `0640` or tighter) instead of
  embedding environment assignments in the unit when values are
  installation-generated.
- Archive installs (self-contained `.tar.gz`/`.zip` not owned by a package
  manager) install under `/opt/sdkwork/<application-code>` and `MUST NOT`
  write outside their own tree at runtime except the declared config/data/log
  directories.
- Format rows above are normative projections; where a platform integration
  (e.g. Windows roaming, macOS sandbox) requires a documented alternate, the
  package `MUST` declare it in `install-manifest.json` and link the
  `RUNTIME_DIRECTORY_SPEC.md` mapping it follows.

## 6. Content Evidence

Rules:

- Every packaged artifact `MUST` carry a machine-readable content manifest:
  package id, version, runtime target, platform/architecture, format, and a
  per-file list of archive path, uncompressed size, and digest (sha256).
- The content manifest `MUST` be generated by the packaging pipeline from
  the declarative entry plan, not hand-written.
- Release evidence (`RELEASE_SPEC.md` §4) `MUST` include the content
  manifest and its validation result.
- A packaging validator (`check-package-content-standard.mjs`) `MUST` be run
  in CI/release gates: it verifies forbidden paths are absent, required
  entries are present, the manifest matches the artifact, and binaries are
  stripped per format policy.
- Validation failures block the release (`QUALITY_GATE_SPEC.md`).

## 7. Acceptance Checklist

- [ ] Packaging plan is declarative: every entry has archive path, source
      path, mode, required flag.
- [ ] Forbidden content (§2) verified absent in archive and unpacked/mounted
      views: no build workspaces, node_modules, `.git`, secrets, dev env,
      test fixtures, or debug symbols.
- [ ] Container build uses staging directory or complete `.dockerignore`;
      image contains no repository root copy.
- [ ] Required content (§3) verified present: binaries stripped, config
      template, install manifest, format metadata.
- [ ] Content manifest generated and validated; layer sizes recorded for
      container images.
- [ ] Packaging validator passed in CI/release gate; evidence attached to
      the release record.
