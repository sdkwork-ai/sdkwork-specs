import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RETIRED_LETSENCRYPT_CERT_ROOT,
  SDKWORK_LETSENCRYPT_CERT_ROOT,
  isRetiredCertPath,
  isSdkworkLetsencryptCertPath,
  letsencryptCertPaths,
  letsencryptCertificateBlock,
} from './cert-paths.mjs';

test('letsencryptCertPaths uses canonical SDKWork root', () => {
  assert.deepEqual(letsencryptCertPaths('im.sdkwork.com'), {
    certFile: '/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/fullchain.pem',
    certKeyFile: '/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/privkey.pem',
    chainFile: '/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/chain.pem',
  });
});

test('letsencryptCertificateBlock adds ocspStapling', () => {
  const block = letsencryptCertificateBlock('sdkwork.com');
  assert.equal(block.ocspStapling, true);
  assert.equal(block.certFile, '/etc/sdkwork/certs/letsencrypt/sdkwork.com/fullchain.pem');
});

test('isRetiredCertPath rejects bootstrap live root', () => {
  assert.equal(isRetiredCertPath(`${RETIRED_LETSENCRYPT_CERT_ROOT}/im.sdkwork.com/fullchain.pem`), true);
  assert.equal(isRetiredCertPath('/etc/sdkwork/certs/letsencrypt/im.sdkwork.com/fullchain.pem'), false);
});

test('isSdkworkLetsencryptCertPath accepts canonical paths only', () => {
  assert.equal(isSdkworkLetsencryptCertPath(`${SDKWORK_LETSENCRYPT_CERT_ROOT}/skubc.com/privkey.pem`), true);
  assert.equal(isSdkworkLetsencryptCertPath(`${RETIRED_LETSENCRYPT_CERT_ROOT}/skubc.com/privkey.pem`), false);
});
