# Expert Catalog

Canonical SDKWork expert catalog: 22 divisions, 331 experts and 5 built-in expert teams, with both Chinese and English display content and a persona body per expert.

Authority: [`EXPERTS_CATALOG_SPEC.md`](../../EXPERTS_CATALOG_SPEC.md).

## Files

| Path | Content |
| --- | --- |
| `expert-catalog.v1.json` | The machine authority: taxonomy, experts and teams. |
| `personas/zh-CN/<division>/<slug>.md` | Chinese persona body and frontmatter per expert. |
| `personas/en-US/<division>/<slug>.md` | English persona body and frontmatter per expert. |

## Regenerate

The catalog is generated from the authoring package (`packages/client/ui-sdkwork-experts` in the BirdCoder checkout) so the roster, display names and team content stay byte-identical to what the expert market ships:

```sh
node tools/expert-catalog/generate.mjs                    # default sibling checkout
node tools/expert-catalog/generate.mjs --source <package> # another checkout
node tools/expert-catalog/check.mjs                       # validate + drift check
```

`check.mjs` runs structural checks without the authoring checkout and adds the drift comparison when it exists.

## Consumers

- `sdkwork-agents` renders the expert tables and seeds from `expert-catalog.v1.json` (see the spec's database mapping).
- The DSH expert market package reads the same divisions, experts and teams; its bundled assets are an offline copy of these persona bodies, not a second catalog.

## Editing

1. Change the data here (or regenerate it from an updated authoring package).
2. Run `generate.mjs` when the authoring package moved, then `check.mjs`.
3. Regenerate the consuming repository's seeds and run its database gates.
4. Commit the catalog, the persona bodies and the regenerated seeds together.

Slug and division-code renames are migrations: they change the stable keys every consumer joins on.
