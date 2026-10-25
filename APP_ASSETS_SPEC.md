# SDKWork App Assets Standard v1

- Version: 1.0
- Scope: application asset root, media roles, per-`appType` media matrix, creation-time screenshot capture, cover and preview composition, store submission media profiles, SDKWork appstore projection, validation
- Related: `APP_MANIFEST_SPEC.md`, `MEDIA_RESOURCE_SPEC.md`, `DRIVE_SPEC.md`, `SDKWORK_WORKSPACE_SPEC.md`, `APP_CLIENT_ARCHITECTURE_ALIGNMENT_SPEC.md`, `APP_PC_ARCHITECTURE_SPEC.md`, `APP_H5_ARCHITECTURE_SPEC.md`, `FLUTTER_APP_MOBILE_ARCHITECTURE_SPEC.md`, `MINI_PROGRAM_APP_ARCHITECTURE_SPEC.md`, `ANDROID_APP_MOBILE_ARCHITECTURE_SPEC.md`, `IOS_APP_MOBILE_ARCHITECTURE_SPEC.md`, `HARMONY_APP_MOBILE_ARCHITECTURE_SPEC.md`, `UNIAPP_APP_ARCHITECTURE_SPEC.md`, `UNITY_APP_ARCHITECTURE_SPEC.md`, `APP_STATIC_WEB_ARCHITECTURE_SPEC.md`, `PRIVACY_SPEC.md`, `SECURITY_SPEC.md`, `I18N_SPEC.md`, `NAMING_SPEC.md`, `TEST_SPEC.md`

Every registered application owns one governed asset root. Product media is not an afterthought of a release script and it is not a set of loose files next to a build output: it is versioned source that is reviewed together with the code that renders it, captured from a reproducible application state, validated against the delivery channel, and only then published to Drive and projected into the SDKWork appstore.

This standard defines the asset root, the media role vocabulary, the required media for every application type, the capture contract used when an application is created, cover and preview composition rules, and the store submission profiles that gate published media. `APP_MANIFEST_SPEC.md` owns the manifest shape and field projection; this standard owns what the media means, where its source bytes live, and how they become listable.

## 1. Authority And Scope

Sources of truth:

| Fact | Authority |
| --- | --- |
| Source bytes and capture configuration | `<app-root>/assets/` as defined by this standard |
| Catalog metadata (role, platform, locale, dimensions, source path) | `agent.app.config.json#media` per `APP_MANIFEST_SPEC.md` |
| Published bytes, upload sessions, grants | `DRIVE_SPEC.md` through Drive Uploader |
| API representation of app media | `MEDIA_RESOURCE_SPEC.md` (`MediaResource`) |
| Store numeric constraints | [`schemas/sdkwork.app-assets.profiles.v1.json`](schemas/sdkwork.app-assets.profiles.v1.json) |
| Capture configuration shape | [`schemas/sdkwork.app-assets.capture.schema.v1.json`](schemas/sdkwork.app-assets.capture.schema.v1.json) |
| Capture report shape | [`schemas/sdkwork.app-assets.capture-report.schema.v1.json`](schemas/sdkwork.app-assets.capture-report.schema.v1.json) |
| `platform_app` projection and appstore rendering | Section 9 |

Rules:

- This standard applies to every application root that owns an `agent.app.config.json`, regardless of `app.appType`, `runtime.family`, or delivery channel.
- Every application root `MUST` have `<app-root>/assets/` with `assets/README.md`, including server-only, SDK, and content applications. Roles that do not apply are declared empty or omitted by the per-type matrix; the directory itself is never optional. A legacy application (section 11) creates the asset root as the first step of migration, before it claims the marker or a vendor store lane.
- `agent.app.config.json#media` is the only catalog. Do not add a second media catalog file, a checked-in `assets/media.json`, or per-store duplicate metadata whose facts are already in the manifest.
- The store profile catalog is machine authority for numeric store constraints. This standard contains a summary; a conflict between the summary and the catalog is resolved by the catalog, and the catalog `sourceUrl`/`verifiedAt` fields record why the value is trusted.
- A new application created after this standard is effective `MUST` declare `media.metadata.standard = "sdkwork-app-assets.v1"`. An existing application adopts it by adding the same marker after its asset migration (section 11). The validator enforces the full standard for every application that declares the marker.
- An application that publishes to a vendor store `MUST` satisfy that store's submission profile whether or not it declares the marker. Store submission is a hard boundary: incomplete or unverifiable store media is not published.
- This standard does not replace `APP_MANIFEST_SPEC.md` field rules, `PRIVACY_SPEC.md` classification, or `SECURITY_SPEC.md` secret rules. Where they intersect, the stricter rule wins.

## 2. Asset Roles

Every media entry declares one role through `type`. Roles are not interchangeable: a screenshot is evidence of the running application, a cover is catalog art, and a preview video is a timed demonstration.

| Role (`type`) | Definition | Manifest container | Required for |
| --- | --- | --- | --- |
| `ICON` | Square application identity | `media.icons.primary`, `media.icons.platform[]` | Every catalog-listed application |
| `COVER` | Catalog hero image (16:9 master) for cards, detail headers, and download pages | `media.previews[]` | Every catalog-listed application |
| `SCREENSHOT` | Unmodified capture of the running application UI | `media.screenshots[]` | Every UI-bearing delivery surface |
| `PREVIEW_IMAGE` | Composed marketing or content preview image, including PPT slide previews | `media.previews[]` | PPT applications; optional elsewhere |
| `PREVIEW_VIDEO` | Timed application or content preview | `media.previews[]` | VIDEO applications; store profiles that require it |
| `FEATURE_GRAPHIC` | Google Play feature graphic derivative | `media.previews[]` | Google Play submission |
| `POSTER` | Primary content poster for video and poster applications, kept at the content's own aspect ratio | `media.previews[]` | VIDEO and POSTER applications |

Standard `purpose` values:

```text
PRIMARY, CATALOG_COVER, CATALOG_SCREENSHOT, CATALOG_PREVIEW, STORE_LISTING,
STORE_SUBMISSION, STORE_APP_PREVIEW, SLIDE_PREVIEW, CONTENT_POSTER,
CONTENT_TRAILER, FEATURE_GRAPHIC, DOCS_PREVIEW
```

`CATALOG_PREVIEW` and `STORE_APP_PREVIEW` are retained for assets authored before this standard; new assets use `CATALOG_COVER`, `CATALOG_SCREENSHOT`, `STORE_SUBMISSION`, or `DOCS_PREVIEW`.

Purpose is not free text and must fit the role: `ICON` uses `PRIMARY` or `STORE_LISTING`; `COVER` uses `CATALOG_COVER`; `SCREENSHOT` uses `CATALOG_SCREENSHOT` or `STORE_SUBMISSION`; `PREVIEW_IMAGE` uses `SLIDE_PREVIEW`, `DOCS_PREVIEW`, or `STORE_LISTING`; `PREVIEW_VIDEO` uses `CONTENT_TRAILER`, `STORE_SUBMISSION`, or `STORE_LISTING`; `FEATURE_GRAPHIC` uses `FEATURE_GRAPHIC`; `POSTER` uses `CONTENT_POSTER` or `STORE_LISTING`.

Rules:

- `media.icons.primary` `MUST` be `type = ICON` and `purpose = PRIMARY`. It projects to `platform_app.iconUrl`.
- Exactly one enabled `COVER` per locale and theme is required for a catalog-ready application. Store-specific graphics do not replace the cover.
- A `SCREENSHOT` `MUST` show the actual application. A marketing banner, a gradient placeholder, a mock device shell without application UI, or a hand-drawn illustration is not a screenshot; use `PREVIEW_IMAGE` instead and label it honestly.
- A `PREVIEW_VIDEO` `MUST` reference a poster through `metadata.posterAssetId` so list surfaces can render before playback.
- `FEATURE_GRAPHIC` is a store derivative, not a second cover. It `MUST` be derived from the same key visual as the cover.
- `POSTER` and `COVER` `MAY` share pixel content, but they remain separate entries because they have different aspect ratios, constraints, and consumers.

### 2.1 Asset Source Identity

Every enabled media asset `MUST` declare at least one source:

| Field | Meaning | Rules |
| --- | --- | --- |
| `path` | Repository-relative path under `assets/` | Required for committed source bytes when the marker is declared. Must resolve inside `assets/`; no symlinks, no `..`, no absolute path |
| `driveUri` | Stable Drive reference for uploaded source bytes | Required once the asset is uploaded through Drive when no checked-in `path` exists |
| `resource` | `MediaResource` snapshot for SDKWork-owned bytes | Allowed instead of or alongside `driveUri`; follows `MEDIA_RESOURCE_SPEC.md` |
| `url` | Public delivery URL | Projection or external marketplace URL. `url` alone is allowed only with `external: true` |
| `external` | Boolean | `true` only for media owned and hosted by a third party (for example a YouTube preview or an App Store Connect-only asset) |

Rules:

- Checked-in `path` is the preferred source for icons, covers, screenshots, posters, and composed previews. A release upload writes `driveUri`/`resource` and keeps `path` as the source provenance.
- `url` alone `MUST NOT` satisfy the marker standard. `url` plus `external: false` without `path` or `driveUri`/`resource` is invalid for SDKWork-owned media.
- `driveUri` and `resource` `MUST` identify the same bytes as `path` after upload; a validator or release preflight `MUST` fail when dimensions, format, or file size disagree.
- Media entries `MUST NOT` contain environment URLs, signed URL queries with credentials, tokens, or bucket internals in `path`, `metadata`, or filenames.

### 2.2 Placeholders

A placeholder is permitted only while the application is a draft:

- The asset `MUST` set `metadata.placeholder = true` and `enabled = true` only when `publish.status` is `DRAFT` or `INACTIVE`.
- A catalog-listed or store-submitted application `MUST NOT` carry any enabled placeholder media.
- Generated placeholder gradients, solid-color images, stock mockups, and "coming soon" covers are not listable. The appstore `MUST` show an explicit empty state instead of inventing imagery.
- Removing a placeholder requires a real asset. Disabling the entry is acceptable only while the application is not listed; a catalog-ready application cannot satisfy the matrix by hiding incomplete media.

## 3. Asset Root Layout

Canonical layout:

```text
<app-root>/assets/
  README.md
  .gitignore
  resources/
    <runtime or content resources>
  media/
    icons/
      icon-1024.png
      <platform>-<size>.png
    covers/
      <locale>/cover-1920x1080.png
    screenshots/
      <platform>/<display-type>/<locale>/<nn>-<slug>.png
    previews/
      <platform>/<display-type>/<locale>/<nn>-<slug>.png
      video/<locale>/<slug>.mp4
    store/
      <store>/
        icon-<size>.png
        feature-graphic-1024x500.png
        screenshots/<display-type>/<locale>/<nn>-<slug>.png
        previews/<display-type>/<locale>/<nn>-<slug>.mp4
  capture/
    capture.config.json
  source/
    <optional editable design masters>
```

Directory responsibilities:

| Directory | Responsibility | Bundled into the application artifact? |
| --- | --- | --- |
| `resources/` | Runtime images, illustrations, content masters and rendered content resources that the application or its listing serves | Yes, when the owning package imports/copies them |
| `media/` | Catalog and store media source files | No |
| `media/store/` | Store-specific derivatives and submissions | No |
| `capture/` | Capture configuration and capture-supplied evidence metadata | No |
| `source/` | Editable design masters (Figma exports, layered files, deck sources) | No |

Rules:

- `assets/README.md` `MUST` name the asset owner, the source-of-truth flow (design source to `media/` to Drive), the license/rights basis for photography and illustration, the capture command, and the update procedure. It `MUST NOT` restate this whole standard.
- `assets/.gitignore` `MUST` ignore capture raw output (`capture/raw/`), temporary renders, and OS metadata files. It `MUST NOT` ignore any path referenced by an enabled manifest entry.
- `assets/resources/` `MUST` exist. The per-type matrix in section 5 lists the subdirectories a type owns; an empty directory carries a tracked `.gitkeep` or `README.md`.
- `assets/media/` `MUST NOT` be imported by application source, packaged into a client bundle, or served from the application origin. Catalog media is delivered through Drive/CDN URLs.
- `assets/source/` `MAY` use Git LFS. A source master that cannot be checked in `MUST` be referenced in the `assets/README.md` with its owner and retention location; it `MUST NOT` be silently absent.
- No generated thumbnails, `.DS_Store`, `Thumbs.db`, editor swap files, or duplicate exports live under `assets/`.
- Capture raw output is working state. It belongs under `assets/capture/raw/` (ignored) or `.sdkwork/tmp/`, never in `media/`.

Path naming:

- Path segments are lowercase kebab-case except BCP 47 locale segments (`en-US`, `zh-CN`, `pt-BR`).
- Screenshot and preview order uses a two-digit prefix (`01-home.png`) matching `sortOrder`.
- Platform segments use lowercase backend platform tokens (`web`, `h5`, `app-ios`, `app-android`, `app-harmony`, `desktop-windows`).
- Display segments use lowercase display tokens (`iphone-6-9`, `desktop-16-9`, `android-phone`).
- File extensions are lowercase and match `format`: `png`, `jpg`, `jpeg`, `webp`, `mp4`, `mov`, `m4v`.
- A path `MUST` resolve under `<app-root>/assets/` after normalization. Absolute paths, Windows drive prefixes, backslashes, `..`, empty segments, and symlinks are forbidden.

Size and format limits for committed source media:

| Role | Max source size | Accepted source formats |
| --- | --- | --- |
| `ICON` | 2 MiB | PNG |
| `COVER` | 5 MiB | PNG, WEBP |
| `SCREENSHOT` | 20 MiB | PNG, JPG/JPEG, WEBP |
| `PREVIEW_IMAGE` | 20 MiB | PNG, JPG/JPEG, WEBP |
| `FEATURE_GRAPHIC` | 5 MiB | PNG, JPG/JPEG |
| `POSTER` | 20 MiB | PNG, JPG/JPEG, WEBP |
| `PREVIEW_VIDEO` | 500 MiB | MP4, MOV, M4V |

A store profile `MAY` narrow further; the narrower limit wins.

## 4. Manifest Binding

Media shape (field authority for projection remains `APP_MANIFEST_SPEC.md` section 7):

```json
{
  "media": {
    "metadata": {
      "standard": "sdkwork-app-assets.v1",
      "defaultLocale": "en-US",
      "assetVersion": "1.0.0"
    },
    "icons": {
      "primary": {
        "id": "sdkwork-drive-icon-primary",
        "type": "ICON",
        "purpose": "PRIMARY",
        "path": "assets/media/icons/icon-1024.png",
        "width": 1024,
        "height": 1024,
        "format": "PNG",
        "fileSizeBytes": 184320,
        "alphaChannel": false,
        "locale": "en-US",
        "enabled": true
      },
      "platform": []
    },
    "screenshots": [
      {
        "id": "sdkwork-drive-web-home-01",
        "type": "SCREENSHOT",
        "purpose": "CATALOG_SCREENSHOT",
        "path": "assets/media/screenshots/web/desktop-16-9/en-US/01-home.png",
        "platform": "WEB",
        "deviceClass": "BROWSER",
        "displayType": "DESKTOP_16_9",
        "locale": "en-US",
        "width": 1920,
        "height": 1080,
        "format": "PNG",
        "fileSizeBytes": 512000,
        "alphaChannel": false,
        "caption": "Files and shared drives",
        "sortOrder": 0,
        "enabled": true,
        "metadata": {
          "altText": "Drive home screen with recent files and shared drives",
          "capture": {
            "tool": "playwright",
            "version": "1.55.0",
            "appVersion": "3.2.0",
            "commit": "4f6c2a1",
            "capturedAt": "2026-10-20T09:30:00Z",
            "locale": "en-US",
            "displayType": "DESKTOP_16_9"
          }
        }
      }
    ],
    "previews": [
      {
        "id": "sdkwork-drive-cover-en-us",
        "type": "COVER",
        "purpose": "CATALOG_COVER",
        "path": "assets/media/covers/en-US/cover-1920x1080.png",
        "platform": "WEB",
        "locale": "en-US",
        "width": 1920,
        "height": 1080,
        "format": "PNG",
        "fileSizeBytes": 980000,
        "alphaChannel": false,
        "sortOrder": 0,
        "enabled": true,
        "metadata": {
          "altText": "Drive catalog cover showing the file workspace",
          "theme": "light",
          "focalPoint": { "x": 0.5, "y": 0.45 },
          "cropAnchor": "center"
        }
      }
    ]
  }
}
```

Field rules:

| Field | Rule |
| --- | --- |
| `id` | Immutable, unique across the manifest, lower kebab-case. Recommended shape `<app-key>-<role>-<discriminator>` |
| `type` | One of the roles in section 2 |
| `purpose` | One of the standard purposes; free text is not canonical |
| `platform` | Backend `PlusPlatform` value for the surface the asset represents |
| `storePlatform` | `APPLE_APP_STORE`, `GOOGLE_PLAY`, `HUAWEI_APPGALLERY`, `MICROSOFT_STORE`, or `SDKWORK_APPSTORE`. Required for vendor store media; omit or set `SDKWORK_APPSTORE` for catalog media |
| `locale` | BCP 47. Required for every role; the cover and screenshots must use the locale they declare |
| `deviceClass` | Required for `SCREENSHOT`: `BROWSER`, `DESKTOP`, `ANDROID_PHONE`, `ANDROID_TABLET`, `IPHONE`, `IPAD`, `HARMONY_PHONE`, `HARMONY_TABLET`, `MINI_PROGRAM`, `MOBILE`, `CONTENT` |
| `displayType` | Required for `SCREENSHOT` and `PREVIEW_VIDEO`: section 5 tokens or store profile display tokens |
| `width`, `height` | Required for raster roles (`ICON`, `COVER`, `SCREENSHOT`, `PREVIEW_IMAGE`, `FEATURE_GRAPHIC`, `POSTER`); they `MUST` equal the decoded source dimensions |
| `format` | Required; must match the file extension and the decoded bytes. An external hosted preview video may omit it |
| `fileSizeBytes` | Required for committed `path` assets; `MUST` equal the file size |
| `alphaChannel` | Required for raster roles; `MUST` match the decoded alpha-channel presence |
| `durationSeconds` | Required for an uploaded `PREVIEW_VIDEO`; `MUST` match the container duration when readable. An external hosted preview may omit it |
| `caption` | Optional, at most 160 characters, localized |
| `sortOrder` | Non-negative integer, unique per enabled group (same type, platform, displayType, locale, storePlatform) and contiguous from `0` |
| `enabled` | Defaults to `true`; `false` assets are excluded from counts and projection |
| `metadata.altText` | Required for `COVER` and `SCREENSHOT`; accessible description, localized |
| `metadata.capture` | Required on every `SCREENSHOT`; records tool, version, app version, commit, capture time, locale, and display type |
| `metadata.placeholder` | `true` only per section 2.2 |
| `metadata.posterAssetId` | Required on `PREVIEW_VIDEO`; references an enabled `POSTER`, `PREVIEW_IMAGE`, or `COVER` |
| `metadata.focalPoint`, `metadata.cropAnchor`, `metadata.theme` | Cover composition controls defined in section 7 |

Rules:

- Every enabled raster asset with `path` `MUST` be decoded and cross-checked. A manifest that declares dimensions, size, alpha, or duration that the bytes do not have `MUST` fail validation.
- An enabled asset with neither `path` nor `driveUri`/`resource` nor `external: true` `MUST` fail validation.
- Assets `MUST NOT` duplicate an id or a `(type, platform, displayType, locale, sortOrder, storePlatform)` tuple.
- `media.metadata.defaultLocale` `MUST` exist. A catalog-ready application `MUST` cover that locale with one enabled `COVER`.
- The projection consumes enabled entries only, ordered by `sortOrder` within their group.

## 5. Per-Application-Type Media Matrix

`app.appType` is the backend `PlusProjectType` value from `APP_MANIFEST_SPEC.md`. UI-bearing screenshots are additionally gated by `publish.platforms`: a type that can have a UI requires screenshots only for UI surfaces it actually ships.

### 5.1 Required Roles By Type

| `appType` | Typical delivery | `assets/resources/` | Catalog-ready roles beyond `ICON` + `COVER` | Capture kind |
| --- | --- | --- | --- | --- |
| `NONE` | Server, operations, infrastructure | optional service/brand resources | none | none |
| `SDK` | Library or API service | optional diagrams and sample media | none (screenshots optional, never required) | none |
| `PPT` | Presentation deck/template | `deck/`, `slides/` | at least three `PREVIEW_IMAGE` with `purpose = SLIDE_PREVIEW` | render |
| `VIDEO` | Video content | `video/`, `poster/`, `storyboard/` | `POSTER`; one `PREVIEW_VIDEO` (trailer or preview) | render |
| `POSTER` | Poster/graphic content | `poster/` | `POSTER` | render |
| `APP_HTML` | HTML/static web or web-hosted app | `ui/` | `SCREENSHOT` per shipped UI surface | browser |
| `APP_VUE` | Vue web app | `ui/` | `SCREENSHOT` per shipped UI surface | browser |
| `APP_REACT` | React web/desktop/H5 app | `ui/` | `SCREENSHOT` per shipped UI surface | browser or device |
| `APP_FLUTTER` | Flutter mobile app | `ui/` | `SCREENSHOT` per shipped mobile platform | device |
| `APP_UNIAPP` | uni-app multi-target | `ui/` | `SCREENSHOT` per shipped target | browser or device |
| `APP_UNITY` | Unity game/interactive client | `game/`, `ui/` | `SCREENSHOT` per shipped target; `PREVIEW_VIDEO` when a declared store lane expects one | recorder |
| `APP_HARMONY` | HarmonyOS native app | `ui/` | `SCREENSHOT` per shipped mobile platform | device |

Rules:

- `NONE` and `SDK` applications still own an `assets/` root and a cover; they never fabricate screenshots. A preview image or a real documentation capture `MAY` be used as a `PREVIEW_IMAGE`, never as a `SCREENSHOT`.
- Content applications (`PPT`, `VIDEO`, `POSTER`) render their media from the authored content. A deck preview is not a screenshot; a video poster is not a cover substitute.
- A client application that ships only `API`, `CLI`, or other non-UI platforms needs no screenshot. Once it declares a UI platform, the per-surface screenshot rule applies.
- An application that declares both `APP_REACT` and a non-UI backend family still uses one manifest; the matrix is evaluated per declared surface, not per package.

### 5.2 Shipped UI Surfaces

| `publish.platforms` value | Surface family | Catalog `platform` | `deviceClass` | `displayType` |
| --- | --- | --- | --- | --- |
| `WEB` | web | `WEB` | `BROWSER` | `DESKTOP_16_9` |
| `H5`, `H5_WEIXIN` | h5 | the declared value | `MOBILE` | `H5_9_16` |
| `DESKTOP`, `DESKTOP_WINDOWS`, `DESKTOP_MACOS`, `DESKTOP_LINUX` | desktop | the declared value | `DESKTOP` | `DESKTOP_16_9` |
| `APP_IOS` | ios | `APP_IOS` | `IPHONE` | `IPHONE_6_9` |
| `APP_ANDROID` | android | `APP_ANDROID` | `ANDROID_PHONE` | `ANDROID_PHONE` |
| `APP_HARMONY` | harmony | `APP_HARMONY` | `HARMONY_PHONE` | `HARMONY_PHONE` |
| `APP`, `APP_PLUS` | mobile | the declared value | `MOBILE` | `MOBILE_9_16` |
| `MP_*` | mini-program | the declared value | `MINI_PROGRAM` | `MINI_PROGRAM_9_16` |
| `QUICKAPP*` | quickapp | the declared value | `MOBILE` | `MOBILE_9_16` |

Rules:

- Each distinct surface family present in `publish.platforms` `MUST` have at least one enabled catalog screenshot (`storePlatform` absent or `SDKWORK_APPSTORE`) with the matching `platform`, `deviceClass`, and `displayType`.
- Multiple platform values in one family (`DESKTOP_WINDOWS` and `DESKTOP_MACOS`) `MAY` share one screenshot when the UI is identical; the entry names the primary platform and the capture config may prove both.
- A catalog screenshot group is `(platform, displayType, locale)`. It holds 1 to 10 enabled screenshots. Three to six is the recommended catalog density.
- `sortOrder` is contiguous from `0` inside each group; the first screenshot is the gallery lead image.

### 5.3 Appstore Listing Presets

The SDKWork appstore creation menu exposes listing presets such as `app`, `website`, and `promo`. A preset is a navigation shortcut, not an `appType` value.

Rules:

- The creation flow `MUST` resolve the preset to a backend `PlusProjectType` value before it writes `agent.app.config.json`: `app` resolves to the shipped client root type (`APP_REACT`, `APP_HTML`, `APP_VUE`, `APP_FLUTTER`, `APP_UNIAPP`, `APP_UNITY`, or `APP_HARMONY`); `website` resolves to `APP_HTML` or `APP_VUE`; `promo` resolves to `VIDEO`, `POSTER`, or `PPT` according to the authored content.
- A preset name `MUST NOT` be written into `app.appType`. Listing category, pricing model, and visibility are platform metadata, not application type.
- The resolved `appType` selects the required media set and capture adapter. An unresolved or unsupported preset fails creation instead of producing a manifest that cannot pass `APP_MANIFEST_SPEC.md`.

### 5.4 Readiness Levels

| Level | Trigger | Required media |
| --- | --- | --- |
| Scaffold | New app, marker declared | `assets/` tree, `README.md`, icon entry, capture config for capture types |
| Catalog-ready | `publish.status` is `ACTIVE`/`BETA`/`INTERNAL` with a UI or content product, `publish.stores` is non-empty, or `publish.listed = true` | Icon, cover for the default locale, type extras, one screenshot per shipped UI surface, captions/alt text |
| Store-ready | `publish.stores` declares a vendor store | Catalog-ready plus every asset required by that store profile, tagged with `storePlatform`, with per-store dimensions and counts |

Rules:

- A `DRAFT` application `MAY` omit the cover and gallery until it is prepared for listing, but it `MUST NOT` claim `publish.listed = true`.
- `ACTIVE` is a claim of catalog readiness. The validator evaluates the matrix for `ACTIVE`, `BETA`, `INTERNAL`, `LISTED`, and `PUBLISHED` statuses.
- A store lane without store-tagged media is a configuration error, not a missing-asset warning.

## 6. Creation Capture Contract

Application creation is not complete when the manifest exists. It is complete when the application has a governed asset root and a reproducible way to capture its first real screens.

### 6.1 Creation Sequence

1. Scaffold the asset root with `node ../sdkwork-specs/tools/bootstrap-app-assets.mjs --root <app-root>` (section 10). The scaffolder creates the directory tree, `README.md`, `.gitignore`, type-specific `resources/` subdirectories, and `assets/capture/capture.config.json` for capture-bearing types. It never fabricates media.
2. Add the primary icon and the cover master. If the brand kit does not exist yet, the application remains `DRAFT`; a generated placeholder is allowed only under section 2.2.
3. Boot the application in `standalone.development` with deterministic demo data, then run the capture command recorded in `capture.config.json`.
4. Curate captures: choose the representative screens, localize captions, mask personal data, and verify the UI state is honest.
5. Write the manifest media entries from the capture report (path, dimensions, format, file size, alpha, capture metadata).
6. Run `node ../sdkwork-specs/tools/check-app-assets-standard.mjs --root .` and fix the reported assets.
7. On release, upload source bytes through Drive, record `driveUri`/`resource`, and let the platform projection publish `url`.
8. Only a catalog-ready application can be listed in the SDKWork appstore or submitted to a vendor store.

### 6.2 Capture Configuration

`assets/capture/capture.config.json` is the machine contract between the application and any capture runner, including the appstore creation flow. Shape authority: [`schemas/sdkwork.app-assets.capture.schema.v1.json`](schemas/sdkwork.app-assets.capture.schema.v1.json).

```json
{
  "schemaVersion": 1,
  "kind": "sdkwork.app-assets.capture",
  "appKey": "sdkwork-drive",
  "appVersion": "3.2.0",
  "surfaces": [
    {
      "id": "web-home",
      "kind": "ui",
      "platform": "WEB",
      "deviceClass": "BROWSER",
      "displayType": "DESKTOP_16_9",
      "viewport": { "width": 1920, "height": 1080, "deviceScaleFactor": 1 },
      "locales": ["en-US", "zh-CN"],
      "routes": [{ "id": "drive.home", "path": "/" }],
      "theme": "light",
      "readySelector": "[data-sdkwork-app-ready]"
    }
  ],
  "capture": {
    "tool": "playwright",
    "command": "node tools/capture-app-assets.mjs",
    "outputRoot": ".sdkwork/tmp/assets-capture",
    "locales": ["en-US", "zh-CN"],
    "freezeAnimations": true,
    "maskSelectors": ["[data-testid=\"user-email\"]"],
    "seed": "app-assets-demo"
  }
}
```

Rules:

- The config `MUST` exist for every capture-bearing type from section 5.1, including drafts, so creation never depends on tribal knowledge.
- `surfaces[]` `MUST` cover every shipped UI surface family in `publish.platforms`. The validator fails a missing `h5`, `ios`, `android`, `harmony`, `desktop`, `web`, or `mini-program` surface.
- `capture.command` `MUST` be a deterministic, non-interactive command that exits non-zero when a declared surface cannot be captured. It `MUST` write a machine-readable report to `<capture.outputRoot>/capture-report.json` matching [`schemas/sdkwork.app-assets.capture-report.schema.v1.json`](schemas/sdkwork.app-assets.capture-report.schema.v1.json), and it `MUST NOT` write catalog media directly into `assets/media/`.
- A report with `status = partial` or `status = failed` `MUST` name every skipped or failed capture and its surface. The appstore creation flow treats an incomplete report as not listable.
- `capture.tool` names the primary adapter: `playwright`, `host-webview`, `flutter-integration-test`, `android-instrumentation`, `ios-xctest`, `harmony-test`, `mini-program-automator`, `unity-recorder`, `render-pipeline`, or `manual` (manual requires a written exception in `assets/README.md`). A surface `MAY` declare its own `tool` when the application mixes browser and device surfaces (for example uni-app H5 plus WeChat mini program).
- `capture.locales` `MUST` include `media.metadata.defaultLocale` and every locale that has a cover.

### 6.3 Capture Determinism

Captured media is review evidence. A capture that changes because of the environment is not acceptable.

| Dimension | Requirement |
| --- | --- |
| Viewport | Fixed width, height, and device scale factor matching `displayType`; no responsive resize during capture |
| Locale and timezone | Fixed per run; recorded in `metadata.capture.locale`; no locale fallback surprises |
| Data | Seeded deterministic demo fixtures; never production or tenant data |
| Animation and video | Frozen or paused before the shot; cursor hidden; transient toasts dismissed |
| Network | Fixtures or recorded responses; failing third-party requests must not change the layout |
| Overlays | Development badges, debug panels, cookie banners, and update prompts hidden |
| Theme | The declared `theme` (`light` or `dark`) captured; not mixed |
| Readiness | Wait for the declared `readySelector` and for fonts; no timeout-based sleeps as the primary wait |
| Scroll | Capture at the declared stable scroll position, normally the top of the route |
| Redaction | `maskSelectors` cover personal data, tokens, emails, phone numbers, tenant names, and customer content |
| Provenance | Record tool name/version, application version, commit, and capture time |
| Privacy | No real user, customer, or tenant data; EXIF and GPS metadata stripped before commit |

### 6.4 Capture Adapters

| Surface | Adapter | Notes |
| --- | --- | --- |
| PC web, H5, static web | `playwright` | One Chromium context per locale; disable device emulation for `DESKTOP_16_9` |
| Desktop host | `host-webview` | Drive the Tauri/Electron renderer through a test harness or capture the same renderer build; OS chrome excluded |
| Flutter | `flutter-integration-test` | `IntegrationTestWidgetsFlutterBinding` screenshot or golden pipeline; one run per platform locale |
| Android native | `android-instrumentation` | Gradle managed device + instrumentation screenshot; no emulator chrome |
| iOS native | `ios-xctest` | `XCUIScreen` screenshot or simulator screenshot from a deterministic launch argument set |
| HarmonyOS | `harmony-test` | hvigor test plus device snapshot; no desktop mirror |
| Mini program | `mini-program-automator` | Platform devtools automation; simulate a fixed device profile |
| Unity | `unity-recorder` | Deterministic scene, fixed resolution, recorded frame and trailer |
| PPT | `render-pipeline` | Render the deck to slide images; the cover is the title slide |
| Video | `render-pipeline` | Extract the poster frame and a trailer cut from the master |
| Poster | `render-pipeline` | Render the master and size variants |

An adapter that cannot run in the current environment `MUST` fail with the missing surface named. It `MUST NOT` substitute a placeholder, a previous release capture, or a marketing image for a screenshot.

### 6.5 Creation Through The Appstore

The SDKWork appstore creation flow is an authorized capture and upload client:

- The creation dialog `MUST` accept an icon, a cover, screenshots, and previews, and `MUST` validate them against the selected `appType` matrix and the target store profiles before saving.
- Uploads `MUST` go through Drive Uploader (`DRIVE_SPEC.md`) and be represented as `MediaResource`; the appstore `MUST` write `driveUri`/`resource` and the asset metadata into the application manifest, and `MUST` not keep a second media catalog.
- When the publisher supplies a reachable preview URL for a browser or H5 application, the creation flow `SHOULD` capture the first screenshot set itself, using the display profile of the selected surface and the determinism rules in section 6.3.
- A created application `MUST NOT` become listable while any enabled placeholder, missing cover, missing screenshot for a shipped UI surface, or store-profile violation remains.

## 7. Cover, Preview, And Composition Rules

### 7.1 Cover

| Property | Rule |
| --- | --- |
| Master | 1920 x 1080 (16:9), sRGB, PNG or WEBP, no alpha channel |
| Safe area | At least 5 percent margin on every side; all text, logo, and focal product content stays inside the central 90 percent |
| Text | Short, localized, legible at card size; no store badges, ratings, prices, download CTAs, or unlicensed third-party marks |
| Device frames | Not allowed in the cover master; a composed preview image may use a frame |
| Focal point | `metadata.focalPoint` (`x`, `y` in 0..1) records the subject; `metadata.cropAnchor` records the 3:2 card crop anchor (`center`, `top`, `bottom`, `left`, `right`) |
| Locale | One cover per locale; the default locale cover is mandatory and all text is localized |
| Theme | `metadata.theme` is `light` or `dark`; a light cover is the default and a dark variant is optional |
| Honesty | The cover must depict the real product or its real content; it must not promise a capability the application does not ship |

The catalog card uses a 3:2 center crop of the cover by default. The appstore `MUST` apply `cropAnchor` when present and `MUST NOT` stretch, letterbox, or overlay gradients to fill a missing cover.

### 7.2 Screenshot Composition

- Store screenshots show the application UI directly. Do not add marketing headlines, device bezels, or backgrounds over the UI; a composed promo frame belongs in `PREVIEW_IMAGE`.
- One screenshot per shipped surface is the minimum; the lead screenshot must be recognizable at thumbnail size.
- Use the locale's real UI copy, not translated overlays. RTL locales capture the RTL layout.
- Include at least one `light` and, when the application supports it, one `dark` capture in the catalog set.
- No PII, real customer content, live tokens, internal URLs, debug builds, or test-only banners.

### 7.3 Preview Images

- A `PREVIEW_IMAGE` `MUST` be labeled by purpose and `MUST NOT` be counted as a screenshot.
- PPT slide previews use `purpose = SLIDE_PREVIEW`, 1920 x 1080, rendered from the authored deck, sorted from the title slide onward.
- Composed marketing images use `purpose = DOCS_PREVIEW` or `STORE_LISTING`; they may contain device frames, captions, and backgrounds.
- Captions and alt text are localized.

### 7.4 Preview Video

| Property | Rule |
| --- | --- |
| Store app preview | 15 to 30 seconds unless the declared store profile specifies a different range; at most three per display-type and locale group; MOV, MP4, or M4V |
| Catalog preview | 10 to 60 seconds; at most three per locale; MP4, MOV, or M4V; at most 500 MiB |
| Poster | `metadata.posterAssetId` references an enabled poster, preview image, or cover |
| Content | Real application or real content; no gameplay that the build does not have; no misleading speed or capability |
| Audio | Optional; if present, licensed and localized or captioned |
| Privacy | No real users, customer names, tokens, or internal environments |

Google Play previews are YouTube URLs, not uploaded files. A `GOOGLE_PLAY` `PREVIEW_VIDEO` `MUST` set `external = true` and a YouTube URL; the validator rejects a Google preview video that carries a `path`. An external preview video `MAY` omit `durationSeconds` because the hosting platform owns the runtime.

### 7.5 Accessibility, Privacy, And Legal

- `COVER` and every `SCREENSHOT` `MUST` have localized `metadata.altText`; the appstore renders it and never relies on the filename.
- Captions are short and describe the surface, not the marketing claim.
- Photography, illustration, fonts, music, and footage `MUST` have a recorded rights basis in `assets/README.md`.
- Media `MUST` be stripped of EXIF/GPS and `MUST NOT` expose private locations, device identifiers, or account names.
- Region-restricted content follows `REGION_SPEC.md`; a locale-specific cover or screenshot set must not leak content that is prohibited in that market.
- Brand assets follow the SDKWork trademark and partner-mark rules; a third-party logo may appear only with permission.

## 8. Store Submission Profiles

The machine authority is [`schemas/sdkwork.app-assets.profiles.v1.json`](schemas/sdkwork.app-assets.profiles.v1.json). Each profile records `sourceUrl` and `verifiedAt`; a profile older than the current store documentation is a standard defect, not a validator option. A profile `MAY` carry `provisional: true` while its numeric constraints are carried forward or newly introduced; a provisional profile still fails closed, and it `MUST` be re-verified against the store console before the first submission that relies on it.

| Profile | Icon | Cover/feature graphic | Screenshots | Preview video |
| --- | --- | --- | --- | --- |
| `SDKWORK_APPSTORE` (catalog) | 1024 x 1024 PNG, no alpha | `COVER` 1920 x 1080, no alpha, one per locale and theme | 1 to 10 per surface group, 320-3840 px per side, max aspect 2.25:1 | Up to 3, 10-60 s |
| `APPLE_APP_STORE` | 1024 x 1024 PNG, no alpha | No store feature graphic; the catalog cover is not submitted | Per display type; at least one `IPHONE_6_9`; `IPAD_13` when iPad is shipped; 1 to 10 per group | Up to 3 per group, 15-30 s, MOV/MP4/M4V |
| `GOOGLE_PLAY` | 512 x 512 32-bit PNG, alpha allowed, 1 MiB or smaller | `FEATURE_GRAPHIC` 1024 x 500, PNG/JPEG, no alpha | Phone: 2 to 8; 320-3840 px per side; max aspect 2:1; no alpha. Tablet groups optional per shipped tablet target | YouTube URL only (`external = true`) |
| `HUAWEI_APPGALLERY` | 216 x 216 PNG | AppGallery promotional graphic per profile | At least 3, portrait-first; per profile side limits | Optional, per profile |
| `MICROSOFT_STORE` | 300 x 300 PNG | Store hero art per profile | At least 1; 16:9 or larger desktop captures; up to 10 | Optional trailer, per profile |

Profile rules:

- `publish.stores[]` declares the store lane. Every declared store `MUST` have a matching profile in the catalog; an unknown store id fails validation instead of being silently accepted.
- Store media `MUST` set `storePlatform` and `MUST NOT` reuse a catalog screenshot as proof of store compliance without the tags and dimensions the store profile requires.
- Store media is localized separately. Apple's screenshot set, Google's data-safety declarations, and AppGallery's listing metadata are independent submissions; one platform's metadata never substitutes for another.
- A store profile `MAY` narrow a general rule (smaller size limit, stricter aspect ratio, required tablet set). It `MUST NOT` relax `COVER`/`SCREENSHOT` honesty rules, alpha-channel truthfulness, or privacy rules.
- The release preflight `MUST` run the store-profile checks before `release:submit`. A store submission with a stale profile or missing media fails closed.

## 9. Projection And Appstore Display

`platform_app` projection (extends `APP_MANIFEST_SPEC.md` section 9):

| Manifest | `platform_app` |
| --- | --- |
| `media.icons.primary.url` | `iconUrl` |
| `media.previews[]` where `type = COVER` and `enabled` | `config.media.cover` and the first entry of `config.media.previews` |
| `media.screenshots[]` enabled, ordered by `sortOrder` | `config.media.screenshots` |
| `media.previews[]` enabled, excluding `COVER` | `config.media.previews` |
| `media.metadata.defaultLocale`, `standard`, `assetVersion` | `config.media.metadata` |
| `driveUri` / `resource` | Retained in `config.media` for provenance; never exposed as a public URL |

Appstore rendering contract:

- The listing card shows the 3:2 cover crop, the icon, the name, and the summary. It `MUST NOT` use a screenshot as a cover and `MUST NOT` synthesize a gradient cover.
- The detail page shows the cover, then the screenshot gallery for the selected platform and locale, ordered by `sortOrder`; preview video, when present, plays after the gallery lead.
- Locale selection changes cover, screenshots, captions, and alt text together. Missing locale media falls back to `media.metadata.defaultLocale`, never to another application's media.
- The appstore `MUST` show an explicit empty state ("No screenshots yet") rather than fabricated art when a draft has none.
- All displayed media uses immutable content-addressed URLs. Replacing media changes the URL and invalidates caches; sort order and captions are metadata changes.
- Alt text is passed to the image element; keyboard focus and screen-reader order follow the visual gallery order.
- The appstore `MUST NOT` accept an upload that fails the selected profile. Validation happens before the media record is persisted.

## 10. Validation

Canonical gate:

```bash
node ../sdkwork-specs/tools/check-app-assets-standard.mjs --root .
node ../sdkwork-specs/tools/check-app-assets-standard.mjs --workspace <workspace-root>
node ../sdkwork-specs/tools/check-app-assets-standard.mjs --root . --json
```

Scaffolding:

```bash
node ../sdkwork-specs/tools/bootstrap-app-assets.mjs --root <app-root>
node ../sdkwork-specs/tools/bootstrap-app-assets.mjs --root <app-root> --app-type APP_FLUTTER
```

The validator enforces:

- marker vocabulary and the declared standard version
- asset-root presence, `README.md`, `.gitignore`, type `resources/` shape, and capture configuration for capture-bearing types
- role vocabulary, purpose vocabulary, source identity, `external` discipline, and placeholder rules
- path safety (inside `assets/`, no traversal, no symlink, naming vocabulary)
- decoded image/video facts: dimensions, format, alpha-channel presence, file size, and preview-video duration against the manifest
- unique ids, unique group ordering, contiguous `sortOrder`, and poster references
- `COVER` per default locale and per-surface catalog screenshots
- per-store profile counts, dimensions, formats, alpha rules, durations, and external-URL rules
- capture surface coverage for every shipped UI platform
- migration markers and the `--require-standard` policy
- a clean `--json` payload for CI and appstore preflight consumers

The tests in `tools/check-app-assets-standard.test.mjs` `MUST` cover all twelve `appType` values, content types (`PPT`, `VIDEO`, `POSTER`), browser and device surfaces, store profiles, placeholder rejection, path traversal, decoded-dimension mismatch, and legacy migration behavior. Tests in `tools/bootstrap-app-assets.test.mjs` `MUST` scaffold every type and prove the generated tree and capture configuration pass the structural checks.

Applications declare the gate in their `verify` aggregate as `check:app-assets` when the marker is present. `check:app-manifest-standard` remains the structural binding gate; it composes the store-media checks from this standard so a store lane cannot bypass them by running only one command.

## 11. Migration And Compatibility

- Existing applications keep their current media until they adopt the marker. The validator treats a marker-less manifest as legacy and reports it only under `--require-standard` or under a declared migration deadline.
- Adoption sequence: scaffold with `bootstrap-app-assets.mjs`; add icon and cover; capture at least one real screenshot per shipped UI surface; rewrite placeholder entries; set `media.metadata.standard = "sdkwork-app-assets.v1"`; run the gate.
- An application MAY declare `media.metadata.assetsMigration = { "target": "sdkwork-app-assets.v1", "due": "YYYY-MM-DD" }` while it migrates. After `due`, the validator fails a manifest that still lacks the marker.
- A store lane adoption is not deferred: the moment `publish.stores` is non-empty, store-profile validation applies regardless of the marker.
- Placeholder media `MUST` be removed or replaced before the application is marked catalog-ready. Disabling the entries is acceptable only when the application is not listed and the appstore shows no fabricated art.
- Removing this standard or relaxing its rules requires `GOVERNANCE_SPEC.md` review. Widening a store profile follows the catalog update procedure and records `verifiedAt`.

## 12. New Application Checklist

- [ ] Run `bootstrap-app-assets.mjs` and commit `assets/README.md`, `assets/.gitignore`, and the type `resources/` tree.
- [ ] Add the primary 1024 x 1024 PNG icon and the 1920 x 1080 cover for the default locale.
- [ ] Fill `assets/capture/capture.config.json` with every shipped UI surface and the deterministic capture command.
- [ ] Capture at least one real screenshot per shipped UI surface and record `metadata.capture`.
- [ ] Add type-specific media: three slide previews for `PPT`, poster and trailer for `VIDEO`, poster for `POSTER`.
- [ ] Set `media.metadata.standard = "sdkwork-app-assets.v1"` and `media.metadata.defaultLocale`.
- [ ] Prove dimensions, format, alpha channel, file size, and duration against the files.
- [ ] Add store-tagged media for every `publish.stores[]` lane and run the store profile checks.
- [ ] Remove every enabled placeholder before marking the app catalog-ready.
- [ ] Run `check-app-assets-standard.mjs` and wire it into the application `verify` aggregate.
