// Expand shared http.defaults into effective server blocks before validate/render.

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Apply `[http.defaults]` overlays (TLS, etc.) and strip the defaults table.
 * @param {object} doc effective merged configuration
 * @returns {object}
 */
export function expandHttpDefaults(doc) {
  const defaults = doc.http?.defaults;
  if (!isPlainObject(defaults)) return doc;

  const next = structuredClone(doc);
  if (isPlainObject(defaults.tls)) {
    for (const server of next.http?.server ?? []) {
      if (isPlainObject(server.tls)) {
        server.tls = { ...defaults.tls, ...server.tls };
      }
    }
  }
  delete next.http.defaults;
  return next;
}
