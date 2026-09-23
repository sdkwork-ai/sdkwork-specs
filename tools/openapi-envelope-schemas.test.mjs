/**
 * Guards the canonical SdkWork envelope component schemas against the int64
 * drift class that shipped in PageInfo.totalItems.
 *
 * `totalItems` was authored as `{ type: 'string', pattern: '^[0-9]+$' }` with no
 * `format: int64` and no `x-sdkwork-int64-string` marker, even though
 * templates/openapi/components/schemas/page-info.yaml declares both. Because
 * every derived authority copy is generated from this module, the gap
 * propagated into every workspace and was invisible to
 * check-api-operation-patterns.mjs: that validator only engages schemas which
 * already declare `format: int64`, so a schema declaring no format slipped
 * through as a false green.
 *
 * The invariant asserted here is structural rather than name-based: a decimal
 * digit `pattern` on a string schema is precisely how an int64 wire field is
 * spelled, so such a schema MUST also carry the format and the marker.
 *
 * Authority: API_SPEC.md §13.6, AGENTS.md Int64 Wire Contract.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { sdkWorkEnvelopeComponentSchemas } from './lib/openapi-envelope-schemas.mjs';

const DECIMAL_PATTERN = /^\^-?\[0-9\]\+\$$/u;

function collectDecimalPatternStrings(node, trail, offenders) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectDecimalPatternStrings(item, `${trail}[${index}]`, offenders));
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }
  if (node.type === 'string' && typeof node.pattern === 'string' && DECIMAL_PATTERN.test(node.pattern)) {
    const problems = [];
    if (node.format !== 'int64') problems.push('format: int64');
    if (node['x-sdkwork-int64-string'] !== true) problems.push('x-sdkwork-int64-string: true');
    if (problems.length > 0) offenders.push(`${trail} is missing ${problems.join(' and ')}`);
  }
  for (const [key, value] of Object.entries(node)) {
    collectDecimalPatternStrings(value, `${trail}/${key}`, offenders);
  }
}

test('canonical envelope schemas apply the int64 closure to every decimal-pattern string', () => {
  const offenders = [];
  collectDecimalPatternStrings(sdkWorkEnvelopeComponentSchemas, 'sdkWorkEnvelopeComponentSchemas', offenders);
  assert.deepEqual(
    offenders,
    [],
    'every string schema with a decimal digit pattern must declare format int64 and x-sdkwork-int64-string per API_SPEC 13.6',
  );
});

test('PageInfo.totalItems carries the int64 string closure', () => {
  const totalItems = sdkWorkEnvelopeComponentSchemas.PageInfo.properties.totalItems;
  assert.equal(totalItems.type, 'string');
  assert.equal(totalItems.format, 'int64');
  assert.equal(totalItems.pattern, '^[0-9]+$');
  assert.equal(totalItems['x-sdkwork-int64-string'], true);
});
