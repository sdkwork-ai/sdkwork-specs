# RPC SDK Workspace And Proto Generation Detail Standard

- Version: 1.1
- Scope: proto contract workspace layout, RPC SDK family naming, RPC manifest shape, generated RPC SDK output, multi-language generation, SDKWork RPC generation verification
- Related: `RPC_SPEC.md`, `RPC_FRAMEWORK_SPEC.md`, `RPC_RESILIENCE_SPEC.md`, `DISCOVERY_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `RUST_RPC_SPEC.md`, `SECURITY_SPEC.md`, `OBSERVABILITY_SPEC.md`, `TEST_SPEC.md`, `QUALITY_GATE_SPEC.md`, `MIGRATION_SPEC.md`, `DOCUMENTATION_SPEC.md`

This detail standard implements the RPC SDK workspace and generation parts of `RPC_SPEC.md` and `SDK_SPEC.md`. It defines how SDKWork applications and reusable domains keep proto contracts, RPC manifests, generated RPC SDK packages, and verification evidence discoverable without changing the existing OpenAPI HTTP SDK generation workflow.

`RPC_SPEC.md` remains the source for language-neutral proto, service, method, metadata, error, and compatibility semantics. `SDK_SPEC.md` remains the source for SDK consumption rules and generated-client boundaries. This file owns only the physical RPC SDK workspace layout, RPC SDK family naming, generation inputs, generated-output placement, and generator verification rules.

## 1. Principles

Rules:

- RPC SDK generation is additive to OpenAPI HTTP SDK generation. Existing `sdkgen generate` commands without an explicit RPC protocol MUST continue to generate HTTP/OpenAPI SDKs.
- The `.proto` contract is the source of truth for RPC. SDKWork RPC manifests add operation ownership, auth, idempotency, surface, and compatibility metadata; they do not replace proto definitions.
- RPC SDKs MUST be generated from proto contracts plus a `kind: sdkwork.rpc.manifest` manifest.
- SDKWork RPC generation MAY be orchestrated by `@sdkwork/sdk-generator` / `sdkgen`, but protobuf compilation MUST use standard Buf/protoc-compatible tooling.
- Generated protobuf output MUST NOT be hand-edited. Fix proto contracts, the RPC manifest, generator options, or approved handwritten facades, then regenerate.
- Consumer code MUST use generated RPC SDK packages or approved composed wrappers. It MUST NOT replace missing SDK methods with raw HTTP, raw gRPC stubs, manual metadata auth, local DTO forks, or generated-output edits.
- Browser UI SHOULD continue to use generated HTTP app/backend SDKs unless the product explicitly enables gRPC-Web and documents the browser transport policy.

## 2. Standard Workspace Shape

Recommended application-root shape:

```text
<application-root>/
  proto/
    sdkwork/
      common/v1/
      <domain>/app/v3/
      <domain>/backend/v3/
      <domain>/internal/v1/
  sdks/
    sdkwork-<sdk-family-stem>-rpc-sdk/
      README.md
      sdk-manifest.json
      rpc/
        sdkwork-<sdk-family-stem>-rpc.manifest.json
      proto/
      sdkwork-<sdk-family-stem>-rpc-sdk-typescript/
      sdkwork-<sdk-family-stem>-rpc-sdk-go/
      sdkwork-<sdk-family-stem>-rpc-sdk-java/
      sdkwork-<sdk-family-stem>-rpc-sdk-python/
      sdkwork-<sdk-family-stem>-rpc-sdk-rust/
      specs/
        README.md
        component.spec.json
```

Rules:

- Proto source MAY live at the application root `proto/` directory or in a reusable domain contract package, but the RPC SDK family README and manifest MUST point to the canonical proto source.
- RPC SDK family directories live under the application or domain `sdks/` workspace. API authority names such as `sdkwork-<domain>-app-api` MUST NOT be used as RPC SDK family directories.
- Generated language workspaces inherit the RPC SDK family name: `sdkwork-<sdk-family-stem>-rpc-sdk-<language>`.
- Handwritten SDKWork facades, metadata providers, README files, and package scaffolds MUST live outside generated protobuf output.
- RPC SDK source workspaces use convention-first evidence. Normal source-control output is proven by
  the RPC SDK family directory, `rpc/*.manifest.json`, proto source reference, generated language
  workspace name, and the native package manifest such as `package.json`, `go.mod`, `pom.xml`,
  `pyproject.toml`, or `Cargo.toml`.
- RPC SDK generation MAY emit generated SDK control-plane evidence for release, CI, audit, or
  migration workflows with `sdkgen --protocol rpc --emit-control-plane`. When emitted, RPC uses the
  same `sdkgen` file names as HTTP generation:
  `.sdkwork/sdkwork-generator-manifest.json`, `.sdkwork/sdkwork-generator-changes.json`, and
  `.sdkwork/sdkwork-generator-report.json`.
- Optional RPC control-plane file paths are derived from the language workspace root and these
  standard file names. SDK family metadata in `sdk-manifest.json` and
  `specs/component.spec.json` SHOULD record only the family-level inspection policy, for example
  `inspectionPolicy.mode: "convention"`, `inspectionPolicy.protocol: "rpc"`, and
  `inspectionPolicy.optionalControlPlane.emitFlag: "--emit-control-plane"`. They SHOULD NOT
  duplicate per-language `manifest`, `changes`, or `report` paths for the optional control plane.
- RPC SDK family READMEs and component READMEs SHOULD describe optional generator evidence as
  convention-derived instead of listing the derived `.sdkwork/sdkwork-generator-*` paths. Standard
  and generator documentation may name those files to define emitted release, CI, audit, or
  migration evidence, but product SDK documentation should keep day-to-day evidence focused on the
  family root, manifest, proto source, language workspace name, and package manifest.
- RPC and HTTP generated outputs MUST live in separate SDK family/language workspace directories.
  They MUST NOT share one output path. Protocol identity is stored in convention evidence and, when
  control-plane evidence is emitted, in SDK metadata. It is not stored in a second file-name family.

## 3. Proto Contract Packages

Proto package names follow `RPC_SPEC.md`:

```text
sdkwork.<domain>.app.v<major>
sdkwork.<domain>.backend.v<major>
sdkwork.<domain>.internal.v<major>
sdkwork.common.v<major>
```

Rules:

- The `<domain>` segment MUST come from `DOMAIN_SPEC.md` unless an app-local extension domain is approved and recorded.
- Proto `package` names `MUST NOT` include `rpc`, `grpc`, `http`, or `openapi` segments.
- App, backend, and internal services MUST NOT be mixed in the same proto package.
- Proto file paths MUST mirror package names under an `apis/rpc/` or manifest-declared RPC root.
- Generated SDK and module names MUST include `rpc`; proto package names remain domain-first.
- Removed fields MUST reserve both field number and name.
- Public business RPC methods SHOULD be unary by default. Streaming methods require the additional policy defined by `RPC_SPEC.md`.

## 4. RPC SDK Family Naming

Canonical family pattern:

```text
sdkwork-<sdk-family-stem>-rpc-sdk
```

Language workspace patterns:

```text
sdkwork-<sdk-family-stem>-rpc-sdk-typescript
sdkwork-<sdk-family-stem>-rpc-sdk-go
sdkwork-<sdk-family-stem>-rpc-sdk-java
sdkwork-<sdk-family-stem>-rpc-sdk-python
sdkwork-<sdk-family-stem>-rpc-sdk-rust
```

Rules:

- RPC SDK family names use SDK family naming, not proto package names and not API authority names.
- The `<sdk-family-stem>` segment MUST match the sibling HTTP SDK family stem for the same capability
  line. If the existing HTTP families are `sdkwork-im-sdk`, `sdkwork-im-app-sdk`, and
  `sdkwork-im-backend-sdk`, the RPC family is `sdkwork-im-rpc-sdk`.
- The proto package domain MAY be broader than the SDK family stem. For example, Craw Chat uses
  `sdkwork-im-rpc-sdk` for package names under `sdkwork.communication.*`; `sdk-manifest.json`
  and `specs/component.spec.json` must record `domain: "communication"` and `capability: "chat"`.
- A new RPC SDK family MUST NOT introduce a different stem, such as `sdkwork-communication-rpc-sdk`,
  when sibling HTTP SDKs for the same product line already use `sdkwork-im-*`.
- RPC SDK package versions MUST be traceable to proto source version, generator version, RPC manifest version, and generated language package version.

## 5. RPC Manifest

Every RPC SDK family MUST have a manifest:

```json
{
  "schemaVersion": 1,
  "kind": "sdkwork.rpc.manifest",
  "domain": "communication",
  "sdkFamily": "sdkwork-im-rpc-sdk",
  "discoveryServiceName": "sdkwork-communication-internal-rpc",
  "defaultResilienceProfile": "rpc-default",
  "services": [
    {
      "package": "sdkwork.communication.app.v3",
      "service": "MessageService",
      "surface": "app",
      "methods": [
        {
          "method": "CreateMessage",
          "operationId": "messages.create",
          "auth": "app-session",
          "idempotency": "required",
          "streaming": "unary",
          "owner": "communication-open-api",
          "compatibility": "v3"
        }
      ]
    }
  ]
}
```

Rules:

- `kind` MUST be `sdkwork.rpc.manifest`.
- Each service/method pair MUST be unique.
- Each method MUST declare `operationId`, `auth`, `idempotency`, `streaming`, `owner`, and `compatibility`.
- `streaming` MUST be one of `unary`, `server`, `client`, or `bidi`.
- Write commands that can be retried MUST declare `idempotency: "required"` or document why idempotency is not applicable.
- Shared HTTP/RPC operations MUST preserve the same SDKWork operationId semantics.
- `sdkFamily` MUST equal the RPC SDK family directory and generator `--sdk-name` value.
- `discoveryServiceName` MUST be present when the RPC family is resolved through `sdkwork-discovery` in production paths.
- `defaultResilienceProfile` MUST name a profile from `RPC_RESILIENCE_SPEC.md` when the family is consumed across process boundaries.
- Method entries SHOULD declare `resilienceProfile` when they differ from the family default.

## 6. Generation Workflow

Standard flow:

```text
proto contracts
  -> RPC manifest
  -> proto lint and breaking-change check
  -> sdkgen --protocol rpc
  -> Buf/protoc-compatible language generation
  -> SDKWork package scaffold and metadata providers
  -> optional SDKWork RPC generation evidence for release/audit workflows
  -> generated client compile and smoke tests
```

Rules:

- `sdkgen --protocol rpc` MUST be selected explicitly. The default `sdkgen generate` behavior remains HTTP/OpenAPI generation.
- RPC generation MUST fail fast when proto roots, proto files, or RPC manifest files are missing.
- `sdkgen` SHOULD generate deterministic Buf/protoc configuration for the selected language target.
- `sdkgen` MUST NOT require Buf/protoc for HTTP generation.
- RPC dry-run mode MUST report planned files without writing output or requiring external proto generators.
- Production RPC generation SHOULD execute Buf/protoc generation through explicit arguments or a pinned native build-tool dependency, not through hidden global shell state.
- `sdkgen inspect --protocol rpc --output <workspace> --json` MUST inspect RPC source workspaces by
  convention when no generated control-plane files are present. The convention check MUST validate
  the `sdkwork-<stem>-rpc-sdk` family root, `sdkwork-<stem>-rpc-sdk-<language>` language workspace,
  `rpc/*.manifest.json` with matching `sdkFamily`, and the language package manifest.
- When `.sdkwork/sdkwork-generator-*` control-plane files are present, `sdkgen inspect --protocol rpc`
  MUST validate that SDK metadata declares `protocol: "rpc"`. `sdkgen inspect` is the generated SDK
  evidence inspection entrypoint: without `--protocol rpc` it remains the HTTP/OpenAPI inspection
  entrypoint and reads persisted generated SDK control-plane evidence with HTTP protocol metadata.

## 7. Generated Output Boundaries

Rules:

- Generated protobuf output is generator-owned and MUST NOT contain SDKWork module skills, plugins, secrets, runtime state, or app-private files.
- Normal generated RPC SDK source output MUST NOT require committed `.sdkwork/sdkwork-generator-*`
  files. The authoritative source evidence is the RPC SDK family root, RPC manifest, proto source
  reference, generated language workspace name, and native package manifest.
- SDKWork RPC control-plane files, when emitted for release, CI, audit, or migration evidence, MUST
  use the standard generated SDK control-plane names:
  `.sdkwork/sdkwork-generator-manifest.json`, `.sdkwork/sdkwork-generator-changes.json`, and
  `.sdkwork/sdkwork-generator-report.json`.
- RPC SDK family metadata MUST treat those optional control-plane paths as convention-derived
  artifact locations, not as required per-language source metadata. If metadata records the optional
  control-plane policy, it MUST do so once at the SDK family or component contract level and MUST NOT
  repeat derived `manifest`, `changes`, or `report` paths inside every generated language workspace
  entry.
- RPC SDK family/component READMEs MUST keep normal regeneration evidence convention-first. They MAY
  mention `--emit-control-plane` for release, CI, audit, or migration workflows, but they MUST NOT
  enumerate the derived `.sdkwork/sdkwork-generator-*` paths as normal source-control evidence.
- Emitted RPC generation evidence MUST declare `protocol: "rpc"` in SDK metadata.
- Files named `.sdkwork/sdkwork-rpc-generator-manifest.json`,
  `.sdkwork/sdkwork-rpc-generator-changes.json`, or
  `.sdkwork/sdkwork-rpc-generator-report.json` are not the standard RPC control plane.
- Every RPC generator control-plane file that carries SDK metadata MUST declare `protocol: "rpc"`
  under the SDK metadata object used by the generator artifact.
- `sdkgen inspect --protocol rpc --output <workspace> --json` MUST evaluate convention evidence when
  no generated control-plane files are present, and MUST evaluate standard generated SDK
  control-plane files when they are present.
- `sdkgen inspect` without `--protocol rpc` MUST NOT treat RPC control-plane files as HTTP/OpenAPI
  evidence; a protocol mismatch MUST be reported as invalid generated SDK evidence.
- Generator CLI help, generated READMEs, and product README examples SHOULD describe `sdkgen inspect`
  as generated SDK evidence inspection. They MUST NOT imply that normal RPC inspection requires
  persisted generated SDK control-plane files.
- OpenAPI HTTP SDK workspaces and RPC SDK workspaces MUST NOT overwrite each other because their
  generated language workspace directories are separate.
- RPC generation MUST NOT target an HTTP/OpenAPI SDK output path. HTTP/OpenAPI generation MUST NOT
  target an RPC SDK output path.
- Handwritten metadata providers, deadline helpers, idempotency helpers, and composed facades MUST be outside generated protobuf output and must import generated clients through package root entrypoints.

## 8. Language Baseline

The first standard RPC SDK generation baseline is:

- TypeScript
- Go
- Java
- Python
- Rust

Rules:

- A product MAY generate fewer languages only when its RPC SDK family README declares the supported subset and no consumer expects the missing package.
- Additional targets such as Dart, Kotlin, Swift, C#, Flutter, PHP, and Ruby MAY be added once package scaffolds, generated-client compilation, and metadata-provider support are verified.
- Rust generation MUST align with `RUST_RPC_SPEC.md`; proto-only crates stay separate from RPC server adapter crates.

## 9. Application Integration

Rules:

- Applications construct RPC SDK clients during bootstrap and inject them into service facades or backend services.
- Protected app/backend RPC clients MUST receive metadata providers for `authorization`, `access-token`, `traceparent`, `idempotency-key`, and `x-request-hash` through SDK/bootstrap infrastructure.
- Business modules MUST NOT assemble raw metadata headers directly.
- Client calls SHOULD set deadlines. Generated or composed clients SHOULD expose cancellation where the platform supports it.
- Retry helpers MUST honor idempotency metadata from the RPC manifest.

## 10. Verification

Every RPC SDK family change MUST verify the relevant subset:

- Proto files compile.
- Proto lint passes.
- Breaking-change check passes against the previous released proto set.
- RPC manifest covers every generated service/method.
- `sdkgen --protocol rpc --dry-run` succeeds.
- `sdkgen inspect --protocol rpc --output <workspace> --json` succeeds for every generated and
  supported language workspace through convention evidence or emitted control-plane evidence.
- Generated client package compiles for every supported language in the family.
- At least one unary client/server smoke test passes for public RPC packages.
- Auth metadata, deadlines, cancellation, idempotency, and error mapping are tested.
- HTTP/OpenAPI `sdkgen generate` non-regression tests pass; RPC generation MUST NOT affect existing HTTP generation.

## 11. Acceptance Checklist

- [ ] Proto source path and RPC manifest path are documented.
- [ ] RPC SDK family name follows `sdkwork-<sdk-family-stem>-rpc-sdk` and shares the same stem as sibling public/app/backend SDK families.
- [ ] Manifest uses `kind: sdkwork.rpc.manifest`.
- [ ] `discoveryServiceName` is present when production dynamic resolution is used.
- [ ] `defaultResilienceProfile` is present when the RPC family is consumed across process boundaries.
- [ ] Every service/method maps to exactly one operationId unless documented as composition.
- [ ] Generated protobuf output is separate from SDKWork authored wrappers and optional control-plane files.
- [ ] Normal source output does not require committed `.sdkwork/sdkwork-generator-*` files.
- [ ] Optional emitted RPC control-plane files use `.sdkwork/sdkwork-generator-manifest.json`, `.sdkwork/sdkwork-generator-changes.json`, and `.sdkwork/sdkwork-generator-report.json`.
- [ ] Optional emitted RPC control-plane SDK metadata declares `protocol: "rpc"`.
- [ ] RPC SDK family metadata records optional control-plane policy at most once at family/component level and does not duplicate derived `manifest`, `changes`, or `report` paths per language workspace.
- [ ] RPC SDK family/component READMEs describe optional generator evidence as convention-derived and do not enumerate derived `.sdkwork/sdkwork-generator-*` paths as normal source-control evidence.
- [ ] `sdkgen inspect --protocol rpc` succeeds for every generated and supported language workspace.
- [ ] RPC and HTTP generated outputs use separate SDK family/language workspace directories and do not share one output path.
- [ ] Existing OpenAPI HTTP SDK generation remains compatible and does not require RPC flags or proto tooling.
- [ ] Generated RPC SDK README includes endpoint, TLS/mTLS, metadata auth, deadline, idempotency, and unary call examples.
- [ ] Verification commands and outputs are recorded.
