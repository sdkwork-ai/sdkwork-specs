# SDKWork Operations Lifecycle Standard

- Version: 1.1
- Scope: the operational half of a module's software lifecycle — the stages that run **after** a release artifact exists. It standardizes the bundle release channel, logging, configuration inspection and mutation, diagnostics, backup/restore, and the retirement path for every deployable SDKWork module.
- Related: `MODULE_BIN_SPEC.md` (bin/ entrypoints and shared-library layering), `DOCKER_SPEC.md` (image/bundle layout, environment matrix, configuration drift), `DEPLOYMENT_SPEC.md` (§6 container install, rollout strategy), `RELEASE_SPEC.md` (release, rollout, rollback), `OBSERVABILITY_SPEC.md` (log fields, metrics, traces, redaction), `CONFIG_SPEC.md` (configuration sources and precedence), `HEALTH_CHECK_SPEC.md` (probe contracts), `MIGRATION_SPEC.md` (forward-only migrations), `DATABASE_SPEC.md` (backup/restore data rules), `RUNTIME_DIRECTORY_SPEC.md` (on-disk log and state paths), `APPLICATION_DEPLOY_LAYOUT_SPEC.md` (`/opt/deploy/<module>/…`)
- Normative keywords: `MUST`, `MUST NOT`, `SHOULD` follow `AGENTS_SPEC.md`.

## 1. Lifecycle Stage Model

A commercial release train is not "build then deploy". Every module `MUST`
support the full stage model below, and every stage `MUST` be reachable from
the module `bin/` entrypoints without reading module-specific scripts.

| # | Stage | Question it answers | `bin/` entrypoint | Target-side executor |
|---|-------|---------------------|-------------------|----------------------|
| 1 | **Build** | Is the source compilable? | `apps-build.sh` | repo toolchain |
| 2 | **Package** | Is there an immutable, checksummed artifact? | `apps-package.sh`, `docker-image.sh build` | repo packager |
| 3 | **Release** | Which version is approved, and what changed? | `docker-image.sh push`, gateway `release.sh` | registry |
| 4 | **Deploy** | Is the approved version running? | `docker-deploy.sh install\|upgrade` | bundle `deploy.sh` |
| 5 | **Verify** | Is it healthy and serving traffic? | `docker-deploy.sh status`, `HEALTH_CHECK_SPEC.md` probes | health probes |
| 6 | **Observe** | What is it doing right now? | `docker-deploy.sh logs`, `doctor.sh` | docker compose / runtime |
| 7 | **Configure** | What does it think its config is? | `config.sh show\|get\|set\|diff\|validate` | env files |
| 8 | **Recover** | Can we get back to a known-good state? | `docker-deploy.sh rollback`, `backup.sh restore` | `release.sh` / backup set |
| 9 | **Retire** | Can we remove it cleanly? | `docker-deploy.sh down [--purge]` | bundle `deploy.sh` |

### 1.1 Stage Rules

- **2 → 4 monotonicity**: a deploy `MUST` consume an artifact produced by
  stage 2 or 3. Deploying straight from a working tree is forbidden for
  `test`, `staging`, `demo`, and `production`.
- **5 is a gate, not a report**: `install` and `upgrade` `MUST NOT` report
  success until the health gate passes (`HEALTH_CHECK_SPEC.md`). A failed gate
  `MUST` leave the previous version serving or, for a first install, leave an
  explicit "not healthy" state with the failing probe in the output.
- **6 and 7 are read-mostly**: `logs`, `doctor`, `config show|get|diff|validate`
  are read-only and `MUST NOT` require `--yes`. Only `config set` and `config
  edit` mutate, and they `MUST` create a timestamped backup of the file they
  change.
- **8 has two independent paths** and both `MUST` exist:
  - *version rollback* (`docker-deploy.sh rollback` → bundle `release.sh rollback`) — back to a previously released image version via the §1.2 release channel;
  - *data restore* (`backup.sh restore`) — back to a previously captured data state.
  A version rollback does **not** undo a forward-only migration
  (`MIGRATION_SPEC.md`); when the previous version is incompatible with the
  current schema the only supported recovery is data restore.

### 1.2 Release Channel Standard (bundle `release.sh`)

Every deployable module `MUST` ship a bundle-owned `release.sh` next to
`deploy.sh`. It is the commercial release train contract and wraps `deploy.sh`
with a versioned lifecycle:

| Action | Semantics |
|--------|-----------|
| `deploy` | upgrade the environment to an image version, gated by an HTTP health probe; automatic rollback to the previous version when the gate fails |
| `rollback` | go back to the previous successful version (or `--to <version>`) |
| `status` | deployed version, the image digest the containers actually run, and a live health probe of every instance |
| `history` | append-only release ledger (`release-state/<env>/ledger.jsonl`) |
| `versions` | image tags available on the target |
| `verify` | health-probe every instance only (no changes) |

Mandatory semantics (aligned with Helm/Argo Rollouts vocabulary):

- **Health gate**: `deploy` and `rollback` `MUST NOT` report success until
  every instance probes healthy (`HEALTH_CHECK_SPEC.md`); `--health-timeout`
  bounds the budget per attempt set.
- **Automatic rollback**: a failed gate `MUST` roll the environment back to
  the previous version unless `--no-auto-rollback` is explicit.
- **Append-only ledger**: every mutating action appends one JSON line
  (action, environment, from/to version, image digest, timestamp, result) to
  `release-state/<env>/ledger.jsonl`. The ledger is audit evidence
  (`RELEASE_SPEC.md` §4) and `MUST NOT` be rewritten.
- **Release lock**: mutating actions `MUST` run under a per-environment lock;
  concurrent releases fail fast instead of interleaving.
- **Digest identity**: `status` and the ledger record the registry digest,
  not just the mutable tag (`RELEASE_SPEC.md` §4.1).

The bin/ `rollback` action calls `release.sh rollback` on the target. An
idempotent re-install of the current bundle is **not** a rollback and is only
permitted as a transitional exception for modules with a recorded conformance
waiver; the shared entrypoint emits a warning when it has to fall back.
- **9 is reversible until `--purge`**: `down` removes containers and network
  attachments; `--purge` additionally removes volumes and `MUST` be gated
  (`MODULE_BIN_SPEC.md` §4.2) and `MUST` be preceded by a backup in
  `staging`, `demo`, and `production`.

## 2. Logging Standard

### 2.1 Levels

The runtime `MUST` emit exactly these levels, and the level `MUST` be a
machine-readable field, not an inferred substring:

| Level | Meaning | Operator action |
|-------|---------|-----------------|
| `ERROR` | A request or background task failed; the process continues | Page during business hours; always captured in an incident |
| `WARN` | Degraded but serving (retry succeeded, fallback used, drift detected) | Ticket; review in the next triage |
| `INFO` | Lifecycle and request-completion events (start, ready, config loaded, migration applied) | Baseline retention |
| `DEBUG` | Diagnostic detail | Enabled only by explicit config; never default-on in `production` |
| `TRACE` | Per-frame/per-packet detail | `MUST NOT` be enabled in `production` |

Default minimum level by environment:

| Environment | Default level | `DEBUG` allowed |
|-------------|---------------|-----------------|
| `development` | `DEBUG` | yes |
| `test` | `DEBUG` | yes |
| `staging` | `INFO` | yes (time-boxed) |
| `demo` | `INFO` | yes (time-boxed) |
| `production` | `INFO` | only with a change record and an expiry |

### 2.2 Structure And Fields

Structured logging is authoritative in `OBSERVABILITY_SPEC.md` §2. Operations
adds the transport rules:

- Every log line `MUST` carry `timestamp` (RFC 3339, UTC), `level`, `message`,
  `service`, `environment`, and `instance`.
- Container workloads `MUST` emit to `stdout`/`stderr` only. Writing service
  logs into the container filesystem is forbidden: those bytes die with the
  container and are invisible to `docker compose logs`.
- Redaction is enforced at emission (`OBSERVABILITY_SPEC.md` §2 redaction
  list) **and** again by `config.sh show` / `doctor.sh`, which `MUST NOT`
  print secret values (§3.4).

### 2.3 Retention, Rotation, And On-Disk Layout

| Concern | Rule |
|---------|------|
| Driver | `json-file` is the baseline driver for compose-managed containers. `local` is preferred where the Docker version supports it. |
| Rotation | `max-size: 50m`, `max-file: 3` per container, declared in the compose file — **not** left to daemon defaults. A compose file that starts a service and declares no `logging:` block is non-conformant. |
| Retention (hot) | `development`/`test` 3 files × 50 MB; `staging`/`demo` 7 days; `production` 14 days hot. |
| Retention (cold) | `production` `MUST` ship logs off-host (log shipper or `journald` + central store) before the hot window expires. |
| On-disk path | Container logs live under the Docker root (`/var/lib/docker/containers/<id>/…`) and are reachable **only** through `docker compose logs`; operators `MUST NOT` be instructed to read that path directly. Host-native services follow `RUNTIME_DIRECTORY_SPEC.md`. |
| Export | `bin/docker-deploy.sh logs --export <dir>` writes a timestamped, gzipped capture for ticket attachment. Exports inherit redaction and `MUST` be treated as secret-adjacent material. |

### 2.4 Log CLI Contract

`bin/docker-deploy.sh logs` `MUST` support the following, and every flag
`MUST` be forwarded to the bundle `deploy.sh` rather than reimplemented:

```text
--environment <env>        required
--instance <N>             instance index (default 1)
--service <name>           compose service (default: the module's primary service)
--tail <N|all>             lines from the end (default 200)
--since <duration|RFC3339> starting point (e.g. 15m, 2026-09-05T10:00:00Z)
--follow                   stream (default off; opt in, so scripts never hang)
--export <dir>             write a timestamped capture instead of printing to stdout
--host <wsl|ssh://…>       target (default wsl)
--dry-run
```

Rationale for `--follow` defaulting off: an operator running `logs` from a
ticket or an agent loop must get a bounded, greppable result. Streaming is an
explicit choice.

## 3. Configuration Management Standard

### 3.1 Sources And Precedence

`CONFIG_SPEC.md` §6 owns the general precedence chain. For a container
deployment the effective configuration of an instance is:

```text
compose defaults
  < bundle env/<environment>.env
    < bundle env/<environment>.i<N>.env      (per-instance override)
      < process environment exported by deploy.sh (per-instance ports, node id)
```

`config.sh` `MUST` render exactly this chain, in order, and `MUST` mark which
layer supplied each key.

### 3.2 Actions

| Action | Semantics | Mutates |
|--------|-----------|---------|
| `list` | files in the resolution chain for an environment | no |
| `show` | every effective key/value, secrets redacted | no |
| `get <KEY>` | one effective value, secret redacted unless `--reveal` | no |
| `set <KEY> <VALUE>` | write into the environment env file (idempotent; replaces an existing key, appends otherwise) | **yes** |
| `diff` | compare `<environment>.env` against `<environment>.env.example`; flag missing keys, extra keys, and placeholder values | no |
| `validate` | run the module's configuration validator (`scripts/docker/validate-docker-deployment.mjs` for the webserver) | no |
| `edit` | open `$EDITOR` on the environment env file | **yes** |

### 3.3 Mutation Rules

- `set` and `edit` `MUST` write a timestamped backup next to the target file
  (`.bak.<UTC-timestamp>`) before modifying it.
- `set` `MUST` run `validate` afterwards and `MUST` restore the backup and
  exit non-zero when validation fails.
- `set` on a `production` environment `MUST` require `--yes`
  (`MODULE_BIN_SPEC.md` §3).
- `config.sh` `MUST NOT` invent keys: `set` on a key absent from the example
  file emits a warning and still writes (forward compatibility), but `diff`
  `MUST` surface it as a drift item.

### 3.4 Secret Handling

- A key is secret when its name matches `SECRET|PASSWORD|PASSWD|TOKEN|KEY|PRIVATE|CERT|DSN|URL.*CREDENTIAL` and it is not one of the documented non-secret exceptions (`PUBLIC_KEY` in a JWKS context, `SDKWORK_WEBSERVER_PRIMARY_DOMAIN`, …). The pattern `MUST` be declared once in the shared library and `MUST NOT` be duplicated per module.
- `show`/`get`/`export` `MUST` print `***REDACTED***` for secret keys.
- `--reveal` bypasses redaction, `MUST` be rejected in `production`, and
  `MUST` write an evidence line naming the key (never the value).
- Placeholder detection: a value equal to `<CHANGE_ME>` or empty `MUST` be
  reported by `diff` and `validate` as a blocking item for `staging`, `demo`,
  and `production`.

## 4. Diagnostics Standard (`doctor.sh`)

### 4.1 Contract

`bin/doctor.sh` runs **against a target environment** (unlike the local
`… doctor` self-check of `MODULE_BIN_SPEC.md` §3) and produces one aggregated
report. It `MUST` be read-only, `MUST NOT` require `--yes`, and `MUST` exit
non-zero when any check is `FAIL`.

### 4.2 Minimum Check Set

| Check | Implementation | FAIL condition |
|-------|----------------|----------------|
| `toolchain` | `docker`, `docker compose version` on the target | missing |
| `bundle` | deployed bundle present at `/opt/deploy/<module>/bundle` | missing |
| `compose` | `docker compose … ps` for each instance | any instance absent |
| `health` | container `.State.Health.Status` + `/healthz` | not `healthy` |
| `ports` | the environment's host ports are bound and reachable | unbound or refused |
| `config` | `config.sh diff` + `validate` | drift or placeholder secrets |
| `logs` | last N lines, `ERROR`/`panic` frequency | error rate above threshold |
| `resources` | disk free on the Docker root, container restart count | below floor / restart loop |
| `image` | running image ref matches the expected tag | mismatch (drift) |

### 4.3 Output

- One line per check: `PASS|WARN|FAIL  <check>  <detail>`.
- A trailing `summary: N passed, M warned, K failed` plus, when K > 0, the
  exact next command for each failure.
- `--json` emits the same report machine-readably for dashboards.
- `--export <dir>` writes the report together with a log capture and `docker
  inspect` output, i.e. a complete incident attachment.

## 5. Backup And Restore Standard

### 5.1 Backup Set

A backup set `MUST` contain everything needed to rebuild the environment's
state:

1. **configuration** — the full env resolution chain for the environment;
2. **database** — a logical dump (`pg_dump` custom format) of every
   module-owned database in the environment;
3. **volumes** — named Docker volumes that hold non-database state
   (`secrets`, `data`, `gateway-data`, …) as tar archives;
4. **manifest** — `manifest.json` with module id, environment, image tag,
   timestamp, per-component checksums, and the tool versions used.

### 5.2 Rules

| Rule | Requirement |
|------|-------------|
| Naming | `<module>-<environment>-<UTC timestamp>-<kind>.<ext>` in `/opt/deploy/<module>/backups` |
| Checksum | every component carries a sidecar `.sha256`; `verify` `MUST` recompute and compare |
| Immutability | a backup is written once and never rewritten; rotation deletes whole sets only |
| RPO | `production` 24 h (daily) + a pre-deploy backup on every `upgrade`; `staging`/`demo` best effort; `test`/`development` on demand |
| RTO | `production` restore `MUST` complete within 4 h; the restore procedure `MUST` be exercised by a drill at least quarterly |
| Encryption | backups containing secrets `MUST` be encrypted at rest (age/gpg) or stored on an encrypted volume; the manifest records the scheme |
| Pre-change | `docker-deploy.sh upgrade` and `down --purge` on `staging`/`demo`/`production` `MUST` capture a pre-change backup, or `MUST` require `--skip-backup` with an evidence line |
| Restore | `restore` is destructive: it `MUST` require `--yes`, `MUST` print the target set it will overwrite, and `MUST` stop the stack first |
| Drill | `backup.sh verify` is a checksum/restore-syntax check; the quarterly drill is a real restore into a scratch environment |

### 5.3 Retention

| Environment | Generations kept |
|-------------|------------------|
| `development` | 3 |
| `test` | 3 |
| `staging` | 7 |
| `demo` | 7 |
| `production` | 30 daily + the last pre-deploy backup of every release |

## 6. Alerting And SLO Baseline

Operations tooling does not install a monitoring stack, but it `MUST` expose
the signals one needs. Every module `MUST` expose:

- `/healthz`, `/readyz`, `/livez`, `/metrics` per `HEALTH_CHECK_SPEC.md`;
- a non-zero container restart count visible from `doctor.sh`;
- log-derived error-rate from `doctor.sh logs`.

Baseline alert rules (thresholds are starting values, tuned per module):

| Signal | Warn | Page |
|--------|------|------|
| readiness failing | > 2 min | > 5 min |
| HTTP 5xx ratio | > 1 % / 5 min | > 5 % / 5 min |
| p99 latency | > 2× baseline | > 4× baseline |
| container restarts | ≥ 2 in 15 min | ≥ 5 in 15 min |
| disk free on Docker root | < 20 % | < 10 % |
| config drift | any | any in `production` |
| backup age | > 26 h (`production`) | > 48 h |

## 7. Runbook Requirement

Every deployable module `MUST` ship, under `docs/runbooks/`:

1. `deploy.md` — install/upgrade/rollback per environment;
2. `troubleshooting.md` — symptom → `doctor.sh` check → fix;
3. `backup-restore.md` — capture, verify, restore, drill;
4. `log-reference.md` — what a healthy startup log looks like, and the
   signature of each known failure mode.

Each runbook `MUST` be copy-paste runnable (no placeholders that require the
reader to invent a value) and `MUST` be published in Chinese and English
(`DOCUMENTATION_SPEC.md`).

### 7.1 Generated versus hand-authored runbooks

Runbooks generated by `tools/scaffold-module-runbooks.mjs` carry the marker
`<!-- generated: scaffold-module-runbooks.mjs -->`. A runbook without the
marker is hand-authored: the generator `MUST NOT` overwrite it (`--force`
refreshes generated files only; overriding requires the explicit
`--force-hand-authored` flag). Modules that maintain bespoke runbooks (the
platform plane with container bundles) keep their own content and navigation.

### 7.2 Delivery posture is stated, not implied

A module's standalone/cloud delivery kinds (`deployments/deploy.yaml`) decide
whether the bundle container-install path applies. Generated runbooks `MUST`
state the posture:

- standalone delivery `container-image` → the bundle path in §1/§2 is
  executable, and a missing `deployments/docker/bundle/` is a real gap;
- standalone delivery `host-package` → §1/§2 describe the container path as
  applicable only when the module opts into a standalone container install;
  the host-package path is `bin/apps-package.sh` + `bin/apps-pkg-installer.sh`,
  and the cloud plane consumes `bin/docker-image.sh push` images through
  kubernetes;
- modules that ship no standalone server binary (assembly-only) state that the
  image build hook is not applicable and fail closed.

## 8. Conformance Checklist

Automated audit: `node ../sdkwork-specs/tools/check-operations-conformance.mjs`
covers the structural items below (bin/ entry set, bootstrap ordering, module
wiring hooks, bundle entrypoint and release channel, compose log rotation, env
examples, runbooks, shared-primitive isolation, single operator channel). Run it
in CI and on every `bin/`, compose, or bundle change; a `FAIL` blocks the
release train.

Two invocation modes:

- `--root <module-root>` audits one module — the mode a module's own CI job
  uses;
- `--workspace <workspace-root>` audits the whole fleet in a single pass — the
  class-level regression to run while the standard is being rolled out, and the
  mode that catches a module which was never onboarded at all.

A *module* is a repository that follows the fleet repo-name convention
(`sdkwork-*`) and ships `sdkwork.app.config.json` at its root. Repositories with
no manifest are not modules, and manifest-carrying repositories outside the
`sdkwork-*` convention are standalone product repos — the platform's own repo
discovery (`tools/application-deploy-layout/discover.mjs`) filters on the same
prefix, and the operations lifecycle standard governs neither class. Both are
reported as skipped *with the reason and the repository name* rather than failed
or silently dropped; `--include-off-fleet` audits the off-convention repos
anyway for a manual decision.

Each item reports `PASS`, `WARN`, `FAIL`, or `N/A`. `N/A` carries the reason it
does not apply (for example "standalone delivery is `host-package`, so the
container install path is out of scope") and never affects the exit code: a
check that cannot apply must state why, not fail.

- [ ] All nine lifecycle stages are reachable from `bin/` without reading module scripts.
- [ ] The bundle ships `release.sh` implementing §1.2 (health gate, auto-rollback, ledger, lock, digest identity) — or the module's standalone delivery is not a container install and the item reports `N/A` with that posture.
- [ ] Every compose file that starts a service declares `logging:` with rotation (vendored third-party stacks under `external/` are out of scope).
- [ ] `bin/config.sh` supports `list|show|get|set|diff|validate|edit`, redacts secrets, and backs up before mutating.
- [ ] `bin/doctor.sh` implements the §4.2 check set, is read-only, and exits non-zero on `FAIL`.
- [ ] `bin/backup.sh` supports `create|list|verify|restore`, emits checksums, and gates restore behind `--yes`.
- [ ] `docker-deploy.sh logs` supports `--tail|--since|--follow|--service|--instance|--export`.
- [ ] `upgrade` on `staging`/`demo`/`production` captures a pre-change backup or requires `--skip-backup` with an evidence line.
- [ ] `docker-image.sh push` records the pushed digest in the evidence log.
- [ ] `docs/runbooks/` contains the four §7 documents in both languages.
- [ ] No module wrapper duplicates a shared primitive (no `ssh`/`scp`, `sha256sum`, `tar -c`, or docker transport verbs outside the shared library).
- [ ] **Single operator channel** (`MODULE_BIN_SPEC.md` §1): no `package.json`
  script invokes a bundle executor (`deploy.sh`/`release.sh`) or a
  `remote-deploy` helper directly, and no operator-facing documentation
  presents direct executor invocation as an operator path — `bin/` is the
  only deploy surface (audited by `check-operations-conformance.mjs`).
- [ ] The `--workspace` regression is green for the fleet: zero `FAIL`, and every `N/A` names the delivery posture that puts the item out of scope.
