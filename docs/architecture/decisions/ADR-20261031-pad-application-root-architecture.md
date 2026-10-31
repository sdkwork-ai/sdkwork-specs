# ADR-20261031 Pad Application Root Architecture

Status: accepted
Requirement: REQ-2026-1031
Owner: SDKWork platform
Date: 2026-10-31
Specs: `APP_PAD_ARCHITECTURE_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APPLICATION_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`, `APP_MANIFEST_SPEC.md`, `CONFIG_SPEC.md`, `NAMING_SPEC.md`, `TEST_SPEC.md`

## Context

SDKWork has explicit application-root standards for PC, H5/Capacitor, Flutter,
mini program, native Android, native iOS, native HarmonyOS, uni-app, Unity, and
static web. Tablet delivery has been split across two incomplete paths:

- `APP_PC_ARCHITECTURE_SPEC.md` and `DESKTOP_APP_ARCHITECTURE_SPEC.md` let a PC
  root ship iPadOS and Android tablet packages by reusing the PC renderer. That
  path is valid when tablet is an additional package target of a PC product.
- `APPLICATION_SPEC.md` and `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md` declare a
  `-pad` application root, but map it to per-target mobile standards. That is
  not the PC-consistent architecture the tablet product needs, and it leaves
  tablet adaptation without a single authority.

The result is inconsistent tablet navigation, layout, multitasking, input,
safe-area handling, packaging, and verification across teams. A tablet-first
product has no canonical root, host package, or adaptation contract.

## Decision

Add `APP_PAD_ARCHITECTURE_SPEC.md` as the pad/tablet root architecture
standard, and register it across the client, UI, application, manifest, config,
naming, command, and test authorities.

- A pad root is `apps/sdkwork-<application-code>-pad/` with
  `sdkwork-<application-code>-pad-*`, `sdkwork-<application-code>-pad-console-*`,
  and `sdkwork-<application-code>-pad-admin-*` packages.
- The pad architecture is the PC architecture with the `pad` segment: the same
  thin bootstrap, package roles, app/console/admin split, generated-SDK
  boundary, appbase IAM runtime, global TokenManager, host adapter boundary,
  route identity, and config discipline.
- A pad root ships exactly one `sdkwork-<application-code>-pad-tauri` host
  package. It targets `tablet-ipados` and `tablet-android` only and declares
  `clientArchitecture = "tauri"`. Electron, Capacitor, browser, desktop, server,
  and container targets are not pad-root targets.
- The pad root is selected for a tablet-first product with a dedicated tablet
  UX, tablet-only capability set, or its own app identity/store listing. A PC
  product that only adds tablet packages keeps the PC root and its tablet
  targets.
- `APP_PAD_ARCHITECTURE_SPEC.md` section 5 is the shared tablet adaptation
  contract. Both pad roots and PC roots that enable tablet targets apply it,
  including window classes, multitasking, input parity, safe areas,
  accessibility, performance, and `specs/tablet-adaptation.spec.json` evidence.
- The existing tablet runtime targets, deployment profiles, SDK families, and
  appbase IAM model remain unchanged. No new runtime target, deployment profile,
  or app type is introduced.
- Existing pad roots that used a mobile framework must migrate to the PC-aligned
  pad architecture or be reclassified as the matching mobile root under
  `MIGRATION_SPEC.md`, with a time-boxed governance exception where needed.

## Alternatives

- **Extend only the PC architecture standard.** Rejected: it would leave the
  tablet-first product root, package family, host package, and adaptation
  contract undefined, and it would keep `APPLICATION_SPEC.md` pointing the
  `-pad` root at mobile standards.
- **Make the pad root a per-target mobile root.** Rejected: it contradicts the
  requested PC-consistent architecture, duplicates mobile auth/runtime models,
  and does not produce a tablet-first large-screen renderer.
- **Make the pad root a thin wrapper around the PC bundle.** Rejected: it hides
  the adaptation work, prevents a tablet-specific product identity and store
  listing, and creates a WebView-wrapper architecture rather than a real client
  root.
- **Add new `tablet-*` runtime targets or a new deployment profile.** Rejected:
  the existing `tablet-ipados` and `tablet-android` targets already describe the
  runtime, and a new profile would fragment config and release evidence.
- **Keep tablet as a PC-only package target and remove the pad root.** Rejected:
  it would force tablet-first products into a PC product identity and leave no
  dedicated tablet adaptation standard.

## Consequences

- Tablet-first products get a canonical root, package family, host package, and
  verifiable adaptation contract without inventing local conventions.
- PC products keep the cheaper tablet-package path, but they now carry the same
  adaptation evidence when they ship tablet targets.
- The pad root and PC root can serve the same product through shared contracts,
  SDKs, route ids, and design tokens, but not through UI package imports. This
  preserves the cross-client boundary at the cost of some layout duplication.
- A product must choose between the PC-root tablet path and the pad root for one
  app identity. Moving between them later is an application-root change with
  ADR, migration, and store-continuity evidence.
- Existing pad roots that used mobile frameworks need a migration or
  reclassification. This is intentional: the old interpretation had no single
  tablet architecture and could not enforce tablet adaptation.

## Verification

- `APP_PAD_ARCHITECTURE_SPEC.md` is listed in `README.md` and cited by
  `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `UI_ARCHITECTURE_SPEC.md`,
  `APPLICATION_SPEC.md`, `APP_MANIFEST_SPEC.md`, `CONFIG_SPEC.md`,
  `NAMING_SPEC.md`, `PNPM_SCRIPT_SPEC.md`, and `TEST_SPEC.md`.
- `node tools/check-client-host-packages.mjs --root .` recognizes `-pad` roots
  and requires exactly one `-pad-tauri` host package.
- `node tools/check-apps-directory-index.mjs --root .` recognizes the `-pad`
  surface role.
- Pad and PC-tablet roots provide `specs/tablet-adaptation.spec.json` and
  `node tools/check-tablet-adaptation.mjs --root .` proves the schema, matrix
  coverage, evidence paths, and platform-specific multitasking rules.
- `node --test tools/check-tablet-adaptation.test.mjs` covers the executable
  adaptation contract.
- `git diff --check` and the narrow documentation checks pass.

## Supersedes / Superseded By

None. This decision replaces the prior per-target mobile interpretation of the
`-pad` root in `APPLICATION_SPEC.md` and `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`.
