# Web Server Layout v3 Examples

Authority: `SDKWORK_WEBSERVER_SPEC.md` §2, `APP_RUNTIME_TOPOLOGY_NAMING.md` §9.

## Canonical module templates

Copy-ready full layouts (14 base domains, environment split):

- [`modules/sdkwork-im/`](modules/sdkwork-im/) — `im` role host
- [`modules/sdkwork-cloudrouter/`](modules/sdkwork-cloudrouter/) — multi-surface router
- [`modules/sdkwork-birdcoder/`](modules/sdkwork-birdcoder/) — explicit `code` role host

## Root showcase (`deployments/webserver/`)

`deployments/webserver/` mirrors `sdkwork-im` after workspace alignment — a complete,
validator-checked layout v3 tree:

```text
deployments/webserver/
  server.common.toml
  server.development.toml
  server.test.toml
  server.staging.toml
  server.production.toml
  server.standalone.toml
  server.cloud.toml
```

Flat `server.*.toml` files in this directory root are synchronized copies for quick
browsing; the authoritative path for validation is `deployments/webserver/`.

## Sync from workspace

```bash
node sdkwork-specs/tools/webserver/sync-webserver-examples.mjs <sdkwork-space-root>
```

## Adaptive nginx snippets

See [`adaptive-snippets/`](adaptive-snippets/) for optional Adaptive Web includes.
