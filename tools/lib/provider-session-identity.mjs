import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRECTORIES = new Set([
  '.dart_tool',
  '.git',
  '.pnpm-store',
  '.runtime',
  '.sdkwork',
  '.tmp',
  // Agent scratch, the same class the portability and shell-portability gates
  // already exclude. It has to be listed here separately: this walker keeps its
  // own set, and without it an agent's own gate-health report — which by
  // construction quotes the very terminology this check forbids — is reported as
  // a product violation and pushes the repository over its registered baseline.
  '.workbuddy',
  '__pycache__',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'external',
  'node_modules',
  'target',
  'test-results',
]);

const GENERATED_DIRECTORIES = new Set(['gen', 'generated']);

const PROVIDER_SESSION_REPOSITORIES = new Set([
  'sdkwork-agents',
  'sdkwork-agentstudio',
  'sdkwork-birdcoder',
  'sdkwork-kernel',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.dart',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.rs',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const EXEMPT_PATH_PATTERNS = [
  /\/sdkwork-birdcoder\/apps\/sdkwork-birdcoder-h5\/packages\/sdkwork-birdcoder-h5-capacitor\/src\/adapters\/capacitorSecureStorageAdapter\.ts$/u,
  /\/sdkwork-kernel\/sdkwork-agent-kernel\/src\/secret_vault\.rs$/u,
  /\/sdkwork-specs\/MIGRATION_SPEC\.md$/u,
  /\/sdkwork-specs\/NAMING_SPEC\.md$/u,
  /\/sdkwork-specs\/tools\/(?:check|migrate)-provider-session-identity\.mjs$/u,
  /\/sdkwork-specs\/tools\/lib\/provider-session-identity\.mjs$/u,
  /\/sdkwork-specs\/tools\/provider-session-identity\.test\.mjs$/u,
];

export const PROVIDER_SESSION_IDENTITY_REPLACEMENTS = [
  ['provider_native_session', 'provider_session'],
  ['PROVIDER_NATIVE_SESSION', 'PROVIDER_SESSION'],
  ['providerNativeSession', 'providerSession'],
  ['ProviderNativeSession', 'ProviderSession'],
  ['provider-native-session', 'provider-session'],
  ['provider_provider_session', 'provider_session'],
  ['PROVIDER_PROVIDER_SESSION', 'PROVIDER_SESSION'],
  ['providerProviderSession', 'providerSession'],
  ['ProviderProviderSession', 'ProviderSession'],
  ['provider-provider-session', 'provider-session'],
  ['native_history', 'provider_session_history'],
  ['NATIVE_HISTORY', 'PROVIDER_SESSION_HISTORY'],
  ['nativeHistory', 'providerSessionHistory'],
  ['NativeHistory', 'ProviderSessionHistory'],
  ['native-history', 'provider-session-history'],
  ['native_identity', 'provider_session_identity'],
  ['NATIVE_IDENTITY', 'PROVIDER_SESSION_IDENTITY'],
  ['nativeIdentity', 'providerSessionIdentity'],
  ['NativeIdentity', 'ProviderSessionIdentity'],
  ['native-identity', 'provider-session-identity'],
  ['native_inventory', 'provider_session_inventory'],
  ['NATIVE_INVENTORY', 'PROVIDER_SESSION_INVENTORY'],
  ['nativeInventory', 'providerSessionInventory'],
  ['NativeInventory', 'ProviderSessionInventory'],
  ['native-inventory', 'provider-session-inventory'],
  ['native_transcript', 'provider_session_transcript'],
  ['NATIVE_TRANSCRIPT', 'PROVIDER_SESSION_TRANSCRIPT'],
  ['nativeTranscript', 'providerSessionTranscript'],
  ['NativeTranscript', 'ProviderSessionTranscript'],
  ['native-transcript', 'provider-session-transcript'],
  ['native_sync_session', 'provider_session_sync_session'],
  ['NATIVE_SYNC_SESSION', 'PROVIDER_SESSION_SYNC_SESSION'],
  ['nativeSyncSession', 'providerSessionSyncSession'],
  ['NativeSyncSession', 'ProviderSessionSyncSession'],
  ['native-sync-session', 'provider-session-sync-session'],
  ['native_sync', 'provider_session_sync'],
  ['NATIVE_SYNC', 'PROVIDER_SESSION_SYNC'],
  ['nativeSync', 'providerSessionSync'],
  ['NativeSync', 'ProviderSessionSync'],
  ['native-sync', 'provider-session-sync'],
  ['native_observation', 'provider_observation'],
  ['NATIVE_OBSERVATION', 'PROVIDER_OBSERVATION'],
  ['nativeObservation', 'providerObservation'],
  ['NativeObservation', 'ProviderObservation'],
  ['native-observation', 'provider-observation'],
  ['session.native.', 'session.provider.'],
  ['runtime_binding.native.', 'runtime_binding.provider.'],
  ['item.native.', 'item.provider.'],
  ['native_forked_from_session_id', 'provider_forked_from_session_id'],
  ['native_parent_session_id', 'provider_parent_session_id'],
  ['native_session_tree_id', 'provider_session_tree_id'],
  ['native_directory_fingerprint', 'provider_session_directory_fingerprint'],
  ['native_directory_identity', 'provider_session_directory_identity'],
  ['native_directory_name', 'provider_session_directory_name'],
  ['native_message_id', 'provider_message_id'],
  ['NATIVE_DIRECTORY_FINGERPRINT', 'PROVIDER_SESSION_DIRECTORY_FINGERPRINT'],
  ['NATIVE_DIRECTORY_IDENTITY', 'PROVIDER_SESSION_DIRECTORY_IDENTITY'],
  ['NATIVE_DIRECTORY_NAME', 'PROVIDER_SESSION_DIRECTORY_NAME'],
  ['NATIVE_MESSAGE_ID', 'PROVIDER_MESSAGE_ID'],
  ['NATIVE_OBSERVED_AT', 'PROVIDER_OBSERVED_AT'],
  ['NATIVE_FRESH_UNTIL', 'PROVIDER_FRESH_UNTIL'],
  ['NATIVE_PHASE', 'PROVIDER_PHASE'],
  ['nativeForkedFromSessionId', 'providerForkedFromSessionId'],
  ['NativeForkedFromSessionId', 'ProviderForkedFromSessionId'],
  ['nativeParentSessionId', 'providerParentSessionId'],
  ['NativeParentSessionId', 'ProviderParentSessionId'],
  ['nativeSessionTreeId', 'providerSessionTreeId'],
  ['NativeSessionTreeId', 'ProviderSessionTreeId'],
  ['nativeDirectoryFingerprint', 'providerSessionDirectoryFingerprint'],
  ['NativeDirectoryFingerprint', 'ProviderSessionDirectoryFingerprint'],
  ['nativeDirectoryIdentity', 'providerSessionDirectoryIdentity'],
  ['NativeDirectoryIdentity', 'ProviderSessionDirectoryIdentity'],
  ['nativeDirectoryName', 'providerSessionDirectoryName'],
  ['NativeDirectoryName', 'ProviderSessionDirectoryName'],
  ['nativeMessageId', 'providerMessageId'],
  ['NativeMessageId', 'ProviderMessageId'],
  ['native-forked-from-session-id', 'provider-forked-from-session-id'],
  ['native-parent-session-id', 'provider-parent-session-id'],
  ['native-session-tree-id', 'provider-session-tree-id'],
  ['native-directory-fingerprint', 'provider-session-directory-fingerprint'],
  ['native-directory-identity', 'provider-session-directory-identity'],
  ['native-directory-name', 'provider-session-directory-name'],
  ['native-message-id', 'provider-message-id'],
  ['NATIVE_SESSION', 'PROVIDER_SESSION'],
  ['NativeSession', 'ProviderSession'],
  ['nativeSession', 'providerSession'],
  ['native_session', 'provider_session'],
  ['native-session', 'provider-session'],
  ['NATIVE_ACTIVITY', 'PROVIDER_ACTIVITY'],
  ['NativeActivity', 'ProviderActivity'],
  ['nativeActivity', 'providerActivity'],
  ['native_activity', 'provider_activity'],
  ['native-activity', 'provider-activity'],
  ['nativeObservedAt', 'providerObservedAt'],
  ['NativeObservedAt', 'ProviderObservedAt'],
  ['nativeFreshUntil', 'providerFreshUntil'],
  ['NativeFreshUntil', 'ProviderFreshUntil'],
  ['native_phase', 'provider_phase'],
  ['nativePhase', 'providerPhase'],
  ['NativePhase', 'ProviderPhase'],
  ['provider-native identifiers', 'provider Session identifiers'],
  ['Provider-native identifiers', 'Provider Session identifiers'],
  ['provider-native identities', 'provider Session identities'],
  ['Provider-native identities', 'Provider Session identities'],
  ['provider-native identity', 'provider Session identity'],
  ['Provider-native identity', 'Provider Session identity'],
  ['provider-native session', 'provider Session'],
  ['Provider-native session', 'Provider Session'],
  ['provider/native identity', 'provider Session identity'],
  ['provider/native session', 'provider Session'],
  ['cross-tenant native identity', 'cross-tenant provider Session identity'],
  ['Cross-tenant native identity', 'Cross-tenant provider Session identity'],
  ['native directory identity', 'provider Session directory identity'],
  ['Native directory identity', 'Provider Session directory identity'],
  ['native identity', 'provider Session identity'],
  ['Native identity', 'Provider Session identity'],
  ['native history', 'provider Session history'],
  ['Native history', 'Provider Session history'],
  ['native provider sessions', 'provider Sessions'],
  ['Native provider sessions', 'Provider Sessions'],
  ['native provider session', 'provider Session'],
  ['Native provider session', 'Provider Session'],
  ['provider-native snapshots', 'provider Session snapshots'],
  ['Provider-native snapshots', 'Provider Session snapshots'],
  ['provider-native snapshot', 'provider Session snapshot'],
  ['Provider-native snapshot', 'Provider Session snapshot'],
  ['provider-native runtime observations', 'provider Session runtime observations'],
  ['Provider-native runtime observations', 'Provider Session runtime observations'],
  ['provider-native runtime observation', 'provider Session runtime observation'],
  ['Provider-native runtime observation', 'Provider Session runtime observation'],
  ['provider-native runtime activity', 'provider Session runtime activity'],
  ['Provider-native runtime activity', 'Provider Session runtime activity'],
  ['native runtime bindings', 'provider Session runtime bindings'],
  ['Native runtime bindings', 'Provider Session runtime bindings'],
  ['native runtime binding', 'provider Session runtime binding'],
  ['Native runtime binding', 'Provider Session runtime binding'],
  ['kernel-native binding metadata', 'kernel-owned binding metadata'],
  ['Kernel-native binding metadata', 'Kernel-owned binding metadata'],
  ['kernel-native durable session id', 'kernel-owned durable Session ID'],
  ['Kernel-native durable session id', 'Kernel-owned durable Session ID'],
  ['native activity', 'provider activity'],
  ['Native Activity', 'Provider Activity'],
  ['native ids', 'provider Session IDs'],
  ['Native ids', 'Provider Session IDs'],
  ['native id', 'provider Session ID'],
  ['Native id', 'Provider Session ID'],
  ['provider-provider observations', 'provider activity observations'],
  ['Provider-provider observations', 'Provider activity observations'],
  ['provider-provider observation', 'provider activity observation'],
  ['Provider-provider observation', 'Provider activity observation'],
  ['provider-provider evidence', 'provider activity evidence'],
  ['Provider-provider evidence', 'Provider activity evidence'],
  ['Native Session', 'Provider Session'],
  ['Native-session', 'Provider Session'],
  ['native Session', 'provider Session'],
  ['native-Session', 'provider Session'],
  ['Native session', 'Provider Session'],
  ['native session', 'provider Session'],
  ['fresh native evidence', 'fresh provider evidence'],
  ['native evidence', 'provider evidence'],
  ['Native observations', 'Provider observations'],
  ['native observations', 'provider observations'],
  ['native observation', 'provider observation'],
  ['native transcript', 'provider transcript'],
  ['native inventory', 'provider inventory'],
];

export const LEGACY_PROVIDER_SESSION_IDENTITY_PATTERN =
  /native(?:ForkedFromSessionId|ParentSessionId|Session|Activity|History|Identity|Inventory|Transcript|SyncSession|Sync|Observation|Directory(?:Fingerprint|Identity|Name)|MessageId|ObservedAt|FreshUntil|Phase)|native_(?:forked_from_session_id|parent_session_id|session|activity|history|identity|inventory|transcript|sync_session|sync|observation|directory_(?:fingerprint|identity|name)|message_id|phase)|native-(?:forked-from-session-id|parent-session-id|session|activity|history|identity|inventory|transcript|sync-session|sync|observation|directory-(?:fingerprint|identity|name)|message-id)|provider(?:Native|Provider)Session|provider_(?:native|provider)_session|provider-(?:native|provider)-session|(?:session|runtime_binding|item)\.native\.|provider-native (?:session|snapshots?|runtime (?:observations?|activity)|identit(?:y|ies)|identifiers?)|provider\/native (?:identity|session)|cross-tenant native identity|native directory identity|native runtime bindings?|kernel-native (?:binding metadata|durable session id)|provider-provider (?:observations?|evidence)|(?:Native|native) session|(?:Native|native) observations?|native provider sessions?|native (?:id|ids|history|identity|activity|evidence|transcript|inventory)/giu;

function normalizePath(filePath) {
  return filePath.replace(/\\/gu, '/');
}

export function isProviderSessionIdentityExemptPath(filePath) {
  const normalized = normalizePath(filePath);
  return EXEMPT_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function replaceProviderSessionIdentityText(content) {
  let output = content;
  for (const [legacy, canonical] of PROVIDER_SESSION_IDENTITY_REPLACEMENTS) {
    output = output.split(legacy).join(canonical);
  }
  return output;
}

export function replaceProviderSessionIdentityPath(filePath) {
  return filePath
    .replaceAll('nativeDirectory', 'providerSessionDirectory')
    .replaceAll('nativeActivity', 'providerActivity')
    .replaceAll('NativeSession', 'ProviderSession')
    .replaceAll('native_forked_from_session', 'provider_forked_from_session')
    .replaceAll('native_parent_session', 'provider_parent_session')
    .replaceAll('native_directory', 'provider_session_directory')
    .replaceAll('native_session', 'provider_session')
    .replaceAll('native-activity', 'provider-activity')
    .replaceAll('native-session', 'provider-session');
}

function isDerivedSdkPath(filePath) {
  const normalized = normalizePath(filePath);
  return /\/sdks\/[^/]+\/openapi\/[^/]+\.(?:openapi|sdkgen)\.ya?ml$/u.test(normalized);
}

function walkTextFiles(root, { includeGenerated }) {
  const files = [];
  const stack = [path.resolve(root)];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        if (!includeGenerated && GENERATED_DIRECTORIES.has(entry.name)) continue;
        stack.push(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      const filePath = path.join(current, entry.name);
      if (isProviderSessionIdentityExemptPath(filePath)) continue;
      if (!includeGenerated && isDerivedSdkPath(filePath)) continue;
      files.push(filePath);
    }
  }
  return files.sort();
}

function resolveProviderSessionRoots(root) {
  const resolvedRoot = path.resolve(root);
  if (PROVIDER_SESSION_REPOSITORIES.has(path.basename(resolvedRoot))) {
    return [resolvedRoot];
  }
  return [...PROVIDER_SESSION_REPOSITORIES]
    .map((repoName) => path.join(resolvedRoot, repoName))
    .filter((repoRoot) => fs.existsSync(repoRoot))
    .sort();
}

export function collectLegacyProviderSessionIdentity(root, { includeGenerated = true } = {}) {
  const violations = [];
  const files = resolveProviderSessionRoots(root)
    .flatMap((repoRoot) => walkTextFiles(repoRoot, { includeGenerated }));
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const match of content.matchAll(LEGACY_PROVIDER_SESSION_IDENTITY_PATTERN)) {
      const line = content.slice(0, match.index).split(/\r?\n/u).length;
      violations.push({ filePath, legacy: match[0], line });
    }
    const canonicalPath = replaceProviderSessionIdentityPath(filePath);
    if (canonicalPath !== filePath) {
      violations.push({ filePath, legacy: path.basename(filePath), line: 0 });
    }
  }
  return violations;
}

export function migrateProviderSessionIdentity(root, { write = false } = {}) {
  const changes = [];
  const files = resolveProviderSessionRoots(root)
    .flatMap((repoRoot) => walkTextFiles(repoRoot, { includeGenerated: false }));
  for (const filePath of files) {
    const before = fs.readFileSync(filePath, 'utf8');
    const after = replaceProviderSessionIdentityText(before);
    const canonicalPath = replaceProviderSessionIdentityPath(filePath);
    if (before === after && canonicalPath === filePath) continue;

    if (write) {
      if (after !== before) fs.writeFileSync(filePath, after, 'utf8');
      if (canonicalPath !== filePath) {
        if (fs.existsSync(canonicalPath)) {
          throw new Error(`Cannot rename ${filePath}: target already exists at ${canonicalPath}`);
        }
        fs.renameSync(filePath, canonicalPath);
      }
    }
    changes.push({
      contentChanged: before !== after,
      filePath,
      targetPath: canonicalPath,
    });
  }
  return changes;
}
