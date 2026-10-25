# SDK Family Manifest Standard

<!-- SDKWORK-SPEC: v1 -->

Authority for the single machine-readable contract at `sdks/<sdkFamily>/sdk-manifest.json`.

Related:

- `SDK_PACKAGE_NAMING_SPEC.md` — consumer vs transport naming
- `SDK_WORKSPACE_GENERATION_SPEC.md` — workspace layout and generation workflow
- `schemas/SDK_MANIFEST.schema.json` — JSON schema

## 1. Single SSOT per SDK family

Each HTTP/RPC SDK family **MUST** maintain one family-root manifest:

```text
sdks/<sdkFamilyStem>/sdk-manifest.json
```

This file is the **only** per-family metadata SSOT for:

- SDK naming (`packageName`, `transportPackageName`, `typescript.*`)
- Ownership (`sdkOwner`, `apiAuthority`, `generationInputSpec`, `authoritySpec`)
- Discovery (`discoverySurface`)
- Cross-SDK dependencies (`sdkDependencies`)
- Multi-language layout (`languages[]`)

The legacy parallel SDK registry file is removed at every level. SDK families, application roots, and repository
SDK roots **MUST NOT** create, read, or retain that file. Global ownership checks and composition
resolution **MUST** read `sdk-manifest.json`.

## 2. Multi-family discovery

Repository and application generation scripts **MUST** discover authored families from
`sdks/<sdkFamily>/sdk-manifest.json`. Application dependency composition belongs in the existing
`agent.app.config.json` and `specs/component.spec.json` contracts. A parallel SDK registry that
restates family ownership, dependencies, or generation inputs **MUST NOT** be introduced.

## 3. Required fields

### 3.1 Naming (TypeScript HTTP)

See `SDK_PACKAGE_NAMING_SPEC.md`. Required:

- `packageName` — `@sdkwork/<token>` (consumer)
- `transportPackageName` — `<sdkFamilyStem>-generated-typescript`
- `typescript.composedRoot`, `composedEntry`, `transportRoot`, `transportEntry`

### 3.2 Ownership

Required for families with `openapi/*.sdkgen.*` or `generated/server-openapi`:

- `sdkOwner`
- `apiAuthority`
- `generationInputSpec` (or `authoritySpec` for legacy readers)
- `discoverySurface` when the family exposes HTTP APIs
- `sdkDependencies` — explicit array (`[]` when none)

### 3.3 Languages

`languages[]` entries **MUST** use explicit naming fields for TypeScript:

| Field | TypeScript value |
| --- | --- |
| `consumerPackageName` | `@sdkwork/<token>` |
| `transportPackageName` | `<sdkFamilyStem>-generated-typescript` |

Do not overload `languages[].name` with `@sdkwork/*` when `packagePath` points at `generated/server-openapi`.

## 4. Parallel registry prohibition

SDK family, application, and repository roots **MUST NOT** add a parallel registry beside the
family manifests. Standard tooling treats a removed registry file as a hard violation and does not
merge, recreate, or silently delete it.

## 5. Verification

```bash
node sdkwork-specs/tools/check-sdk-standard.mjs --workspace <root>
```

Violations:

- `missing-manifest-ownership` — generated family without ownership in manifest
- `parallel-sdk-registry-file` — a removed parallel SDK registry is present at any level
- Naming/layout violations from `SDK_PACKAGE_NAMING_SPEC.md`
