/**
 * Shared patterns for SDKWork HTTP operation contract validation.
 * See API_SPEC.md section 15.4.
 */

import {
  isExternalProtocolOperation,
  openApiOperationEntriesFromText,
} from './openapi-operation-utils.mjs';

export function classifyOpenApiOperationPatterns(text) {
  const issues = [];
  const { document, entries } = openApiOperationEntriesFromText(text);
  for (const entry of entries) {
    if (isExternalProtocolOperation(entry.operation)) {
      continue;
    }
    issues.push(...classifyIdempotencyContract(entry, document));
    issues.push(...classifyOperation(entry));
  }
  issues.push(...classifyInt64StringContract(document));
  return issues;
}

/**
 * API_SPEC §13.6 int64-string closure: every `format: int64` schema property
 * and parameter MUST be `type: string` with `x-sdkwork-int64-string: true`
 * and a decimal digit pattern. `type: integer, format: int64` silently makes
 * generated TypeScript SDKs emit `number`, and browsers round ids past
 * Number.MAX_SAFE_INTEGER — the same 40401-style parent lookup failure class
 * observed repeatedly across workspaces.
 *
 * Exemption: an OpenAPI document may declare `x-sdkwork-int64-openai-compat:
 * true` when it mirrors a third-party wire protocol (OpenAI / Anthropic
 * compatible gateways). Those protocols require JSON numbers for Unix
 * timestamps, byte sizes, and seeds, and every such value stays below
 * Number.MAX_SAFE_INTEGER (2^53), so the browser rounding failure class does
 * not apply. The marker must be set on every authority and derived mirror;
 * API_SPEC §13.6 documents the exemption.
 */
function classifyInt64StringContract(document) {
  if (document && document['x-sdkwork-int64-openai-compat'] === true) {
    return [];
  }
  const issues = [];
  const schemas = (document && document.components && document.components.schemas) || {};
  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (!schema || typeof schema !== 'object') {
      continue;
    }
    const properties = (schema.properties && typeof schema.properties === 'object')
      ? schema.properties
      : {};
    for (const [propertyName, property] of Object.entries(properties)) {
      if (!property || typeof property !== 'object' || property.format !== 'int64') {
        continue;
      }
      const label = `${schemaName}.${propertyName}`;
      if (property.type === 'integer') {
        issues.push({
          kind: 'int64-integer-type',
          detail: `${label} MUST declare type: string (format: int64) per API_SPEC §13.6; type: integer makes browsers round ids past Number.MAX_SAFE_INTEGER`,
        });
      }
      if (property['x-sdkwork-int64-string'] !== true) {
        issues.push({
          kind: 'int64-string-marker-missing',
          detail: `${label} MUST declare x-sdkwork-int64-string: true per API_SPEC §13.6`,
        });
      }
    }
  }
  const paths = (document && document.paths) || {};
  for (const [routePath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operation || typeof operation !== 'object' || !Array.isArray(operation.parameters)) {
        continue;
      }
      for (const parameter of operation.parameters) {
        if (!parameter || typeof parameter !== 'object') {
          continue;
        }
        const schema = parameter.schema;
        if (!schema || typeof schema !== 'object' || schema.format !== 'int64') {
          continue;
        }
        const label = `${method.toUpperCase()} ${routePath} param ${parameter.name}`;
        if (schema.type === 'integer') {
          issues.push({
            kind: 'int64-integer-type',
            detail: `${label} MUST declare type: string (format: int64) per API_SPEC §13.6`,
          });
        }
        if (schema['x-sdkwork-int64-string'] !== true) {
          issues.push({
            kind: 'int64-string-marker-missing',
            detail: `${label} MUST declare x-sdkwork-int64-string: true per API_SPEC §13.6`,
          });
        }
      }
    }
  }
  return issues;
}

function classifyIdempotencyContract(entry, document) {
  const { routePath, method, operation } = entry;
  const issues = [];
  const operationLabel = `${method.toUpperCase()} ${routePath}`;
  const marker = operation['x-sdkwork-idempotent'];
  const parameters = [
    ...(Array.isArray(entry.pathParameters) ? entry.pathParameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ].map((parameter) => resolveParameter(parameter, document));
  const headers = parameters.filter((parameter) => (
    parameter
    && typeof parameter === 'object'
    && parameter.in === 'header'
    && typeof parameter.name === 'string'
    && parameter.name.toLowerCase() === 'idempotency-key'
  ));

  if (marker !== undefined && marker !== null && typeof marker !== 'boolean') {
    issues.push({
      kind: 'invalid-idempotency-marker',
      detail: `${operationLabel} x-sdkwork-idempotent must be a boolean`,
    });
  }
  if (marker === true && headers.length === 0) {
    issues.push({
      kind: 'idempotency-header-missing',
      detail: `${operationLabel} x-sdkwork-idempotent: true requires a required Idempotency-Key header parameter`,
    });
  }
  if (marker !== true && headers.length > 0) {
    issues.push({
      kind: 'idempotency-marker-missing',
      detail: `${operationLabel} Idempotency-Key requires x-sdkwork-idempotent: true on the same operation`,
    });
  }
  for (const header of headers) {
    if (header.name !== 'Idempotency-Key') {
      issues.push({
        kind: 'idempotency-header-name',
        detail: `${operationLabel} must use the canonical Idempotency-Key header spelling`,
      });
    }
    if (header.required !== true) {
      issues.push({
        kind: 'idempotency-header-required',
        detail: `${operationLabel} Idempotency-Key must be required`,
      });
    }
    const schema = header.schema && typeof header.schema === 'object' ? header.schema : {};
    if (
      schema.type !== 'string'
      || schema.minLength !== 1
      || schema.maxLength !== 128
    ) {
      issues.push({
        kind: 'idempotency-header-schema',
        detail: `${operationLabel} Idempotency-Key schema must be string with minLength 1 and maxLength 128`,
      });
    }
  }
  return issues;
}

function resolveParameter(parameter, document) {
  if (!parameter || typeof parameter !== 'object' || typeof parameter.$ref !== 'string') {
    return parameter;
  }
  const match = parameter.$ref.match(/^#\/components\/parameters\/([^/]+)$/u);
  if (!match) {
    return parameter;
  }
  const name = decodeURIComponent(match[1].replace(/~1/gu, '/').replace(/~0/gu, '~'));
  return document?.components?.parameters?.[name] ?? parameter;
}

function classifyOperation({ routePath, method, operation }) {
  const issues = [];
  const operationId = typeof operation.operationId === 'string' ? operation.operationId : '';
  const operationLabel = `${method.toUpperCase()} ${routePath}`;
  const operationRoot = operationId.split('.', 1)[0];
  const tags = Array.isArray(operation.tags)
    ? operation.tags.filter((tag) => typeof tag === 'string')
    : [];
  if (operationRoot && tags.includes(operationRoot)) {
    issues.push({
      kind: 'operation-id-tag-duplication',
      detail: `${operationLabel} operationId ${operationId} must not repeat tag ${operationRoot}`,
    });
  }

  const pattern = inferOpenApiOperationPattern(routePath, method, operation);
  if (!pattern) {
    return issues;
  }

  const finalAction = operationId.includes('.') ? operationId.split('.').at(-1) : operationId;

  if (!operationId || (pattern.expectedAction && finalAction !== pattern.expectedAction)) {
    issues.push({
      kind: 'operation-id-action',
      detail: `${operationLabel} must use operationId action ${pattern.expectedAction}`,
    });
  }

  const responses = operation.responses && typeof operation.responses === 'object' ? operation.responses : {};
  if (pattern.kind === 'create' && !hasStatus(responses, '201')) {
    issues.push({
      kind: 'create-status',
      detail: `${operationLabel} create operations must return HTTP 201 with SdkWorkApiResponse.data.item`,
    });
  }
  if (pattern.kind === 'delete') {
    if (!hasStatus(responses, '204') || hasJsonSuccessBody(responses, ['200', '201', '202'])) {
      issues.push({
        kind: 'delete-status',
        detail: `${operationLabel} delete operations must return HTTP 204 without a JSON success body`,
      });
    }
  }
  if (['retrieve', 'list', 'search', 'update'].includes(pattern.kind) && !hasStatus(responses, '200')) {
    issues.push({
      kind: `${pattern.kind}-status`,
      detail: `${operationLabel} ${pattern.kind} operations must return HTTP 200`,
    });
  }
  if (pattern.kind === 'command' && !hasAnyStatus(responses, ['200', '202'])) {
    issues.push({
      kind: 'command-status',
      detail: `${operationLabel} command operations must return HTTP 200 or 202`,
    });
  }
  if (pattern.kind === 'bulk' && !hasAnyStatus(responses, ['200', '202'])) {
    issues.push({
      kind: 'bulk-status',
      detail: `${operationLabel} bulk operations must return HTTP 200 or 202`,
    });
  }
  if (pattern.kind === 'stream' && !hasStatus(responses, '200')) {
    issues.push({
      kind: 'stream-status',
      detail: `${operationLabel} stream operations must return HTTP 200`,
    });
  }
  return issues;
}

export function inferOpenApiOperationPattern(routePath, method, operation) {
  const finalAction = finalOperationIdAction(operation);
  if (isInfrastructureProbePath(routePath) || isRedirectOnlyOperation(operation)) {
    return null;
  }
  if (isEventStreamOperation(operation)) {
    return { kind: 'stream', expectedAction: 'stream' };
  }
  if (method === 'get') {
    if (finalAction === 'list') {
      return { kind: 'list', expectedAction: 'list' };
    }
    if (
      finalAction === 'retrieve'
      || pathEndsWithParameter(routePath)
      || isSingletonReadSegment(finalPathSegment(routePath))
    ) {
      return { kind: 'retrieve', expectedAction: 'retrieve' };
    }
    return { kind: 'list', expectedAction: 'list' };
  }
  if (method === 'post') {
    if (isSearchPath(routePath)) {
      return { kind: 'search', expectedAction: 'search' };
    }
    if (isBulkPath(routePath)) {
      return { kind: 'bulk', expectedAction: bulkActionFromPath(routePath) };
    }
    const commandAction = commandActionFromPath(routePath, finalAction);
    if (commandAction) {
      return { kind: 'command', expectedAction: commandAction };
    }
    if (isNestedCollectionCreatePath(routePath, finalAction)) {
      return { kind: 'create', expectedAction: 'create' };
    }
    return { kind: 'create', expectedAction: 'create' };
  }
  if (method === 'put' || method === 'patch') {
    return { kind: 'update', expectedAction: 'update' };
  }
  if (method === 'delete') {
    return { kind: 'delete', expectedAction: 'delete' };
  }
  return null;
}

function finalOperationIdAction(operation) {
  const operationId = typeof operation?.operationId === 'string' ? operation.operationId : '';
  return operationId.includes('.') ? operationId.split('.').at(-1) : operationId;
}

function pathEndsWithParameter(routePath) {
  return /\/\{[^}/]+\}$/.test(routePath);
}

function isSearchPath(routePath) {
  return routePath.endsWith('/search') || routePath.endsWith(':search');
}

function isInfrastructureProbePath(routePath) {
  return /^\/(?:healthz|livez|readyz|metrics)$/u.test(routePath);
}

function isRedirectOnlyOperation(operation) {
  const statuses = Object.keys(operation?.responses ?? {});
  return statuses.some((status) => /^3\d\d$/u.test(status))
    && !statuses.some((status) => /^2\d\d$/u.test(status));
}

function isEventStreamOperation(operation) {
  const responses = operation?.responses && typeof operation.responses === 'object'
    ? operation.responses
    : {};
  return Object.entries(responses).some(([status, response]) => (
    /^2\d\d$/u.test(status)
    && response
    && typeof response === 'object'
    && response.content
    && Object.prototype.hasOwnProperty.call(response.content, 'text/event-stream')
  ));
}

function isBulkPath(routePath) {
  return /:bulk[A-Z][A-Za-z0-9]*$/.test(routePath) || /\/bulk_[a-z0-9_]+$/.test(routePath);
}

function commandActionFromPath(routePath, finalAction) {
  const colonAction = routePath.match(/:([a-z][A-Za-z0-9]*)$/);
  if (colonAction && colonAction[1] !== 'search' && !colonAction[1].startsWith('bulk')) {
    return colonAction[1];
  }
  const finalSegment = finalPathSegment(routePath);
  if (!finalSegment || isPathParameter(finalSegment)) {
    return null;
  }
  const pathAction = snakeToCamel(finalSegment);
  if (pathAction === finalAction && finalAction !== 'create') {
    return pathAction;
  }
  const suffixAction = snakeToCamel(finalSegment.split('_').at(-1) || '');
  if (
    suffixAction === finalAction
    && finalAction !== 'create'
    && COMMAND_ACTIONS.has(finalAction)
  ) {
    return finalAction;
  }
  if (isLikelyCommandSegment(finalSegment)) {
    return pathAction;
  }
  return null;
}

function isNestedCollectionCreatePath(routePath, finalAction) {
  if (finalAction !== 'create') {
    return false;
  }
  const segments = pathSegments(routePath);
  const finalSegment = segments.at(-1);
  return segments.some(isPathParameter) && isPluralResourceSegment(finalSegment);
}

function finalPathSegment(routePath) {
  const segments = pathSegments(routePath);
  return segments.at(-1) || '';
}

function pathSegments(routePath) {
  return String(routePath)
    .split('/')
    .filter((segment) => segment.length > 0);
}

function isPathParameter(segment) {
  return /^\{[^}/]+\}$/u.test(segment);
}

function isPluralResourceSegment(segment) {
  return typeof segment === 'string' && /s$/u.test(segment) && !isLikelyCommandSegment(segment);
}

function isSingletonReadSegment(segment) {
  const normalized = String(segment).replace(/^.*:/u, '');
  return SINGLETON_READ_SEGMENTS.has(snakeToCamel(normalized));
}

function isLikelyCommandSegment(segment) {
  const action = snakeToCamel(segment);
  return COMMAND_ACTIONS.has(action);
}

function bulkActionFromPath(routePath) {
  const colonAction = routePath.match(/:(bulk[A-Z][A-Za-z0-9]*)$/);
  if (colonAction) {
    return colonAction[1];
  }
  const slashAction = routePath.match(/\/(bulk_[a-z0-9_]+)$/);
  if (slashAction) {
    return snakeToCamel(slashAction[1]);
  }
  return null;
}

function snakeToCamel(value) {
  return value.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

const COMMAND_ACTIONS = new Set([
  'accept',
  'activate',
  'add',
  'approve',
  'archive',
  'cancel',
  'changeRole',
  'close',
  'complete',
  'convert',
  'deactivate',
  'heartbeat',
  'explain',
  'leave',
  'migrate',
  'preview',
  'publish',
  'refresh',
  'read',
  'rebuild',
  'reject',
  'remove',
  'restore',
  'revoke',
  'rollback',
  'submit',
  'sync',
  'transferOwner',
  'unpublish',
  'unpin',
  'verify',
]);

const SINGLETON_READ_SEGMENTS = new Set([
  'catalog',
  'current',
  'health',
  'ready',
  'resolve',
  'runtimeDefaults',
  'status',
  'summary',
  'sync',
  'usage',
]);

function hasStatus(responses, status) {
  return Object.prototype.hasOwnProperty.call(responses, status);
}

function hasAnyStatus(responses, statuses) {
  return statuses.some((status) => hasStatus(responses, status));
}

function hasJsonSuccessBody(responses, statuses) {
  return statuses.some((status) => {
    const response = responses[status];
    return Boolean(response && typeof response === 'object' && response.content);
  });
}
