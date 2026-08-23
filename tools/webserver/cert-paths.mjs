// Canonical TLS certificate filesystem layout per NGINX_SPEC.md / SDKWORK_WEBSERVER_SPEC.md.

/** Retired bootstrap path; MUST NOT appear in new configuration. */
export const RETIRED_LETSENCRYPT_CERT_ROOT = '/opt/certs/letsencrypt/live';

/** SDKWork-managed Let's Encrypt certificate store on production hosts. */
export const SDKWORK_LETSENCRYPT_CERT_ROOT = '/etc/sdkwork/certs/letsencrypt';

export function letsencryptCertPaths(certName, certRoot = SDKWORK_LETSENCRYPT_CERT_ROOT) {
  const base = `${certRoot}/${certName}`;
  return {
    certFile: `${base}/fullchain.pem`,
    certKeyFile: `${base}/privkey.pem`,
    chainFile: `${base}/chain.pem`,
  };
}

export function letsencryptCertificateBlock(certName, certRoot = SDKWORK_LETSENCRYPT_CERT_ROOT) {
  return {
    ...letsencryptCertPaths(certName, certRoot),
    ocspStapling: true,
  };
}

export function isRetiredCertPath(value) {
  return typeof value === 'string' && value.includes(RETIRED_LETSENCRYPT_CERT_ROOT);
}

export function isSdkworkLetsencryptCertPath(value) {
  return typeof value === 'string' && value.startsWith(`${SDKWORK_LETSENCRYPT_CERT_ROOT}/`);
}
