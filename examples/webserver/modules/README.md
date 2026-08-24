# Imported Module Web Server Templates

Authority: `SDKWORK_WEBSERVER_SPEC.md` §2 (layout v3), `APP_RUNTIME_TOPOLOGY_NAMING.md` §9.

## Layout v3 (required)

```text
deployments/webserver/
  server.common.toml           # identity + globals (no [[http.server]])
  server.development.toml      # environment = "development"
  server.test.toml             # environment = "test"
  server.staging.toml          # environment = "staging"
  server.production.toml       # environment = "production"
  server.standalone.toml       # profile = "standalone"
  server.cloud.toml            # profile = "cloud"
```

Merge at runtime:

```text
effective(standalone.development) = merge(common, server.development.toml, server.standalone.toml)
effective(cloud.production)       = merge(common, server.production.toml, server.cloud.toml)
```

## Host naming (one file per tier)

| Environment file | Example host (`im` role) |
| --- | --- |
| `server.production.toml` | `im.sdkwork.com` |
| `server.development.toml` | `im-dev.sdkwork.com` |
| `server.test.toml` | `im-test.sdkwork.com` |
| `server.staging.toml` | `im-staging.sdkwork.com` |

Multi-base-domain modules list every registered base domain in **each** environment file.

## Align and validate

```bash
node tools/webserver/align-webserver-workspace.mjs <workspace-root>
node tools/webserver/sync-webserver-examples.mjs <workspace-root>
node tools/check-webserver-toml-standard.mjs --root deployments/webserver
```

## Templates

- [`sdkwork-cloudrouter/`](sdkwork-cloudrouter/) — multi-base-domain
- [`sdkwork-birdcoder/`](sdkwork-birdcoder/) — `code` role
- [`sdkwork-im/`](sdkwork-im/) — `im` role
