// Platform-wide TLS certificate registry (single copy in server.common.toml).

import { DEFAULT_PRODUCT_BASE_DOMAINS } from './host-registry.mjs';
import { letsencryptCertificateBlock } from './cert-paths.mjs';

/** Canonical certificate blocks for every registered product base domain. */
export function platformCertificateRegistry(baseDomains = DEFAULT_PRODUCT_BASE_DOMAINS) {
  const certificates = {};
  for (const baseDomain of baseDomains) {
    certificates[baseDomain] = letsencryptCertificateBlock(baseDomain);
  }
  return certificates;
}
