# ADR-20260911 Application Client Root Archetype

Status: accepted
Requirement: REQ-2026-0911
Owner: SDKWork platform
Date: 2026-09-11
Specs: `APP_RUNTIME_TOPOLOGY_SPEC.md`, `APP_RUNTIME_TOPOLOGY_ARCHETYPES.md`, `APP_RUNTIME_TOPOLOGY_NAMING.md`, `APP_MANIFEST_SPEC.md`

## Context

Four live applications declare `archetype: application-client-root` in
`specs/topology.spec.json` with the note "No owned HTTP public-ingress; nginx
webserver profile remains disabled": `sdkwork-mall`, `sdkwork-music`,
`sdkwork-sandbox`, and `sdkwork-web-framework`. Each declares exactly one
surface, `platform.api-gateway`, and empty process lists in both
`standalone.development` and `cloud.development` orchestration profiles, because
the browser bundle is served by the application's own dev tooling rather than by
a standalone gateway process.

The archetype was never registered. It is absent from the archetype index in
`APP_RUNTIME_TOPOLOGY_ARCHETYPES.md` and from the archetype registry in
`APP_RUNTIME_TOPOLOGY_NAMING.md` section 7, and schema v5 did not validate the
`archetype` field at all.

Schema v5 compensated with two unconditional surface requirements in
`spec-v5.mjs`: every topology root had to declare both `application.public-ingress`
and `platform.api-gateway`. That rule is wrong for a client root, which owns no
application ingress by design, and it is wrong for a standalone-only application
that has no platform-gateway relationship at all. Schema v2 carried the correct
archetype-driven form (`REQUIRED_SURFACES_BY_ARCHETYPE`); the v5 rewrite dropped
it. The same v5 rewrite also hardcoded `vocabulary.deploymentProfile.allowed` to
exactly `["standalone", "cloud"]`, which cannot be satisfied by a
profile-limited application whose `runtime.supportedDeploymentProfiles` names
one profile (`APP_MANIFEST_SPEC.md` section 10.1), and required exactly one
`api-standalone-gateway` process whenever a `standalone.development` profile
existed, even for an application that serves no application HTTP API.

## Decision

Register `application-client-root` as a fourth application topology archetype.

- Connectivity planes: `platform` only. The archetype owns no application-plane
  surface and `MUST NOT` declare `application.public-ingress` or
  `application.app-http`.
- Required surface: `platform.api-gateway` (`http`), carrying `httpUrlEnv` and,
  for a browser consumer, `clientHttpEnv`.
- Allowed profiles: `standalone.development`, `standalone.production`,
  `cloud.development`, `cloud.production`.
- It declares no `api-standalone-gateway` process in any orchestration profile.
- An application that later serves an owned application HTTP API `MUST` migrate
  to `application-http-gateway` rather than adding an application-plane surface
  to this archetype.

Restore the archetype-driven validation that schema v2 already had:

- `spec-v5.mjs` validates `archetype` against the registered vocabulary and
  requires only the surfaces that the archetype owns.
- `vocabulary.deploymentProfile.allowed` is a non-empty subset of
  `standalone`, `cloud` in canonical order, mirroring
  `runtime.supportedDeploymentProfiles`.
- The "exactly one application HTTP ingress" rule for `standalone.development`
  is applied only when the application actually declares an application-plane
  HTTP surface, matching the wording already in `APP_RUNTIME_TOPOLOGY_SPEC.md`.
- The canonical schema (`sdkwork-specs/schemas/sdkwork.app.topology.schema.v5.json`)
  declares the archetype enum, requires `archetype`, and ties required surfaces
  to it, so the machine-readable contract and the validator agree.

`client-application`, declared by `sdkwork-messaging`, is not registered. That
application declares a plain HTTP application ingress and no realtime surface,
so it is normalized to the registered `application-http-gateway` archetype
instead of adding a second client archetype.

## Alternatives

- **Migrate the four applications to `application-http-gateway`.** Rejected:
  they own no application ingress, so they would have to publish a surface that
  does not exist.
- **Add an optional `application.public-ingress` to each client root.** Rejected:
  it declares an ingress the application does not serve, and it contradicts the
  each application's own `archetypeNotes`.
- **Register `client-application` as a fifth archetype.** Rejected: its only
  member declares an application HTTP ingress and only differs from
  `application-http-gateway` by also declaring `platform.api-gateway`, which that
  archetype already permits as an optional surface.
- **Keep the unconditional v5 surface requirements and relax nothing.**
  Rejected: it makes a registered fleet gate and the topology contract
  mutually unsatisfiable for a profile-limited application.

## Consequences

- A client root validates without inventing an ingress, and a standalone-only
  application no longer has to declare a platform gateway it does not use.
- A profile-limited application can keep `runtime.supportedDeploymentProfiles`
  and its topology vocabulary consistent, which
  `check-topology-deployment-profiles.mjs` requires.
- `archetype` becomes a validated field, so an unregistered archetype is now a
  schema and validator error instead of a silently ignored string.

## Verification

- `node --test tests/*.test.mjs` in `sdkwork-app-topology`: 112 tests pass,
  including the new cases for client-root surface requirements, the conditional
  standalone gateway rule, and the deployment-profile subset vocabulary.
- `validateTopologySpec` over every `sdkwork-*/specs/topology.spec.json`: 78
  specs validated, only `sdkwork-drama` fails for an unrelated missing
  `orchestration.profiles` block.
- `node tools/check-topology-deployment-profiles.mjs --workspace <workspace>`:
  19 findings, unchanged, within its recorded baseline.
- `bundled topology v5 schema stays aligned with the canonical standards
  schema` keeps the two schema copies byte-identical.

## Supersedes / Superseded By

None.
