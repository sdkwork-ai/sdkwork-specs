# OEM Branding Standard

- Version: 2.0
- Scope: OEM, white-label, and multi-brand assemblies — brand declaration, installed OS identity, update feed, release artifact naming, packaging-input hygiene, display branding, the OEM profile boundary, application-family versus release-brand split, documentation duties, verification, and onboarding a new brand
- Related: `NAMING_SPEC.md` §4.1, `RELEASE_SPEC.md`, `GITHUB_WORKFLOW_SPEC.md`, `PACKAGING_SPEC.md`, `APP_MANIFEST_SPEC.md`, `DESKTOP_APP_ARCHITECTURE_SPEC.md`, `ICON_SPEC.md`, `I18N_SPEC.md`, `TEST_SPEC.md`, `QUALITY_GATE_SPEC.md`, `DOCUMENTATION_SPEC.md`, `APP_RUNTIME_TOPOLOGY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_NAMING.md`

This standard defines how one source tree ships as more than one branded product without either product's release, installation, update feed, or documentation carrying the other's identity. Version 2.0 adds the two identities that shipped-broken in the reference implementation and were not covered by 1.0: the Windows installation identity derived from the application id, and the update feed repository.

## 0. Quick Reference

| Question | Rule |
| --- | --- |
| What is a release brand? | The selected identity one build ships: app id, release repository, artifact prefix, display name, home, product name, executable, protocol, command, and port block |
| Where is it declared? | One validated brand manifest per brand (`brands/<key>.json`); never in a build script, workflow step, or local dotenv |
| What must carry it? | Every published file name and sidecar, published-file Actions artifacts, bundle directories, installed OS registrations, the update feed, and the install/deploy documentation for the shipped brand |
| What must not carry it? | Package ids, container image references, environment variable names, wire identities, ports, and other products' names |
| What must own the app id? | The brand manifest: electron-builder hashes it into the Windows installer GUID that decides the install directory, uninstall registration, and update identity |
| What must own the update feed? | The brand manifest's `releaseRepository`: one repository has one `latest` pointer, so two brands never share it |
| How is it proven? | Derivation gates over every name-producing file, artifact readback of the packaged identity and feed, and a side-by-side installation check |

## 1. Brand Declaration (Normative)

- An OEM or multi-brand assembly `MUST` declare each brand in one versioned machine-readable manifest. The reference layout is `brands/<key>.json`, one file per brand, validated by a single loader before any packaging step.
- The manifest `MUST` own every value two installed products cannot share: brand key, display name, vendor name, runtime home directory and whether a launch may adopt a legacy shared home, desktop application id, release repository, product name (userData, logs, single-instance lock), executable name, URL scheme, command name, Windows registry key and mutex stem, updater cache directory, artifact prefix, and the first port of the brand's loopback block.
- The loader `MUST` reject malformed values and any value that belongs to the framework or upstream assembly: the upstream home directory, product name, `dsh` scheme and command, upstream application id, and upstream release repository. A typo `MUST` fail the build; it `MUST NOT` fall back to a default brand.
- Exactly one brand is shipped. Selection precedence is an explicit manifest path, then a brand key in the environment, then the shipped key; an unknown key `MUST` fail rather than resolve to a default.
- Two brands that can be installed on one machine `MUST NOT` share any identity value, and their loopback port blocks `MUST` be disjoint by at least the documented block size. The manifest set `MUST` be checked as a set, because per-manifest validation cannot see a sibling brand. A collision `MUST` fail packaging and the merge gate with both values named.
- `release.artifactPrefix` in `agent.workflow.json` `MUST` equal the selected brand's artifact prefix for every release build (`GITHUB_WORKFLOW_SPEC.md` §"Release packaging"). A release-branding reason is the only documented exception in `NAMING_SPEC.md` §4.1 for an artifact prefix that does not match `app.id`.
- `app.name` and display copy in the workflow manifest `MUST` name the shipped brand, not the predecessor product; `app.repository` `MUST` be the repository that publishes this brand's releases.

## 2. Installed Identity and OS Registration (Normative)

- The desktop application id is an installed identity, not a label. electron-builder hashes it into the Windows installer GUID (`UUID.v5(appId, electron-builder namespace)`), and that GUID keys the per-machine and per-user `InstallLocation` records the next installer reads, the uninstall registration, the per-brand PATH ownership key and mutex, and the macOS bundle identifier. Two products that share an application id cannot be installed side by side: the later installer treats the earlier installation's directory as its own previous version, upgrades it in place, and takes over its uninstall and update registration.
- The application id `MUST` come from the brand manifest alone. A packaging input (platform dotenv, preset file, workflow `env`, or command line) `MUST NOT` override it with another product's identifier; packaging `MUST` refuse such a value and name both identities. A packaging lane `MUST NOT` require the identifier at all: an absent value resolves to the brand's.
- Packaging `MUST` verify the packaged artifact, not only the configuration: the manifest inside `app.asar` `MUST` carry the selected product name, the packaged `app-update.yml` `MUST` carry the selected updater cache directory, and a GitHub feed `MUST` name the brand's release repository.
- Every OS resource derived from the installed name `MUST` be brand-owned and verified on the artifact or in the installer: userData, logs, single-instance lock, `keybindings.json`, background-close marker, runtime home, updater cache, uninstall data directory, PATH ownership receipt, mutex, URL-scheme registration, and the desktop command.
- The installed runtime home `MUST` be brand-owned. Adopting a legacy shared home `MUST` be opt-in per brand, and adoption `MUST` move or link the existing home rather than copy credentials and sessions into a second directory.
- The uninstaller `MUST` remove only the selected brand's data and registrations, including that brand's updater cache directory and installer logs. It `MUST NOT` target a directory derived from a package name, a shared framework name, or a predecessor product.
- Every loopback port a build binds `MUST` derive from `desktop.webPort` and its documented block, including standalone host defaults; a default port named after another brand is a defect.
- The standard `MUST` treat the following as unverifiable from source and require packaged-artifact verification: NSIS GUID and `InstallLocation`, uninstall entry name/icon, file properties (ProductName/CompanyName/URL), macOS `Info.plist` identity and usage descriptions, Linux package metadata and `.desktop` entry, updater cache location, and protocol-handler coexistence between two installed brands.

## 3. Update Feed (Normative)

- The brand manifest's `releaseRepository` `MUST` name the GitHub repository whose `latest.yml` the installed application reads. electron-updater reads the repository named in the packaged `app-update.yml`, and a repository has exactly one `latest` pointer: two brands that share a repository share one update stream, and the newer release of either product is offered to both installations.
- Packaging `MUST` derive the GitHub publish provider from the brand manifest. It `MUST NOT` name a product repository as a constant, default, or workflow environment value. A packaging run whose `GITHUB_REPOSITORY` differs from the selected brand's release repository `MUST` fail with both repositories named, because artifacts assembled there cannot be published where the installed application looks.
- Release assembly `MUST` re-check the brand's release repository before writing the release directory, so a release started in the wrong repository fails before publication rather than after.
- The signed deployment feed (generic URL / object storage) and the public release repository are separate destinations and `MUST` stay distinct in configuration and documentation.
- A brand's `updaterCacheDirName` `MUST` differ from every sibling's, and the packaged `app-update.yml` `MUST` carry it: a shared cache lets one product install the other's downloaded update.
- Documentation `MUST` link the brand's release repository and tag scheme. A guide that sends a user to another product's releases is a defect even when the release is correct.

## 4. Release Artifact Naming (Normative)

- Every published artifact name `MUST` begin with the selected brand's artifact prefix: installers and native packages, archives, deployment bundles, saved container or server images, their checksums, and every signature, blockmap, or provenance file whose name embeds an artifact name.
- A sidecar file `MUST` be named `<artifact-name><suffix>` (for example `<artifact>.sha256` or `<artifact>.blockmap`) so it inherits the prefix and cannot drift from the artifact it describes.
- A deployment bundle `MUST` use the same prefix and the same version token as the assets it contains, and its top-level directory `MUST` equal the archive stem. `MUST NOT` publish a bundle whose directory or internal manifest names another product.
- GitHub Actions artifact names that carry published files `MUST` use the same prefix. An internal-only artifact that no published file name depends on `MAY` keep the framework family name; the distinction `MUST` be explicit in the workflow, not inferred at download time.
- No published artifact name, published-file Actions artifact name, or install/deploy command in documentation `MUST` contain another product's token: a framework family name, an upstream application name, or a predecessor brand. Renaming the brand is the only sanctioned source of a new stem.
- The prefix `MUST` be resolved once from the brand manifest by a naming module. Packaging scripts, the release workflow, gates, and tests `MUST` consume that resolution; no lane `MUST` spell the stem independently. A literal prefix is acceptable only in documentation, which describes the shipped brand.
- Rebuilding with another manifest `MUST` keep the same name shape and `MUST NOT` require editing a build script, workflow step, or gate.
- The version token `MUST` be the release version (`RELEASE_SPEC.md` §3), consistent across manifest, workflow matrix, package metadata, asset names, and changelog. A brand name `MUST NOT` be encoded into the version; a brand-scoped tag prefix is the only exception, and it `MUST` stay a separate, documented token. Legacy tag prefixes `MAY` remain recognized for compatibility and `MUST` be documented as legacy.
- Artifact names `MUST` remain lowercase kebab tokens as `NAMING_SPEC.md` §4.1 requires; the brand prefix does not relax casing, separator, or format-token rules.

## 5. Packaging Input Hygiene (Normative)

- The brand manifest is the only source of identity. Packaging configuration files (`packaging/<platform>.env`, presets, workflow `env`, CI variables) `MUST NOT` assign the application id, product name, release repository, artifact prefix, protocol, command, or home directory.
- Templates and examples `MUST NOT` ship a predecessor product's or the upstream application's identity either. An example that a packager copies `MUST` be usable unchanged for the shipped brand.
- A machine-local configuration file is not a brand source. A value it carries remains subject to the same refusal rules; the standard `MUST` require the failure to name the file setting and the brand it contradicts.
- Generated install-time copy `MUST` take the product name from the manifest at build time: installer language resources `MUST` use a brand placeholder substituted by the packaging run, not a literal product name in every locale; generated installer artwork `MUST` render the manifest's display name; platform usage descriptions `MUST` interpolate the manifest's display name.
- The boot/startup surface that paints before client plugins load `MUST` show the shipped brand's display name, and the value `MUST` be checked against the manifest so a rebrand updates it.

## 6. Display Branding (Normative)

- The display name is user-facing copy owned by the brand manifest and the OEM profile; identity values and paths are not display copy and `MUST NOT` be re-spelled per locale.
- Localized dictionaries `MUST` carry a substitution token that the brand resolves at render time, not the brand name spelled into every string (`I18N_SPEC.md`). A locale that hardcodes one brand's name is a defect, including translations that name the framework instead.
- Copy that teaches the user what to type `MUST` follow the selected brand's desktop command as well as its display name: the command is build-time identity (`desktop.commandName`), so a dialog that spells the shipped command is wrong for every other brand.
- Display surfaces that paint before a deployment profile is available `MUST` fall back to the shipped brand's display name, never to the dictionary substitution token or a predecessor name.
- Startup and installer artwork is build-time identity: an OEM build `MUST` replace the rasters it ships with, and a runtime profile `MUST NOT` select another image. Artwork generation `MUST` take the display name from the manifest.
- Changing a display name `MUST NOT` change any manifest identity field in the same change; the two are separate decisions with separate review.

## 7. OEM Profile Boundary (Normative)

- A runtime OEM profile carries endpoints, the display brand, and product-surface defaults. It `MUST NOT` carry identity values, paths, the artifact prefix, or images.
- Profile defaults `MUST NOT` spell a brand name or scheme as a fallback that survives selection of another brand. Where a shared package needs a default, it `MUST` be brand-neutral or injected from the selected manifest; a literal shipped brand in shared code assumes exactly one brand and breaks the other.
- Every brand other than the shipped one `MUST` ship a deployment profile (`brands/<key>.oem.json`, packaged as `resources/oem.json`) that names its own display brand and its own IAM callback scheme. The shared defaults describe the shipped brand only; a gate `MUST` fail a non-shipped brand whose profile is missing or names another brand's name or scheme.
- An IAM or deep-link callback scheme `MUST` equal the brand protocol, and the OAuth client id `MUST` derive from that scheme, so a tenant registers one public client per installed brand. Registering the scheme of a sibling brand is a defect.
- Product-surface defaults `MUST` be explicit booleans with a documented shipped default; a deployment opts a surface in, and the user's own setting still wins.
- Endpoints and tenant identifiers belong to the deployment profile, not to identity code. A brand with no profile `MUST` either ship a profile or document the shared platform it deliberately uses.

## 8. Application-Family Identity versus Release Brand (Normative)

- A repository has two identity layers and they `MUST` be decided separately: the **application family** (repository directory, `app.key`, topology `appId`/`applicationCode`, deployment `application`, surface roots, IAM application and runtime ids, credential directory, public hosts, container image reference) and the **release brand** (Section 1 fields). The brand `MUST NOT` be used as a substitute for an application-family value, and vice versa.
- At fork time the assembly `MUST` record one application-family decision and keep it coherent: **one application code, one spelling**. `app.key`, topology `appId`/`applicationCode`, deployment `application`, client-env `application`, the chart/module/container-image names, the IAM runtime app id, the store slug and its install commands, and the surface `accessToken.appId`s `MUST` all derive from that one code. A second spelling of the same application (`<code>` versus `<code>2`, or a slug that drops a suffix) is a defect even when each file is internally consistent, because it splits one application across two identities in the store, IAM, and deployment.
- The **declared application spec is authoritative**, and a checkout directory name is infrastructure, not identity. Tooling that resolves an application id from a directory name `MUST` prefer the declared `topology.appId`; a materializer that refuses a checkout because its folder name differs from the declared id is a tooling defect, not an identity defect.
- The application code is a technical namespace and `MUST NOT` be presented as the product: display copy, installers, release assets, homes, ports, update feeds, and store display names come from the release brand (Section 1). An application slug that appears in a user-facing URL or command is the application's stable store key, not a brand name.
- A mismatch between those values `MUST` be treated as a release blocker for deployment lanes, because the deployment materializers refuse it, and `MUST` be reported by the fork preflight (Section 10).
- Renaming the application family is a migration, not a branding edit. It `MUST` include: re-registering the IAM application template and runtime application ids, re-provisioning tenant rows, re-issuing credentials for the new credential directory, moving or re-creating app surface roots and workspace rows, re-issuing TLS/DNS for public hosts, publishing under the new container image reference, and updating the app-store manifest `app.key`/slug/commands together. Branding-only changes `MUST NOT` trigger this migration.
- Renaming the application family is a migration, not a branding edit. It `MUST` include: re-registering the IAM application template and runtime application ids, re-provisioning tenant rows, re-issuing credentials for the new credential directory, moving or re-creating app surface roots and workspace rows, re-issuing TLS/DNS for public hosts, publishing under the new container image reference, and updating the app-store manifest `app.key`/slug/commands together. Branding-only changes `MUST NOT` trigger this migration.
- Values that the application family owns `MAY` differ from the brand: package names, the wire protocol family, environment variable prefixes derived from the application code, container image *references*, and the internal build framework stem. These `MUST` be documented as application-family values so a later rebrand does not "fix" them.

## 9. Documentation (Normative)

- Install and deployment documentation `MUST` name the published assets exactly, with the shipped brand's prefix, and `MUST` be updated in the same change as an artifact rename. A guide that names a file the release does not publish is a defect even when the release is correct.
- Documentation `MUST` link the shipped brand's release repository, tag scheme, and clone URL. Another product's repository, tag prefix, or download URL in a shipped guide is a defect.
- Documentation `MUST NOT` describe another brand's file names. A multi-brand repository documents the shipped brand and links the manifest for a build that selects another one.
- When a release renames an asset, the upgrade notes `MUST` name the previous and the new file, so an operator is not left guessing (`DOCUMENTATION_SPEC.md`).

## 10. Verification (Normative)

- A gate `MUST` run on every merge and every packaging run and `MUST` fail when: a manifest is missing or malformed, a brand declares the upstream identity, two brands share an identity value, a release repository, or a port block, a packaging lane stops deriving a name from the manifest, a packaging input assigns an identity value, a packaging lane names another product's repository as a constant, a file that names a release asset spells a foreign stem, or documentation, the release workflow, and the packaged file names disagree.
- The gate `MUST` check for absent files instead of skipping them, so a narrowed corpus cannot pass silently.
- Tests `MUST` resolve the brand manifest or the naming module instead of repeating a literal artifact name, so a brand change updates one expectation and fails one test rather than passing with a stale name.
- A gate `MUST` fail with the file and the surface that stopped matching, not only with a count.
- The release assembly `MUST` require the exact published asset set by name for the shipped brand, so an unexpected extra or missing asset fails before publication rather than after.
- Packaging `MUST` read the built artifact back: packaged product name, updater cache, GitHub feed repository, and runtime version. The standard's packaged-artifact checklist (Section 2) `MUST` be exercised on a real installer before a brand ships.
- A fork-time preflight (`SHOULD` be a single command) `MUST` report the application-family coherence of Section 8 and the packaging-input state of Section 5, so a new OEM discovers the mismatches before its first release.

## 11. Onboarding a New OEM Brand (Runbook)

Ordered steps; each records its evidence where the step says so.

1. **Create the application family.** Create the repository and choose one application code; align `app.key`, `specs/topology.spec.json` `appId`/`applicationCode`, `etc/sdkwork.deployment.config.json` and `etc/client-env.materialization.json` `application`, the surface `accessToken.appId`s, the store slug and its install commands, the container image repository, the chart/module names, and the IAM runtime app id to that **one spelling**. The checkout directory is named after the product repository and is not the identity. Evidence: `check-topology`, `check-app-manifest-standard`, deployment materializer dry run, single-slug gate.
2. **Declare the brand.** Copy `brands/<shipped>.json` to `brands/<key>.json` and change every `desktop` value, `home.dirName`, `displayName`, `companyName`, and `releaseRepository`; claim a port block at least nine ports away from every existing brand. Evidence: loader green, port-collision gate green.
3. **Decide the shipped brand** (the manifest the repository builds without a selection) and set the repository's default `DSH_BRAND` expectations accordingly. Every other brand `MUST` ship `brands/<key>.oem.json` with its display name and its own IAM callback scheme (step 7 covers the check).
4. **Replace build-time artwork.** Regenerate icons, tray, installer brand and welcome artwork from the brand raster; confirm the generator consumes `displayName` (Section 5/6). Evidence: regenerated assets committed, artwork gate green.
5. **Translate display copy through a placeholder.** Installer locales and any dictionary that names the product use the brand placeholder; platform usage descriptions interpolate the manifest name; the pre-plugin boot surface shows the shipped name. Evidence: locale gate green, one non-shipped brand renders its own name.
6. **Clear every packaging input.** Copy `packaging/<platform>.env.example`, confirm it carries no identity value, and delete identity assignments from local dotenv files, presets, workflow `env`, and CI variables. Evidence: packaging preflight refuses a predecessor value and succeeds with none.
7. **Point the release and update feed at the brand's repository.** Set `releaseRepository`, confirm packaging refuses another repository, and confirm the generated `app-update.yml` names it. Evidence: `latest.yml` in the brand repository, artifact readback green.
8. **Set the release workflow manifest.** `agent.workflow.json`: `app.name`, `app.repository`, `release.artifactPrefix` = brand prefix, `release.defaultVersion` = package version. Keep legacy tag triggers only as documented compatibility.
9. **Exercise every release lane.** Package each target unsigned and inspect the artifact matrix in Section 2: product name, cache, feed, GUID/`InstallLocation`, uninstall entry, file properties, package metadata, DMG/zip, and the application-family values from step 1.
10. **Install two brands side by side.** Install the shipped brand and the sibling; confirm separate directories, homes, userData, protocols, commands, port blocks, uninstall entries, and updater caches; uninstall one and confirm the other is untouched.
11. **Align documentation.** Replace every release repository, tag, asset name, clone URL, and installed-product name in the guides; run the documentation link and pairing gates. Evidence: verified command output, not prose claims.
12. **Record the fork contract** in the repository's `AGENTS.md` and `brands/README.md`: the OEM-owned surface inventory, the merged identity rules, and the preflight command. Evidence: `verify-oem-identity` green after an upstream merge rehearsal.

## 12. Conformance Matrix

| Surface | Owner | Verification |
| --- | --- | --- |
| Brand manifest fields and validation | `brands/<key>.json` + loader | loader + port-collision gate |
| Installed app id / Windows GUID / install directory | brand manifest only | packaging preflight refusal test + packaged artifact readback |
| Updater cache and update feed | brand manifest (`updaterCacheDirName`, `releaseRepository`) | artifact readback + release-assembly repository check |
| Brand-to-brand installed identity | `brands/<key>.json` + `brands/<key>.oem.json` | pairwise side-by-side spec + `verify-oem-identity` |
| Released artifact names, sidecars and bundles | naming module over the manifest | foreign-stem scan + release assembly exact-name set |
| Actions artifacts that carry published files | release workflow | workflow/assembly name check |
| Packaging inputs (dotenv, presets, workflow env) | platform config templates | packaging preflight refusal test + input scan |
| Installer copy and artwork | locale resources + generators | locale/artwork gates + a non-shipped brand render |
| Boot/startup display surface | boot-brand module | manifest comparison gate |
| OEM profile defaults and IAM callback | OEM profile + protocol-derived defaults | profile schema + scheme test |
| Application family (topology, app key, deployment, hosts) | repository contracts | fork preflight + deployment materializer |
| Release repository, tags, clone URLs | documentation + release workflow | link gates + release page existence |
| Side-by-side installation | packaged artifacts | manual install/uninstall checklist |

## 13. Known Divergence Backlog (Reference Implementation)

Findings from the `sdkwork-daxuedazi` audit that this standard now forbids but that are not yet migrated there. A new OEM `MUST NOT` copy these states.

| Severity | Finding | Rule | Action |
| --- | --- | --- | --- |
| high | Installer copy and macOS microphone usage description named the predecessor brand | 5, 6 | fixed in the reference implementation (brand placeholder + manifest interpolation) |
| high | Release documentation pointed at the predecessor repository and tag scheme | 3, 9 | fixed in the reference implementation |
| high | Packaging dotenv and a CI workflow pinned the predecessor application id | 2, 5 | fixed in the reference implementation |
| high | Every brand published its GitHub update feed from one hardcoded repository | 3 | fixed in the reference implementation |
| high | Uninstaller and installer logs target the updater cache derived from the package name, not the brand | 2 | fixed in the reference implementation (the NSIS `DSH_UPDATER_CACHE_NAME` define is the brand's cache directory) |
| high | Shared OEM-profile defaults spell one brand (display name, IAM scheme/client id) | 7 | fixed in the reference implementation for every shipped brand: a non-shipped brand must ship `brands/<key>.oem.json` (display name + own IAM callback), and the gate refuses one that does not |
| high | Application family mixed: repository directory, topology `appId`, deployment `application`, app key, surface ids, and public hosts disagree | 8 | fixed in the reference implementation: the application code `sdkwork-birdcoder2` is declared once and every store/IAM/deployment/client-env/chart/module/container-image value uses that one spelling; the checkout directory is infrastructure, and materializers must honor the declared `topology.appId` |
| medium | Store, IAM, client-env, and container image used a second application slug (`sdkwork-birdcoder`) next to `sdkwork-birdcoder2` | 8 | fixed (one slug everywhere; the single-slug gate fails a second spelling) |
| medium | Desktop host standalone default port equals the sibling brand's port | 2 | fixed in the reference implementation (the Host requires the brand's port; a fixed fallback is a gate failure) |
| medium | Client dictionaries and Desktop dialogs spelled one brand's command or fell back to the predecessor name | 6 | fixed in the reference implementation (command substituted from the manifest; fallbacks use the shipped display name) |
| medium | Shared client env defaults name the predecessor application id/key | 8 | part of the family migration |
| medium | Installer wordmark, boot page, and native failure copy carried literals | 5, 6 | generator and boot page fixed; keep the native copy brand-neutral |
| medium | `agent.app.config.json` store slug, commands, CDN paths, container image, and release metadata still name the predecessor | 4, 8 | part of the family/store migration |
| medium | `apps/desktop/package.json` homepage and file properties named the predecessor repository | 2, 4 | fixed (homepage) and verified on a signed build |
| medium | Locale translations name the framework (`DSH`) in startup dialogs | 6 | fixed in the reference implementation (every language renders the brand token) |
| low | Comments and asset filenames describe the predecessor brand | 5 | rename opportunistically; never copy into a new OEM |

## 14. Acceptance Checklist

- [ ] Each brand declares its manifest, and the loader rejects the upstream identity and malformed values.
- [ ] The manifest owns the application id, release repository, product name, executable, protocol, command, registry key, cache, prefix, port block, and home.
- [ ] The shipped brand's `release.artifactPrefix` equals the manifest's and `agent.workflow.json` names the shipped product and repository.
- [ ] No packaging input assigns identity; a predecessor value fails with both identities named.
- [ ] Packaging refuses to build a brand outside its release repository, and the packaged feed names that repository.
- [ ] Every published file, sidecar, bundle, and published-file Actions artifact starts with the prefix.
- [ ] No published name, workflow upload name, or documentation command contains a foreign product token.
- [ ] Installer copy, artwork, usage descriptions, and the boot surface render the selected display name.
- [ ] The OEM profile carries no identity, and the IAM callback scheme follows the brand protocol for every brand.
- [ ] The application family is coherent (directory, topology, deployment, app key, surfaces, hosts, credentials) and documented.
- [ ] The install/deploy guides name the brand's repository, tags, and exact assets.
- [ ] Packaged-artifact verification passed on a real installer for every target.
- [ ] Two brands install, update, and uninstall side by side without touching each other's data.
- [ ] The fork preflight and the verification gate run in CI and fail with the file named.
