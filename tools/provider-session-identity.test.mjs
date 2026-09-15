import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  collectLegacyProviderSessionIdentity,
  isProviderSessionIdentityExemptPath,
  migrateProviderSessionIdentity,
  replaceProviderSessionIdentityPath,
  replaceProviderSessionIdentityText,
} from './lib/provider-session-identity.mjs';

describe('provider Session identity terminology', () => {
  it('maps the complete identity family to provider terminology', () => {
    assert.equal(
      replaceProviderSessionIdentityText([
        'nativeSessionId nativeSessionTreeId nativeParentSessionId nativeForkedFromSessionId nativeActivity',
        'native_session_id native_session_tree_id native_parent_session_id native_forked_from_session_id native_activity',
        'nativeDirectoryName nativeDirectoryFingerprint nativeMessageId nativeObservedAt nativeFreshUntil',
        'NativeSessionActivityProvider provider-native session NATIVE_DIRECTORY_FINGERPRINT_PREFIX',
        'Provider-native identifiers cross-tenant native identity native directory identity',
        'Provider-provider observation and provider-provider evidence',
        'providerProviderSessionId provider_provider_session nativeHistory native_history native-history nativeIdentity native_identity',
        'session.native.codex runtime_binding.native.codex native activity native ids',
        'nativeInventory native_inventory native-transcript nativeSyncSessionId item.native.codex',
        'native provider sessions provider-native snapshot',
        'nativeSyncTraceId freshNativeObservation native runtime binding',
        'provider-native runtime activity kernel-native durable session id',
      ].join('\n')),
      [
        'providerSessionId providerSessionTreeId providerParentSessionId providerForkedFromSessionId providerActivity',
        'provider_session_id provider_session_tree_id provider_parent_session_id provider_forked_from_session_id provider_activity',
        'providerSessionDirectoryName providerSessionDirectoryFingerprint providerMessageId providerObservedAt providerFreshUntil',
        'ProviderSessionActivityProvider provider Session PROVIDER_SESSION_DIRECTORY_FINGERPRINT_PREFIX',
        'Provider Session identifiers cross-tenant provider Session identity provider Session directory identity',
        'Provider activity observation and provider activity evidence',
        'providerSessionId provider_session providerSessionHistory provider_session_history provider-session-history providerSessionIdentity provider_session_identity',
        'session.provider.codex runtime_binding.provider.codex provider activity provider Session IDs',
        'providerSessionInventory provider_session_inventory provider-session-transcript providerSessionSyncSessionId item.provider.codex',
        'provider Sessions provider Session snapshot',
        'providerSessionSyncTraceId freshProviderObservation provider Session runtime binding',
        'provider Session runtime activity kernel-owned durable Session ID',
      ].join('\n'),
    );
  });

  it('migrates authored files and defers generated SDK output', () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-provider-session-'));
    const authored = path.join(workspace, 'sdkwork-agents/src/native_session_sync.rs');
    const generated = path.join(
      workspace,
      'sdkwork-agents/sdks/sdkwork-agents-app-sdk/generated/session-native-activity.ts',
    );
    mkdirSync(path.dirname(authored), { recursive: true });
    mkdirSync(path.dirname(generated), { recursive: true });
    writeFileSync(authored, 'let native_session_id = nativeSessionId;\n');
    writeFileSync(generated, 'export interface SessionNativeActivity { nativeSessionId: string }\n');

    const preview = migrateProviderSessionIdentity(workspace);
    assert.equal(preview.length, 1);
    assert.equal(existsSync(authored), true);

    migrateProviderSessionIdentity(workspace, { write: true });
    const migrated = path.join(workspace, 'sdkwork-agents/src/provider_session_sync.rs');
    assert.equal(existsSync(authored), false);
    assert.equal(readFileSync(migrated, 'utf8'), 'let provider_session_id = providerSessionId;\n');
    assert.ok(collectLegacyProviderSessionIdentity(workspace).length > 0);

    rmSync(generated);
    writeFileSync(
      path.join(path.dirname(generated), 'session-provider-activity.ts'),
      'export interface SessionProviderActivity { providerSessionId: string }\n',
    );
    assert.deepEqual(collectLegacyProviderSessionIdentity(workspace), []);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('preserves unrelated native authentication and vault terminology', () => {
    // Absolute fixtures on purpose: the unit under test classifies absolute file
    // paths by their repository-relative suffix, so the drive prefix is test data
    // rather than a source/build binding.
    // WORKSPACE-PATH:allow
    const birdcoderAdapter = 'E:/sdkwork-space/sdkwork-birdcoder/apps/sdkwork-birdcoder-h5/packages/sdkwork-birdcoder-h5-capacitor/src/adapters/capacitorSecureStorageAdapter.ts';
    // WORKSPACE-PATH:allow — same absolute-fixture rationale as above.
    const kernelVault = 'E:/sdkwork-space/sdkwork-kernel/sdkwork-agent-kernel/src/secret_vault.rs';

    assert.equal(isProviderSessionIdentityExemptPath(birdcoderAdapter), true);
    assert.equal(isProviderSessionIdentityExemptPath(kernelVault), true);
  });

  it('renames provider Session identity filenames in every naming style', () => {
    assert.equal(
      replaceProviderSessionIdentityPath('tests/nativeDirectoryFingerprint.test.ts'),
      'tests/providerSessionDirectoryFingerprint.test.ts',
    );
    assert.equal(
      replaceProviderSessionIdentityPath('src/NativeSessionActivity.ts'),
      'src/ProviderSessionActivity.ts',
    );
  });
});
