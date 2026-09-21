# Routing and Pricing Resolution Standard

- Version: 1.0
- Scope: upstream account route selection, resource authorization, account grouping, pricing resolution, dimension contracts, fail-closed points, and operator diagnostics for Cloud Router
- Related: `DOMAIN_SPEC.md`, `API_SPEC.md`, `DATABASE_SPEC.md`, `REGION_SPEC.md`, `MEDIA_RESOURCE_SPEC.md`, `INTEGRATION_SPEC.md`, `CONFIG_SPEC.md`, `ENVIRONMENT_SPEC.md`, `OPERATIONS_SPEC.md`, `TEST_SPEC.md`, `QUALITY_GATE_SPEC.md`

This standard defines how a Cloud Router request becomes a billed upstream call. It exists because the
routing and pricing pipelines are a single contract split across two repositories:
`sdkwork-cloudrouter` decides *which account* serves a request, and `sdkwork-models` decides *what that
costs*. A defect on either side of that seam is invisible to the other side's tests, and the failure
surface is a hard `502` on live traffic.

The rules below are written to be checkable. Every `MUST` with a gate is listed in section 9.

## 1. Why this standard exists

On 2026-09-17 the catalog published time-of-day pricing for four DeepSeek models. Every one of that
model family's LLM rates was conditioned on a `tier_code` dimension **and** carried a time-window
schedule. The schedule already encoded the tier in its window codes (`off_peak_weekday_morning`,
`peak_weekday_afternoon`), and the runtime selects `time_window` rates purely by schedule. The extra
condition could therefore never be satisfied: the runtime has no `tier_code` producer for a non-video
meter. All four models became unroutable with `price_not_found`, and because the failed gate sits
before dispatch, the request never reached the upstream provider at all.

Three properties made this outage possible, and each is addressed by a rule below:

1. **The defect crossed a repository seam.** `sdkwork-models` validates that its rates are structurally
   sound; `sdkwork-cloudrouter` validates that it can price what it routes. Neither asked whether the
   dimensions a rate *conditions on* can be *produced* by the runtime that consumes it.
2. **The diagnostic pointed the wrong way.** The error text suggested checking the upstream API key
   (`上游账号凭证被拒绝（401）`), but the chain stopped in pricing — no credential was ever evaluated.
   Section 8 makes the failed stage authoritative over any suggested cause.
3. **The report meant to catch this was structurally blind to it.** The generator treated `tier_code`
   as a known runtime dimension globally, so it skipped the very rows that were broken. Section 9.3
   requires that report to run in the contract gate.

## 2. Request lifecycle

A Cloud Router request resolves through an ordered pipeline. Each stage is defined as either
**fail-closed** (the request stops) or **permissive** (the stage is skipped). The distinction is
normative: making a permissive stage fail-closed, or vice versa, changes which requests succeed.

| # | Stage | Outcome | Fail behaviour |
| --- | --- | --- | --- |
| 1 | Sticky route reuse | Reuses the account bound to an existing session/route | skip when unset |
| 2 | API-key scope check | The key is valid for the requested API/capability | fail-closed |
| 3 | Group model access gate | The resolved account group's blacklist/whitelist admits the model | fail-closed (`ModelForbidden`) |
| 4 | Group-scoped snapshot | Candidate model routes and account routes for the resolved group | fail-closed when both empty |
| 5 | Account resource gate | At least one callable account's resources cover the request | fail-closed |
| 6 | Group-bound route plan | Candidate accounts ordered by the group's strategy | fail-closed when no candidate is priceable |
| 7 | Pricing preflight | A published rate exists for the resolved resource and meter | fail-closed (`PricingUnavailable`) |
| 8 | Dispatch | Credential, endpoint, and transport health are evaluated **for the first time here** | fail-closed |
| 9 | Settlement | The same rate identity as stage 7 is used to bill the completed usage | fail-closed |

Rules:

- Stages 3 through 7 `MUST` complete before any upstream credential is read or transmitted. A pricing
  gap is therefore never evidence of a credential problem. Implementations `MUST NOT` emit a credential
  or authentication hint from stages before dispatch.
- Stage 7 and stage 9 `MUST` resolve the **same** rate identity. The two paths compute their pricing
  dimensions independently; a rate that passes stage 7 and fails stage 9 silently produces zero-priced
  usage records. Section 5.4 defines the required dimension parity.
- A pricing gap in one bound account group `MUST NOT` fail the whole request while another bound group
  has a priced account for the same model (stage 6/7 retry across contexts). When every context fails,
  the pricing error is the reported cause, because it is the actionable one.

## 3. Candidate formation and selection

### 3.1 Candidates carry no vendor

Rules:

- A candidate account route `MUST` be identified by `(account_group_id, region_code, weight)` and `MUST NOT`
  be assumed to carry a vendor, supplier, or model affinity.
- The router `MUST NOT` assume a candidate account's vendor matches the requested model's vendor. A
  routed account is eligible for a model only through its resource entitlements (section 4), never
  through a naming convention or directory proximity.

**Rationale.** Accounts are pooled per group, not per vendor. A pool that mixes vendors is legal and is
in fact the default (`default-group`). Any rule that infers vendor from account identity re-introduces
the 2026-09-20 failure by a different route.

### 3.2 Synthetic routes

Rules:

- When no explicit model route binds an account to a model, the router `MAY` synthesize a route from the
  account route alone.
- A synthetic route `MUST` be derived only from the account's own supplier/base-url/credential facts. It
  `MUST NOT` inherit a vendor or supplier from the account group, the request, or another account.

### 3.3 Selection order

Rules:

- Accounts within a pool `MUST` be ordered by the group's configured binding strategy, then by
  priority/weight. Ties `MUST` resolve deterministically (stable ordering), so repeated identical
  requests do not flap between accounts.
- The primary account `MUST` be the first candidate in the planner's order that passes the pricing
  preflight. Accounts skipped for a pricing gap `MUST NOT` be offered as failover targets: replaying the
  same gap downstream only reproduces the same failure.
- Region preference `MUST` prefer the model's configured default billing region, aligning selection with
  the pricing region scope.

## 4. Resource authorization

### 4.1 Three binding scopes

Resource bindings attach resources to a subject at one of three scopes:

| Scope | Binds resources to | Applies when |
| --- | --- | --- |
| `supplier` | every account of one supplier | always |
| `account_group` | every account in one account group | always |
| `account` | exactly one account | only when at least one account-scope binding exists for that account |

### 4.2 The unbound-inherit rule

This is the single most consequential rule in the authorization model.

**Rule.** An account with **no** `account`-scope resource binding inherits the **full** resource set of
every account group it belongs to. An account with **at least one** `account`-scope binding is
intersected to exactly those bindings.

- The presence of even one `account`-scope binding `MUST` switch the account from inherit-all to
  exact-set. The two modes `MUST NOT` be combined for one account.
- A resource entitlement represented as JSON `null` `MUST` be interpreted as "unrestricted", not as
  "no resources". A missing list and an empty list are different facts and `MUST NOT` be conflated.
- Because the inherit branch is expressed as a `NOT EXISTS` guard, seeding an account-scope binding is
  the **only** supported way to narrow an account. Adding an entitlement filter that is not an
  account-scope binding `MUST NOT` be expected to narrow anything.

**Operational consequence.** A group that pools accounts across vendors, with no account-scope bindings
anywhere, grants every pooled account eligibility for every resource bound to the group. The
2026-09-20 incident selected an OpenAI account to serve a DeepSeek model for exactly this reason.

Rules:

- A deployment that pools a cross-vendor account group `MUST` either (a) give each account an
  `account`-scope binding limiting it to its own vendor's resources, or (b) accept that any pooled
  account is entitlement-eligible for any group resource, and rely on the pricing preflight to reject
  the mismatch.
- Option (b) is permitted but `MUST` be recorded as a deliberate decision, because it converts an
  authorization error into a pricing error and moves the failure later in the pipeline (stage 7 instead
  of stage 5).

### 4.3 Entitlement matching

Rules:

- An entitlement `MUST` match a request on the dimensions it declares. An entitlement that declares no
  `api_scope` or no `capabilities` `MUST` match all values of that dimension, not none.
- Resource matching `MUST` be evaluated against the request's API code and capability, using the same
  resource vocabulary the pricing resource is keyed by.

## 5. Pricing resolution

### 5.1 Two price sides, one billing authority

| Side | Purpose | May fail the request? |
| --- | --- | --- |
| `official_reference` | Derives the customer charge | yes — required |
| `upstream_cost` | Procurement cost, gross margin, cost accounting | no — degrade to "no procurement cost" |

Rules:

- A missing `upstream_cost` price `MUST NOT` fail customer billing. It `MUST` downgrade to "no
  procurement cost" and emit a diagnostic.
- The `official_reference` price is the customer-billing authority and `MUST` exist for every routable
  model/meter/region the catalog publishes.
- Official reference prices `MUST` be supplier-agnostic. A price row that pins a supplier or account on
  the official side is a contract violation, because it would make the customer charge depend on which
  pooled account happened to be selected.

### 5.2 Dimensions

The runtime `MUST` construct one pricing dimension context and populate only the dimensions it can
actually resolve. The table below is the authority for who produces what.

| Dimension | Producer | Applicable meters |
| --- | --- | --- |
| `api_code`, `operation_id` | invocation resource | all |
| `vendor_code`, `catalog_key`, `model`, `meter_code`, `region_code` | resolver | all |
| `provider_code` | resolver, when an upstream account is selected | all |
| `context_tokens` | summed LLM input/cache quantities | `llm_*` |
| `output_type` / `input_type` | derived from the meter | image/audio/video meters |
| `media_type` | derived from the meter | image/audio/video meters |
| `duration_seconds`, `result_count`, `image_count` | reported usage line | metered media |
| `resolution`, `quality` | request body | video / vendor quality modes |
| `tier_code` | **video path only** — intersected from `ai_model_video_profile` + priced tiers | `video_*` meters |
| `quality` (fallback) | request body pointer (`/quality`, `/output/quality`, `/mode`) | vendor quality modes |

Rules:

- A rate `MUST NOT` condition on a dimension that no producer supplies for that rate's meter and rate
  variant. Section 5.4 covers the time-window case, which is the archetype of this violation.
- `tier_code` has exactly **one** producer: the video tier decision, resolved by intersecting the
  catalog's declared `ai_model_video_profile` tiers with the tiers the model's rates are actually priced
  on. For any non-video meter the runtime `MUST` supply no `tier_code`.
- A condition using operator `eq` `MUST` evaluate to `false` when the dimension is absent. Implementations
  `MUST NOT` treat an absent dimension as a wildcard match for `eq`; that would silently widen pricing.
- Request-body-derived dimensions `MUST NOT` override a catalog-declared dimension of the same name. The
  catalog is the billing authority; the request is a hint. When `tier_code` is declared by the catalog,
  the catalog value wins.

### 5.3 Rate selection and region fallback

Rules:

- Candidate rates `MUST` be filtered by effectiveness (`effective_from`/`effective_to`), by declared
  conditions, and by the risk of ambiguity.
- When two surviving candidates are indistinguishable on rank, specificity, priority, and effectiveness
  but differ by `rate_hash`, resolution `MUST` fail as ambiguous rather than pick one. Silent
  tie-breaking on price is a revenue-correctness defect.
- Region resolution `MUST` follow the chain: requested region → configured default billing region →
  `global` → region-agnostic. Each probe `MUST` evaluate conditions against the region actually being
  probed, not the originally requested one; otherwise a conditional `global` rate is wrongly rejected
  during fallback.
- The region-agnostic probe `MUST NOT` match a rate pinned to a region by a condition. Region pinning is
  honoured or the rate is not borrowed.

### 5.4 Time-window rates

**Rule.** A `time_window` rate is selected **only** by its schedule. It `MUST NOT` also condition on
`tier_code` (or any dimension that duplicates what the schedule expresses).

- The tier a `time_window` rate represents `MUST` be expressed by its window codes, and the window codes
  `MUST` be named with the tier as a prefix (`peak_weekday_morning`, `off_peak_weekend`).
- A `time_window` rate `MUST` carry a schedule with at least one weekly window, a valid IANA time zone,
  and unique window codes. A `standard` rate `MUST NOT` carry a schedule.
- The schedule's window set `MUST` be disjoint from other `time_window` rates of the same model, meter,
  and price book. Overlapping windows make the applicable rate ambiguous.

**Rationale.** `time_window` selection consults the schedule and returns the matching window code; it
never reads request dimensions for the window decision. A `tier_code` condition on such a rate is
therefore unsatisfiable whenever no video profile backs the meter — the condition can only remove the
rate from consideration. Expressing the same fact twice, in two encodings that disagree
(`off_peak` vs `off_peak_weekday_morning`), produced the 2026-09-20 outage.

**Migration note.** Correcting such a rate means removing the condition **at its source field**. In the
catalog, `conditions` is a derived array rebuilt by the pricing migrator from top-level legacy fields
(`tierCode`, `mediaType`, `mediaDirection`, `inputType`, `outputType`, `quality`). Editing the
`conditions` array directly is not durable: the migrator restores it from `tierCode` on the next run.
Remove the top-level field, then let the migrator recompute `rateHash`.

### 5.5 Pricing identity parity between preflight and settlement

Rules:

- The pricing preflight (stage 7) and settlement (stage 9) `MUST` derive `catalog_key`, `meter`, region,
  `provider_code`, `tier_code`, and `output_type` by the same rules. A resource that passes preflight
  `MUST` be priceable at settlement.
- API-keyed resources `MUST` be resolved to the catalog model keys bound to the serving endpoints before
  pricing. An API code is not a model key and `MUST NOT` be priced as one.
- `meter` sets `MUST` come from the catalog's declaration for the model, not from the request. The
  taxonomy meter is only a default.

## 6. Group and account semantics

Rules:

- An account group `MUST` declare its model access as a blacklist and/or whitelist evaluated **before**
  account resolution, so a forbidden model fails fast with a model-forbidden error rather than a
  misleading route-unavailable one.
- A default/mixed group `MUST` be treated as a legal configuration, not as a degenerate one. It is the
  documented pooling mechanism.
- An account `MUST` declare the regions it serves. Region is not inferred from the group.
- A deployment `MUST NOT` rely on `account_group_code`/`account_code` denormalized columns for
  correctness. They are operator conveniences; the authoritative link is the id. A binding row that
  leaves them empty is legal.
- Hard-coded group or resource codes in seed or reference code `MUST NOT` be introduced. Codes are data;
  seeding one supplier's resource group into another supplier's account is a defect regardless of
  whether it currently changes behaviour.

## 7. Persistence contract

Rules:

- Runtime rates `MUST` be read from the active rate table joined to an `active` price book. A rate whose
  book is not active `MUST NOT` be considered.
- `rate_variant` `MUST` parse to a known variant. An unknown variant makes the rate undecodable and
  `MUST` fail the load loudly rather than silently dropping the rate; a silent drop removes pricing for
  a whole model family.
- `conditions` `MUST` be stored as a JSON array of `{dimension_code, operator_code, value}` and `MUST`
  round-trip through the same parse path used at load time.
- `rate_hash` `MUST` be recomputed by the catalog's migrator whenever a rate's hashed fields change. The
  hash participates in rate identity, so a stale hash can make two otherwise identical rates collide or
  a genuine pair look ambiguous.
- A generated index (`models/index.json` and its checksum) `MUST` be rebuilt whenever catalog inputs
  change. A stale index is a gate failure, not a warning.

## 8. Diagnostics and operator contract

Rules:

- An error `MUST` name the **failed stage**. Any suggested cause `MUST` be consistent with that stage.
  In particular, no pricing-stage error may suggest a credential or authentication cause.
- A pricing failure `MUST` report the pricing identity it actually used: the resolved catalog key
  candidates, the meters priced, the API code, the requested model, the selected supplier and account,
  the region, and the account group. Without these an operator cannot distinguish a catalog gap from a
  wrong-account selection from an unreachable-condition defect.
- When a pricing failure is accompanied by a dimension gap (a rate the runtime could not satisfy), the
  message `MUST` name the gap. This is what turns "no price published" into an actionable defect report.
- An operator guide `MUST` map each stage to its observable symptom and its first diagnostic step.
  Section 10 is the required minimum set.

## 9. Verification and gates

### 9.1 Dimension producer parity

- A rate condition `MUST` be satisfiable by a runtime producer for its meter and rate variant. This
  `MUST` be checked by a gate that enumerates catalog conditions and cross-references the section 5.2
  producer table.
- The gate `MUST` be error-severity. A rate that can never be selected is not a style issue.

### 9.2 Time-window/tier redundancy

- The catalog validator `MUST` reject a `time_window` rate carrying a `tier_code` condition.
- The validator `MUST` also reject a schedule-less `time_window` rate and a scheduled `standard` rate.

### 9.3 Unreachable-rate report

- The catalog `MUST` maintain a generated report of rates the runtime cannot select, distinguishing
  "dimension never populated" from variant-specific unreachability.
- The report generator `MUST NOT` treat a dimension as reachable globally when its producer is scoped to
  a meter family. Reachability `MUST` be decided per rate variant **and** meter.
- The report `MUST` be tracked by a check step in the repository contract gate, so drift fails the gate
  instead of living in a hand-committed file.

### 9.4 Duplicate pricing keys

- Two rates in one model `MUST NOT` share an effective pricing key. The key `MUST` include every field
  that makes two rates mutually exclusive: book, product, operation, side, scope, meter, media
  dimensions, tier, currency, minimum quantity, effectiveness, `rate_variant`, `schedule`, and
  `conditions`.
- `rate_variant` and `schedule` are part of the key for the same reason `conditions` is: a time-window
  rate is discriminated by *when* it applies.

### 9.5 Required gate set

| Gate | Repository | Tier |
| --- | --- | --- |
| `validate-catalog` (includes 9.2, 9.4) | `sdkwork-models` | contract |
| unreachable-rate report `--check` (9.3) | `sdkwork-models` | contract |
| pricing consistency audit | `sdkwork-models` | contract |
| pricing v2 migration idempotence | `sdkwork-models` | contract |
| generated index freshness | `sdkwork-models` | contract |
| router gate tests (4.2, 5.4, 5.5) | `sdkwork-cloudrouter` | contract |

- Every gate above `MUST` be reachable from the repository's contract-tier check aggregate.
- Lowering a baseline `MUST` be an explicit decision recorded with the change.

## 10. Operator guide

| Symptom | Failed stage | First diagnostic step |
| --- | --- | --- |
| `50201` `price_not_found`, model names a published model | 7 — pricing preflight | Read the reported pricing identity: does the selected **supplier** match the model's vendor? If not, the account pool admitted a foreign account (section 4.2). |
| `50201` `price_not_found`, supplier matches vendor | 7 | Check whether any rate for that model/meter/region is conditioned on a dimension the runtime cannot supply (section 5.2, 5.4). Run the unreachable-rate report. |
| `50201` rate `ambiguous` | 5.3 | Two rates tie on rank/specificity/priority. Inspect `schedule` and `conditions` for two rows that should be distinguished. |
| `50201` `no upstream account ... supports model` | 5 — resource gate | The group has no entitlement-eligible account. Inspect bindings and the unbound-inherit rule. |
| `ModelForbidden` | 3 — group access gate | The group's blacklist/whitelist denies the model. This is intended, not a bug. |
| Zero-priced usage records, no error | 9 — settlement parity | Preflight and settlement derived different pricing identities (section 5.5). |
| Error text suggests a credential/401 cause on a pricing failure | 8 — diagnostics | The hint is wrong. Ignore it; the chain never reached dispatch. |

Rules:

- Do not rotate an upstream API key in response to a pricing-stage error. Confirm the failed stage first.
- Do not "fix" an unreachable rate by adding a condition. Removing the unsatisfiable condition, or
  supplying a real producer, are the only two supported directions.

## 11. Compliance Checklist

- [ ] Candidates are vendor-agnostic; no code infers a vendor from account or group identity.
- [ ] Every cross-vendor pooled account either has an `account`-scope binding or the inherit-all
      behaviour is recorded as a deliberate decision.
- [ ] JSON `null` entitlements mean unrestricted; empty means empty.
- [ ] Every rate condition has a producer for its meter and rate variant.
- [ ] No `time_window` rate carries a `tier_code` condition; window codes encode the tier.
- [ ] `time_window` and `standard` rates are keyed including `rate_variant` and `schedule`.
- [ ] Preflight and settlement derive pricing identity by the same rules.
- [ ] Missing `upstream_cost` degrades; missing `official_reference` fails.
- [ ] Pricing errors never suggest a credential cause.
- [ ] The unreachable-rate report is generated, classified by reason, and gated.
- [ ] Generated index freshness and migrator idempotence are gated.
