// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  commandLineReferencesWorkspace,
  parseStopWorkspaceArgs,
  selectWorkspaceProcessRoots,
  stopWorkspaceProcesses,
} from './stop-sdkwork-workspace-processes.mjs';

// The parsing assertions below exercise Windows command lines, so those fixtures
// must be absolute and carry a drive letter (`E:/...` -> `E:\...` normalization
// and sibling-prefix matching are what is under test). They are test data, not a
// source/build binding, hence the exemption marker.
// WORKSPACE-PATH:allow
const WINDOWS_ROOT = 'E:/sdkwork-space';
const WINDOWS_IM = `${WINDOWS_ROOT}/sdkwork-im`;

// `stopWorkspaceProcesses` refuses a workspace root that does not exist, so the
// tests that call it need a real directory. Deriving one from the OS temp dir
// keeps the suite independent of where the workspace is checked out — the
// previous version hardcoded one machine's `E:` checkout and had been failing
// with "workspace path does not exist" ever since the workspace moved.
const REAL_ROOT = mkdtempSync(path.join(tmpdir(), 'sdkwork-stop-'));
const REAL_IM = path.join(REAL_ROOT, 'sdkwork-im').replaceAll('\\', '/');
mkdirSync(REAL_IM, { recursive: true });
process.on('exit', () => rmSync(REAL_ROOT, { recursive: true, force: true }));

test('parses the workspace stop command options', () => {
  assert.deepEqual(parseStopWorkspaceArgs(['--workspace', WINDOWS_IM, '--dry-run']), {
    // WORKSPACE-PATH:allow — expected backslash form of the drive-letter fixture above.
    workspaceRoot: 'E:\\sdkwork-space\\sdkwork-im', dryRun: true, help: false,
  });
});

test('does not confuse a workspace path with a similarly named sibling', () => {
  assert.equal(commandLineReferencesWorkspace(WINDOWS_IM, `node ${WINDOWS_IM}/scripts/dev.mjs`), true);
  assert.equal(commandLineReferencesWorkspace(WINDOWS_IM, `node ${WINDOWS_ROOT}/sdkwork-image/scripts/dev.mjs`), false);
});

test('selects only workspace process-tree roots and excludes the stopper itself', () => {
  const selected = selectWorkspaceProcessRoots([
    { Id: 101, ParentProcessId: 1, Name: 'node.exe', CommandLine: `node ${WINDOWS_IM}/scripts/dev.mjs` },
    { Id: 102, ParentProcessId: 101, Name: 'node.exe', CommandLine: `node ${WINDOWS_IM}/node_modules/vite/bin/vite.js` },
    { Id: 103, ParentProcessId: 1, Name: 'node.exe', CommandLine: `node ${WINDOWS_ROOT}/sdkwork-image/scripts/dev.mjs` },
    { Id: 104, ParentProcessId: 1, Name: 'node.exe', CommandLine: `node ${WINDOWS_IM}/sdkwork-specs/tools/stop-sdkwork-workspace-processes.mjs` },
  ], { workspaceRoot: WINDOWS_IM, currentPid: 104 });
  assert.deepEqual(selected.map((processInfo) => processInfo.Id), [101]);
});

test('selects Windows CIM processes by ProcessId', () => {
  const selected = selectWorkspaceProcessRoots([
    {
      ProcessId: 111,
      ParentProcessId: 1,
      Name: 'cargo.exe',
      CommandLine: `cargo run --manifest-path ${WINDOWS_IM}/Cargo.toml`,
    },
    {
      ProcessId: 112,
      ParentProcessId: 111,
      Name: 'sdkwork-api-im-standalone-gateway.exe',
      ExecutablePath: `${WINDOWS_IM}/target/debug/sdkwork-api-im-standalone-gateway.exe`,
    },
    {
      ProcessId: 113,
      ParentProcessId: 1,
      Name: 'wps.exe',
      ExecutablePath: 'C:/Program Files/WPS Office/wps.exe',
      CommandLine: `wps.exe /file=${WINDOWS_IM}/docs/review.zip`,
    },
  ], { workspaceRoot: WINDOWS_IM, currentPid: 999 });

  assert.deepEqual(selected.map((processInfo) => processInfo.ProcessId), [111]);
});

test('terminates only selected workspace process-tree roots', async () => {
  const terminated = [];
  await stopWorkspaceProcesses({
    workspaceRoot: REAL_IM,
    currentPid: 999,
    listProcesses: async () => [
      { Id: 201, ParentProcessId: 1, Name: 'node.exe', CommandLine: `node ${REAL_IM}/scripts/dev.mjs` },
      { Id: 202, ParentProcessId: 201, Name: 'node.exe', CommandLine: `node ${REAL_IM}/node_modules/vite/bin/vite.js` },
      { Id: 203, ParentProcessId: 1, Name: 'node.exe', CommandLine: `node ${REAL_ROOT.replaceAll('\\', '/')}/sdkwork-image/scripts/dev.mjs` },
    ],
    terminateProcess: async (processId) => terminated.push(processId),
  });

  assert.deepEqual(terminated, [201]);
});

test('attempts every selected process tree before reporting termination failures', async () => {
  const attempted = [];
  await assert.rejects(
    stopWorkspaceProcesses({
      workspaceRoot: REAL_IM,
      currentPid: 999,
      listProcesses: async () => [
        { Id: 301, ParentProcessId: 1, Name: 'node.exe', CommandLine: `node ${REAL_IM}/scripts/dev.mjs` },
        { Id: 302, ParentProcessId: 1, Name: 'cargo.exe', CommandLine: `cargo run --manifest-path ${REAL_IM}/Cargo.toml` },
      ],
      terminateProcess: async (processId) => {
        attempted.push(processId);
        if (processId === 301) throw new Error('already exiting');
      },
    }),
    /failed to stop 1 process tree/u,
  );

  assert.deepEqual(attempted, [301, 302]);
});
