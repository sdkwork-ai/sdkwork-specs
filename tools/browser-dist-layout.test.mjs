#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  browserDistEnvAlias,
  resolveBrowserDistOutDir,
  resolveInstalledBrowserWebRoot,
} from './browser-dist-layout.mjs';

test('maps lifecycle environments to dist path segments', () => {
  assert.equal(browserDistEnvAlias('development'), 'dev');
  assert.equal(browserDistEnvAlias('production'), 'prod');
  assert.equal(resolveBrowserDistOutDir('test'), 'dist/standalone/test');
  assert.equal(resolveBrowserDistOutDir('staging'), 'dist/standalone/staging');
});

test('rejects unknown environments', () => {
  assert.throws(() => resolveBrowserDistOutDir('dev'), /must be one of/);
});

test('selects dist layout per deployment profile', () => {
  assert.equal(resolveBrowserDistOutDir('production'), 'dist/standalone/prod');
  assert.equal(resolveBrowserDistOutDir('production', 'standalone'), 'dist/standalone/prod');
  assert.equal(resolveBrowserDistOutDir('production', 'cloud'), 'dist/cloud/prod');
  assert.equal(resolveBrowserDistOutDir('development', 'cloud'), 'dist/cloud/dev');
  assert.equal(resolveBrowserDistOutDir('test', 'cloud'), 'dist/cloud/test');
  assert.equal(resolveBrowserDistOutDir('staging', 'cloud'), 'dist/cloud/staging');
  assert.throws(() => resolveBrowserDistOutDir('prod', 'hybrid'), /must be one of/);
});

test('resolves installed Adaptive Web roots', () => {
  assert.equal(resolveInstalledBrowserWebRoot('webserver', 'pc'), '/usr/share/sdkwork/webserver/web/pc');
  assert.equal(resolveInstalledBrowserWebRoot('webserver', 'h5'), '/usr/share/sdkwork/webserver/web/h5');
  assert.equal(
    resolveInstalledBrowserWebRoot('webserver', 'static'),
    '/usr/share/sdkwork/webserver/web/static',
  );
});
