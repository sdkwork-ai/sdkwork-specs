import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateIamTokenMinimalClaims } from './check-iam-token-minimal-claims.mjs';

const SPEC = `${[
  '# IAM_SPEC',
  '## 5.2 Token Claims',
  '- Authorization scopes (`data_scope`, `permission_scope`) `MUST NOT` be embedded in either token.',
  '- Token payloads `MUST` be minimal, bounded, and terminated by the entrypoint header budget.',
  '- data_scope and permission_scope are never registered claims.',
  '- Embedding them caused `HTTP 431 Request Header Fields Too Large`.',
].join('\n')}\n`;

const CLEAN_SIGNER = `
pub(crate) fn sign_local_session_token_with_ttl(
    signing_key: &TenantSigningKey,
    token_type: &str,
    context: &IamAppContext,
    ttl_seconds: u128,
) -> String {
    let payload = json!({
        "app_id": context.app_id,
        "aud": context.app_id,
        "auth_level": auth_level_to_string(&context.auth_level),
        "exp": expires_at,
        "iat": issued_at,
        "iss": "sdkwork-iam-local",
        "login_scope": login_scope_to_string(&context.login_scope),
        "organization_id": organization_id,
        "session_id": context.session_id,
        "tenant_id": context.tenant_id,
        "token_type": token_type,
        "user_id": context.user_id
    });
    let _ = context.data_scope;
    format!("{}.{}", encode_jwt_json(&payload))
}
`;

const SCOPE_IN_TOKEN_SIGNER = `
pub(crate) fn sign_legacy(signing_key: &TenantSigningKey, context: &IamAppContext) -> String {
    let payload = json!({
        "iss": "sdkwork-iam-local",
        "token_type": "access",
        "data_scope": context.data_scope,
        "permission_scope": context.permission_scope,
        "session_id": context.session_id
    });
    format!("{payload}")
}
`;

async function withFixture(files, callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdkwork-iam-token-check-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
    }
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('accepts signers that do not embed scope claims', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    'sdkwork-iam/crates/sdkwork-iam-web-adapter/src/access_token_issue.rs': CLEAN_SIGNER,
  }, async (root) => {
    const result = validateIamTokenMinimalClaims(root);
    assert.equal(result.ok, true, result.violations.join('\n'));
    assert.equal(result.summary.iamRoot.endsWith('sdkwork-iam'), true);
  });
});

test('rejects a token payload that embeds data_scope or permission_scope', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    'sdkwork-iam/crates/sdkwork-iam-web-adapter/src/access_token_issue.rs': SCOPE_IN_TOKEN_SIGNER,
  }, async (root) => {
    const result = validateIamTokenMinimalClaims(root);
    assert.equal(result.ok, false);
    assert.match(result.violations.join('\n'), /data_scope/);
    assert.match(result.violations.join('\n'), /permission_scope/);
    assert.match(result.violations.join('\n'), /HTTP 431/);
  });
});

test('rejects a signer that embeds only permission_scope', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    'sdkwork-iam/crates/sdkwork-iam-web-adapter/src/access_token_issue.rs': SCOPE_IN_TOKEN_SIGNER.replace(
      '"data_scope": context.data_scope,\n',
      '',
    ),
  }, async (root) => {
    const result = validateIamTokenMinimalClaims(root);
    assert.equal(result.ok, false);
    assert.match(result.violations.join('\n'), /permission_scope/);
  });
});

test('rejects a missing IAM_SPEC minimal-claim marker', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': '# bare\n## section\nno normative markers here\n',
    'sdkwork-iam/crates/sdkwork-iam-web-adapter/src/access_token_issue.rs': CLEAN_SIGNER,
  }, async (root) => {
    const result = validateIamTokenMinimalClaims(root);
    assert.equal(result.ok, false);
    assert.match(result.violations.join('\n'), /minimal-claim marker/);
  });
});