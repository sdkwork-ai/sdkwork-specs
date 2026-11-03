# SDKWork Environment Profile Templates

These templates demonstrate the canonical environment profile contract from
`ENVIRONMENT_SPEC.md` section 5.1 and `SOURCE_CONFIG_SPEC.md`.

Use them as shape references only. An application materializer reads concrete
safe values from its own `etc/` authority and generates the framework-specific
files. Do not copy example origins, app ids, tokens, or secrets as live values.

Files:

- `sdkwork.deployment.config.example.json` - ten-profile source index.
- `topology.base.env.example` - `etc/topology/base.env` shared defaults.
- `topology.override.env.example` - `etc/topology/overrides/<profile-id>.env`
  profile delta, including `${KEY}` inheritance.
- `app.env.base.env.example` - `apps/<app>/etc/env.base.env` application-wide
  overlay.
- `topology.profile.env.example` - generated `etc/topology/<profile-id>.env`
  resolved shape; edit the layers above instead of this file.
- `vite.env.example` - PC, H5, and uni-app `.env.<profile-id>` shape.
- `flutter.dart-define.example.json` - Flutter
  `env/sdkwork.<profile-id>.json` shape.
- `mini-program.runtime-env.example.json` - native WeChat
  `config/mini-program/runtime-env.<profile-id>.json` shape.
- `native-mobile.runtime-env.example.json` - Android, iOS, and HarmonyOS
  `config/app/runtime-env.<profile-id>.json` shape.
- `database.toml.production.example` - `/etc/sdkwork/database/database.toml`
  shape for the workspace database configuration directory
  (`ENVIRONMENT_SPEC.md` section 7.3); `database.env` in the same directory is
  the env-form equivalent.

All tracked examples are public/non-secret. Private operator credentials belong
only in `~/.sdkwork/<application-code>/credentials/<profile-id>.json` or a
protected deployment secret; composed `.env.*.local` files are retired.
