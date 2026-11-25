import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ALLOWED_SITES,
  applyAllowlist,
  scanRepo,
} from './check-body-read-contract.mjs';

function fixtureRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'body-read-contract-'));
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, 'utf8');
  }
  return root;
}

test('flags a message rebuilt from parts with an empty body', () => {
  const repo = fixtureRepo({
    'src/proxy.rs': [
      'async fn observe(response: Response<Body>) -> Response<Body> {',
      '    let (parts, body) = response.into_parts();',
      '    let bytes = axum::body::to_bytes(body, LIMIT).await.unwrap();',
      '    let _ = bytes;',
      '    Response::from_parts(parts, Body::empty())',
      '}',
      '',
    ].join('\n'),
  });
  const findings = scanRepo(repo);
  assert.ok(
    findings.some((finding) => finding.rule === 'empty-rebuild'),
    'expected an empty-rebuild finding',
  );
});

test('flags an optional capture that degrades into an empty body', () => {
  const repo = fixtureRepo({
    'src/log.rs': [
      'fn rebuild(parts: Parts, captured: Option<Bytes>) -> Request<Body> {',
      '    Request::from_parts(parts, captured.map(Body::from).unwrap_or_else(Body::empty))',
      '}',
      '',
    ].join('\n'),
  });
  const findings = scanRepo(repo);
  assert.ok(
    findings.some((finding) => finding.rule === 'empty-fallback'),
    'expected an empty-fallback finding',
  );
});

test('flags an empty body emitted right after a body read', () => {
  const repo = fixtureRepo({
    'src/finalize.rs': [
      'async fn finalize(response: Response<Body>) -> Response<Body> {',
      '    let (parts, body) = response.into_parts();',
      '    match http_body_util::BodyExt::collect(body).await {',
      '        Ok(_) => response,',
      '        Err(_) => Response::from_parts(parts, Body::empty()),',
      '    }',
      '}',
      '',
    ].join('\n'),
  });
  const findings = scanRepo(repo);
  assert.ok(
    findings.some((finding) => finding.rule === 'read-then-empty'),
    'expected a read-then-empty finding',
  );
});

test('ignores comments and inline test modules', () => {
  const repo = fixtureRepo({
    'src/clean.rs': [
      'fn replay(parts: Parts, bytes: Bytes) -> Request<Body> {',
      '    // FORBIDDEN: from_parts(parts, Body::empty())',
      '    Request::from_parts(parts, Body::from(bytes))',
      '}',
      '',
      '#[cfg(test)]',
      'mod tests {',
      '    fn fixture() -> Request<Body> {',
      '        Request::from_parts(Parts::default(), Body::empty())',
      '    }',
      '}',
      '',
    ].join('\n'),
  });
  assert.deepEqual(scanRepo(repo), []);
});

test('allowlist suppresses exactly the documented sites', () => {
  const allowed = ALLOWED_SITES[0];
  const finding = {
    repo: allowed.repo,
    file: allowed.file,
    line: 10,
    rule: allowed.rule,
    code: allowed.contains,
    hint: 'documented',
  };
  const { remaining, stale } = applyAllowlist([finding]);
  assert.deepEqual(remaining, []);
  assert.equal(stale.length, ALLOWED_SITES.length - 1);
});

test('an allowlist entry without a matching site is reported as stale', () => {
  const { remaining, stale } = applyAllowlist([]);
  assert.deepEqual(remaining, []);
  assert.equal(stale.length, ALLOWED_SITES.length);
  assert.ok(stale.every((entry) => entry.stale === true));
});
