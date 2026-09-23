import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateTokenMinimalClaims } from './check-token-minimal-claims.mjs';

// ---- fixtures -------------------------------------------------------------

const SPEC = `${[
  '# IAM_SPEC',
  '## 5.2 Token Claims',
  '- Authorization scopes (`data_scope`, `permission_scope`) `MUST NOT` be embedded in either token.',
  '- Token payloads `MUST` be minimal, bounded, and terminated by the entrypoint header budget.',
  '- data_scope and permission_scope are never registered claims.',
  '- Embedding them caused `HTTP 431 Request Header Fields Too Large`.',
  '- Claim admission is closed by default: a payload `MUST` be a fixed-size identity envelope.',
  '- Forbidden claims (`MUST NOT` be signed): role-code arrays, menu trees, entitlement maps.',
].join('\n')}\n`;

const CLEAN_IAM_SIGNER = `
pub(crate) fn sign_local_session_token_with_ttl(context: &IamAppContext) -> String {
    let payload = json!({
        "app_id": context.app_id,
        "aud": context.app_id,
        "exp": expires_at,
        "iat": issued_at,
        "iss": "sdkwork-iam-local",
        "session_id": context.session_id,
        "tenant_id": context.tenant_id,
        "token_type": token_type,
        "user_id": context.user_id
    });
    format!("{}.{}", encode_jwt_json(&payload))
}
`;

const SCOPE_IN_TOKEN_SIGNER = `
pub(crate) fn sign_legacy(context: &IamAppContext) -> String {
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

// The DB path is where scope is SUPPOSED to live: must stay green.
const DB_WRITE_PATH = `
async fn persist_context(pg: &PgPool, context: &IamAppContext) -> Result<(), Error> {
    sqlx::query(
        "UPDATE iam_session SET data_scope_json = $2, permission_scope_json = $3 WHERE id = $1",
    )
    .bind(&context.session_id)
    .bind(Json(&context.data_scope))
    .bind(Json(&context.permission_scope))
    .execute(pg)
    .await?;
    let data_scope = row.get("data_scope");
    let permission_scope = row.get("permission_scope");
    Ok(())
}
`;

const CREDENTIAL_DERIVATION_RUST = `
fn context_from_claims(claims: &Value) -> Option<IamAppContext> {
    let data_scope = claims.get("data_scope").and_then(json_value_to_string_vec).unwrap_or_default();
    let permission_scope = claims.get("permission_scope").and_then(json_value_to_string_vec).unwrap_or_default();
    Some(IamAppContext { data_scope, permission_scope })
}
`;

const EXEMPT_FIXTURE = `
fn legacy_payload_with_user_id(user_id: &str, now_unix: i64) -> Value {
    // token-claims-gate: legacy-fixture — asserts the scope claim is ignored.
    json!({
        "iss": "sdkwork-iam-local",
        "token_type": "auth",
        "sub": user_id,
        "exp": now_unix + 3600,
        "data_scope": ["tenant:100001"],
        "permission_scope": ["iam:self"]
    })
}
`;

const JS_BOOTSTRAP_SIGNER = `
export function buildBootstrapAccessToken(env, permissionScope) {
  const claims = { tenant_id: '100001', app_id: 'demo', exp: Date.now() + 3600 };
  claims.permission_scope = permissionScope.join(',');
  return signPayload(claims);
}
`;

const OTHER_REPO_SIGNER = `
pub fn sign_gateway_token(ctx: &GatewayContext) -> String {
    let payload = json!({
        "iss": "sdkwork-gateway",
        "token_type": "access",
        "aud": ctx.app_id,
        "exp": expires_at,
        "permission_scope": ctx.permission_scope
    });
    payload.to_string()
}
`;

const DOC_DEBT = `# App integration
After IAM role changes, re-login so JWT \`permission_scope\` refreshes.
`;

async function withFixture(files, callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdkwork-token-check-'));
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

const IAM_SIGNER_PATH = 'sdkwork-iam/crates/sdkwork-iam-web-adapter/src/access_token_issue.rs';

// ---- control group: clean workspace is green ------------------------------

test('[control] accepts signers that do not embed scope claims', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    [IAM_SIGNER_PATH]: CLEAN_IAM_SIGNER,
  }, async (root) => {
    const result = validateTokenMinimalClaims(root);
    assert.equal(result.ok, true, result.violations.join('\n'));
    assert.equal(result.violations.length, 0);
  });
});

test('[control] DB-authoritative scope persistence stays green', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    [IAM_SIGNER_PATH]: CLEAN_IAM_SIGNER + DB_WRITE_PATH,
  }, async (root) => {
    const result = validateTokenMinimalClaims(root);
    assert.equal(result.ok, true, result.violations.join('\n'));
  });
});

// ---- R1: signed scope ------------------------------------------------------

test('[R1] rejects a token payload that embeds data_scope or permission_scope', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    [IAM_SIGNER_PATH]: SCOPE_IN_TOKEN_SIGNER,
  }, async (root) => {
    const result = validateTokenMinimalClaims(root);
    assert.equal(result.ok, false);
    const text = result.violations.join('\n');
    assert.match(text, /data_scope/u);
    assert.match(text, /permission_scope/u);
    assert.match(text, /HTTP 431/u);
  });
});

test('[R1] rejects a signer that embeds only permission_scope', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    [IAM_SIGNER_PATH]: SCOPE_IN_TOKEN_SIGNER.replace('"data_scope": context.data_scope,\n', ''),
  }, async (root) => {
    const result = validateTokenMinimalClaims(root);
    assert.equal(result.ok, false);
    assert.match(result.violations.join('\n'), /permission_scope/u);
  });
});

test('[R1] covers repositories other than sdkwork-iam', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    'sdkwork-gateway/crates/gateway/src/token.rs': OTHER_REPO_SIGNER,
  }, async (root) => {
    const result = validateTokenMinimalClaims(root);
    assert.equal(result.ok, false, 'a non-IAM signer must be caught by the workspace-wide scan');
    assert.match(result.violations.join('\n'), /sdkwork-gateway/u);
  });
});

test('[R1b] rejects a JS/TS caller that assigns a claim onto a payload', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    'sdkwork-demo/scripts/lib/demo-dev-bootstrap-access-token-env.mjs': JS_BOOTSTRAP_SIGNER,
  }, async (root) => {
    const result = validateTokenMinimalClaims(root);
    assert.equal(result.ok, false, 'a JS bootstrap signer must be caught');
    assert.match(result.violations.join('\n'), /permission_scope/u);
  });
});

// ---- R2: credential-derived authorization ---------------------------------

test('[R2] reports reading scope out of a credential as an advisory, not a blocker', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    'sdkwork-iam/crates/sdkwork-iam-web-adapter/src/iam_session.rs': CREDENTIAL_DERIVATION_RUST,
  }, async (root) => {
    const result = validateTokenMinimalClaims(root);
    // Reading a credential is legal at the parsing layer; the blocking contract
    // is that the authorization decision comes from the server-resolved port.
    assert.equal(result.ok, true, result.violations.join('\n'));
    assert.equal(result.summary.advisories, 2, 'both scope reads must be reported');
    assert.equal(result.summary.blocking, 0);
    const text = result.violations.join('\n');
    assert.match(text, /advisory/u);
    assert.match(text, /§5\.6/u);
  });
});

// ---- explicit fixture opt-out ---------------------------------------------

test('[exempt] an explicitly marked legacy fixture is allowed', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    [IAM_SIGNER_PATH]: CLEAN_IAM_SIGNER + EXEMPT_FIXTURE,
  }, async (root) => {
    const result = validateTokenMinimalClaims(root);
    assert.equal(result.ok, true, result.violations.join('\n'));
  });
});

// ---- D1: documentation debt -----------------------------------------------

test('[D1] rejects documentation that says a credential carries scope', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    [IAM_SIGNER_PATH]: CLEAN_IAM_SIGNER,
    'sdkwork-im/specs/INTEGRATION.md': DOC_DEBT,
  }, async (root) => {
    const result = validateTokenMinimalClaims(root);
    assert.equal(result.ok, false, 'doc debt must be caught');
    assert.match(result.violations.join('\n'), /D1/u);
  });
});

test('[D1] accepts documentation that forbids carrying scope', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': SPEC,
    [IAM_SIGNER_PATH]: CLEAN_IAM_SIGNER,
    'sdkwork-im/specs/INTEGRATION.md':
      'A JWT `MUST NOT` carry permission_scope; it MUST be read from the server.\n',
  }, async (root) => {
    const result = validateTokenMinimalClaims(root);
    assert.equal(result.ok, true, result.violations.join('\n'));
  });
});

// ---- spec anchors ----------------------------------------------------------

test('rejects a missing IAM_SPEC minimal-claim marker', async () => {
  await withFixture({
    'sdkwork-specs/IAM_SPEC.md': '# bare\n## section\nno normative markers here\n',
    [IAM_SIGNER_PATH]: CLEAN_IAM_SIGNER,
  }, async (root) => {
    const result = validateTokenMinimalClaims(root);
    assert.equal(result.ok, false);
    assert.match(result.violations.join('\n'), /minimal-claim marker/u);
  });
});
