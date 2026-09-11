import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  CANONICAL_HTTP_ROUTE_PREFIX,
  legacyFoundationPcReactName,
  legacyHttpRouteCrateName,
} from './lib/naming-patterns.mjs';

const CHECKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'check-identity-naming.mjs');

function runChecker(root, mode = 'consumer') {
  return spawnSync(process.execPath, [CHECKER, '--root', root, '--mode', mode], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
}

describe('check-identity-naming route crate prefix', () => {
  it('rejects non-canonical legacy HTTP route crate names in consumer mode', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-identity-route-crate-'));
    const legacyCrate = legacyHttpRouteCrateName('video', 'open-api');
    const cratesDir = path.join(root, 'crates', legacyCrate);
    mkdirSync(cratesDir, { recursive: true });
    writeFileSync(path.join(cratesDir, 'Cargo.toml'), `name = "${legacyCrate}"\n`);

    const result = runChecker(root, 'consumer');

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /sdkwork-routes-/);
  });

  it('accepts canonical sdkwork-routes-* HTTP route crates in consumer mode', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-identity-route-crate-'));
    const canonicalCrate = `${CANONICAL_HTTP_ROUTE_PREFIX}video-open-api`;
    const cratesDir = path.join(root, 'crates', canonicalCrate);
    mkdirSync(cratesDir, { recursive: true });
    writeFileSync(path.join(cratesDir, 'Cargo.toml'), `name = "${canonicalCrate}"\n`);

    const result = runChecker(root, 'consumer');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /identity naming ok/);
  });

  it('accepts a responsibility-specific edge runtime under crates', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-identity-edge-runtime-'));
    const crateDir = path.join(root, 'crates', 'sdkwork-demo-device-edge-runtime');
    mkdirSync(crateDir, { recursive: true });
    writeFileSync(
      path.join(crateDir, 'Cargo.toml'),
      'name = "sdkwork-demo-device-edge-runtime"\n',
    );

    const result = runChecker(root, 'consumer');

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects generic runtime crates and edge runtimes outside crates', () => {
    const genericRoot = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-identity-runtime-'));
    const genericDir = path.join(genericRoot, 'crates', 'sdkwork-demo-runtime');
    mkdirSync(genericDir, { recursive: true });
    writeFileSync(path.join(genericDir, 'Cargo.toml'), 'name = "sdkwork-demo-runtime"\n');

    const genericResult = runChecker(genericRoot, 'consumer');
    assert.notEqual(genericResult.status, 0);
    assert.match(genericResult.stderr, /forbidden generic Rust runtime crate/u);

    const misplacedRoot = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-identity-edge-runtime-'));
    const misplacedDir = path.join(
      misplacedRoot,
      'services',
      'sdkwork-demo-device-edge-runtime',
    );
    mkdirSync(misplacedDir, { recursive: true });
    writeFileSync(
      path.join(misplacedDir, 'Cargo.toml'),
      'name = "sdkwork-demo-device-edge-runtime"\n',
    );

    const misplacedResult = runChecker(misplacedRoot, 'consumer');
    assert.notEqual(misplacedResult.status, 0);
    assert.match(misplacedResult.stderr, /must live under crates/u);
  });

  it('accepts canonical appbase foundation PC React packages in consumer mode', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-identity-route-crate-'));
    const pkgDir = path.join(root, 'packages', 'sdkwork-shell-pc-react');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"sdkwork-shell-pc-react"}\n');

    const result = runChecker(root, 'consumer');

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects non-canonical appbase foundation PC React package names in consumer mode', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-identity-foundation-pc-react-'));
    const legacyFoundation = legacyFoundationPcReactName();
    const pkgDir = path.join(root, 'packages', legacyFoundation);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(path.join(pkgDir, 'package.json'), `{"name":"${legacyFoundation}"}\n`);

    const result = runChecker(root, 'consumer');

    assert.notEqual(result.status, 0, 'expected checker failure');
    assert.match(result.stderr, /sdkwork-shell-pc-react|sdkwork-workspace-pc-react/);
  });

  it('accepts API assembly crate names in standards mode', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-identity-standards-'));
    writeFileSync(path.join(root, 'README.md'), '# Standards\nrepository-kind: standards\n');
    writeFileSync(
      path.join(root, 'APPLICATION_GATEWAY_SPEC.md'),
      [
        '# Application Gateway Standard',
        '',
        'API assembly crates use `sdkwork-api-<application-code>-assembly`.',
        '',
      ].join('\n'),
    );

    const result = runChecker(root, 'standards');

    assert.equal(result.status, 0, result.stderr);
  });

  it('rejects active gateway assembly terminology in standards mode', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-identity-standards-'));
    writeFileSync(path.join(root, 'README.md'), '# Standards\nrepository-kind: standards\n');
    writeFileSync(
      path.join(root, 'APPLICATION_GATEWAY_SPEC.md'),
      '# Gateway\n\nEvery application uses a gateway assembly for route composition.\n',
    );

    const result = runChecker(root, 'standards');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /retired gateway assembly identity/u);
  });

  it('rejects deleted repository identities in active standards examples', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-identity-standards-'));
    writeFileSync(path.join(root, 'README.md'), '# Standards\nrepository-kind: standards\n');
    writeFileSync(
      path.join(root, 'NAMING_SPEC.md'),
      '# Naming\n\nExample: `sdkwork-commerce (deleted)-app-api`.\n',
    );

    const result = runChecker(root, 'standards');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /deleted repository identity/u);
  });

  it('rejects an unqualified shared gateway in root authority documents', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sdkwork-identity-standards-'));
    writeFileSync(path.join(root, 'README.md'), '# Standards\nrepository-kind: standards\n');
    writeFileSync(
      path.join(root, 'APP_INTEGRATION_CONVENTIONS.md'),
      '# Integration\n\nApplications connect to the shared gateway.\n',
    );

    const result = runChecker(root, 'standards');

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ambiguous gateway role/u);
  });
});
