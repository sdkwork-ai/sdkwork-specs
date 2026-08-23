// Serialize layout v2 webserver TOML documents (SDKWORK_WEBSERVER_SPEC.md §3.2 subset).

function tomlKey(name) {
  return /^[a-zA-Z0-9_-]+$/u.test(name) ? name : JSON.stringify(name);
}

function escapeString(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function formatValue(value) {
  if (typeof value === 'string') return escapeString(value);
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${value.map((item) => (typeof item === 'string' ? escapeString(item) : String(item))).join(', ')}]`;
  }
  throw new Error(`cannot serialize value of type ${typeof value}`);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emitArrayOfTables(lines, parentPath, array) {
  for (const element of array) {
    if (!isPlainObject(element)) continue;
    lines.push(`[[${parentPath}]]`);
    const rest = emitTableInto(lines, element, '');
    lines.push('');
    for (const [childKey, childTable] of rest.childTables) {
      lines.push(`[${parentPath}.${tomlKey(childKey)}]`);
      emitTableInto(lines, childTable, '');
      lines.push('');
    }
    for (const [childKey, childArray] of rest.childArrays) {
      emitArrayOfTables(lines, `${parentPath}.${tomlKey(childKey)}`, childArray);
    }
  }
}

function emitTableInto(lines, table, prefix) {
  const childTables = [];
  const childArrays = [];
  for (const [key, value] of Object.entries(table)) {
    if (Array.isArray(value)) {
      const isLeafArray = value.every((item) => !isPlainObject(item));
      if (isLeafArray) {
        lines.push(`${prefix}${key} = ${formatValue(value)}`);
      } else {
        childArrays.push([key, value]);
      }
    } else if (value !== null && typeof value === 'object') {
      childTables.push([key, value]);
    } else {
      lines.push(`${prefix}${key} = ${formatValue(value)}`);
    }
  }
  return { childTables, childArrays };
}

export function serializeToml(doc) {
  const lines = [];
  const scalars = [];
  const tables = [];
  const arraysOfTables = [];
  for (const [key, value] of Object.entries(doc)) {
    if (value === null || typeof value === 'object') {
      if (Array.isArray(value)) arraysOfTables.push([key, value]);
      else tables.push([key, value]);
    } else {
      scalars.push([key, value]);
    }
  }
  for (const [key, value] of scalars) lines.push(`${key} = ${formatValue(value)}`);
  if (scalars.length > 0) lines.push('');
  for (const [key, table] of tables) {
    if (!isPlainObject(table)) continue;
    lines.push(`[${key}]`);
    const rest = emitTableInto(lines, table, '');
    lines.push('');
    for (const [childKey, childTable] of rest.childTables) {
      lines.push(`[${key}.${tomlKey(childKey)}]`);
      const inner = emitTableInto(lines, childTable, '');
      lines.push('');
      for (const [ck, ct] of inner.childTables) {
        lines.push(`[${key}.${tomlKey(childKey)}.${tomlKey(ck)}]`);
        emitTableInto(lines, ct, '');
        lines.push('');
      }
      for (const [ck, ca] of inner.childArrays) {
        emitArrayOfTables(lines, `${key}.${tomlKey(childKey)}.${tomlKey(ck)}`, ca);
      }
    }
    for (const [childKey, childArray] of rest.childArrays) {
      emitArrayOfTables(lines, `${key}.${tomlKey(childKey)}`, childArray);
    }
  }
  for (const [key, array] of arraysOfTables) {
    emitArrayOfTables(lines, key, array);
  }
  return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n')}\n`;
}
