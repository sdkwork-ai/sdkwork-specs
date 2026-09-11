// Surgical `.env` reader/writer for CORS alignment (CORS_SPEC.md section 6).
//
// `etc/topology/*.env` files are hand-curated: they carry header comments and a
// deliberate key order. An aligner must rewrite one allowlist value and leave
// every other byte alone, so this module models the file as ordered lines and
// only substitutes the affected entry.

/** Keys that anchor where a newly inserted allowlist belongs. */
const PREFERRED_ANCHORS = ['SDKWORK_ENVIRONMENT', 'SDKWORK_DEPLOYMENT_PROFILE', 'SDKWORK_PROFILE_ID'];

const ENTRY = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u;

/**
 * Parse an env document into ordered lines plus an index of assignable entries.
 * Duplicate keys are reported rather than silently collapsed: a duplicated
 * allowlist is a real defect that changes which value the shell keeps.
 */
export function parseEnvDocument(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/u);
  const entries = [];
  const byKey = new Map();
  for (const [index, line] of lines.entries()) {
    const match = ENTRY.exec(line);
    if (!match) continue;
    const entry = { key: match[1], value: match[2], line: index };
    entries.push(entry);
    if (byKey.has(entry.key)) byKey.get(entry.key).duplicate = true;
    else byKey.set(entry.key, entry);
  }
  return { eol, lines, entries, byKey };
}

export function envValue(document, key) {
  const entry = document.byKey.get(key);
  return entry ? entry.value : null;
}

export function envKeys(document) {
  return [...document.byKey.keys()];
}

/**
 * Apply key updates to a parsed document.
 *
 * `updates` maps a key to its new raw value, or to `null` to delete the entry.
 * Existing keys are replaced in place; missing keys are inserted after the
 * first preferred anchor, otherwise appended at the end. Returns the new text
 * and whether anything actually changed.
 */
export function applyEnvUpdates(document, updates) {
  const { eol } = document;
  const replacements = new Map();
  const deletedKeys = new Set();
  const pending = new Map();
  let changed = false;

  for (const [key, value] of updates.entries()) {
    const entry = document.byKey.get(key);
    if (!entry) {
      if (value !== null) pending.set(key, value);
      continue;
    }
    if (value === null) {
      deletedKeys.add(key);
      changed = true;
      continue;
    }
    if (entry.value === value) continue;
    replacements.set(entry.line, `${key}=${value}`);
    changed = true;
  }

  // Rebuild once so every surviving line keeps its original index in the
  // output; a deletion must never shift a later replacement onto a stale line.
  const lines = [];
  const anchorIndex = new Map();
  for (const [index, line] of document.lines.entries()) {
    const match = ENTRY.exec(line);
    const key = match ? match[1] : null;
    if (key !== null && deletedKeys.has(key)) continue;
    anchorIndex.set(key, lines.length);
    lines.push(replacements.has(index) ? replacements.get(index) : line);
  }

  // `split` yields a trailing empty element for a newline-terminated file.
  // Keep it as the file terminator instead of appending after it.
  const trailingBlank = lines.length > 0 && lines[lines.length - 1] === '';
  const content = trailingBlank ? lines.slice(0, -1) : lines;

  if (pending.size > 0) {
    let insertAt = content.length;
    for (const anchor of PREFERRED_ANCHORS) {
      if (anchorIndex.has(anchor)) { insertAt = anchorIndex.get(anchor) + 1; break; }
    }
    while (insertAt < content.length && content[insertAt].trim() === '') insertAt += 1;
    content.splice(insertAt, 0, ...[...pending.entries()].map(([key, value]) => `${key}=${value}`));
    changed = true;
  }

  return { text: (trailingBlank ? [...content, ''] : content).join(eol), changed };
}

/** Convenience wrapper returning the full rewritten file text. */
export function rewriteEnvOrigins(text, updates) {
  const document = parseEnvDocument(text);
  return applyEnvUpdates(document, updates);
}
