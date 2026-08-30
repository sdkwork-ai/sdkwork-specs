import { openApiOperationEntriesFromDocument } from './openapi-operation-utils.mjs';
import { inferOpenApiOperationPattern } from './api-operation-patterns.mjs';

export function alignOpenApiOperationPatterns(document) {
  let changes = 0;
  for (const { routePath, method, operation } of openApiOperationEntriesFromDocument(document)) {
    if (
      operation?.['x-sdkwork-wire-protocol'] === 'external'
      && operation?.['x-sdkwork-external-protocol-id']
    ) {
      continue;
    }
    changes += alignIdempotencyContract(operation, document);
    changes += alignOperationIdTagDuplication(operation);
    const pattern = inferOpenApiOperationPattern(routePath, method, operation);
    if (!pattern) {
      continue;
    }
    changes += alignOperationId(operation, pattern.expectedAction);
    changes += alignResponses(operation, pattern.kind);
  }
  changes += alignInt64StringContract(document);
  return { document, changes };
}

/**
 * Strip a duplicated tag root from the operationId.
 * Canonical form: operationId starts with the resource noun; it must not repeat
 * the operation tag. See classifyOperation operation-id-tag-duplication.
 */
function alignOperationIdTagDuplication(operation) {
  if (typeof operation.operationId !== 'string' || !operation.operationId.includes('.')) {
    return 0;
  }
  const tags = Array.isArray(operation.tags)
    ? operation.tags.filter((tag) => typeof tag === 'string')
    : [];
  const root = operation.operationId.split('.', 1)[0];
  if (!tags.includes(root)) {
    return 0;
  }
  operation.operationId = operation.operationId.split('.').slice(1).join('.');
  return 1;
}

/**
 * Close the idempotency contract: every operation that declares
 * x-sdkwork-idempotent: true MUST carry a required Idempotency-Key header with a
 * canonical schema, and every Idempotency-Key header MUST be backed by the marker.
 * See classifyIdempotencyContract.
 */
function alignIdempotencyContract(operation, document) {
  let changes = 0;
  const marker = operation['x-sdkwork-idempotent'];
  const parameters = operation.parameters && Array.isArray(operation.parameters)
    ? operation.parameters
    : (operation.parameters = []);
  let header = null;
  for (const parameter of parameters) {
    const resolved = resolveParameter(parameter, document);
    if (
      resolved
      && typeof resolved === 'object'
      && resolved.in === 'header'
      && typeof resolved.name === 'string'
      && resolved.name.toLowerCase() === 'idempotency-key'
    ) {
      header = resolved;
      break;
    }
  }

  if (marker !== true && header) {
    // Header declares idempotency but the operation does not opt in.
    operation['x-sdkwork-idempotent'] = true;
    changes += 1;
  }
  if (marker === true && !header) {
    parameters.push(canonicalIdempotencyHeader());
    changes += 1;
  }
  if (header) {
    if (marker === true && header.name !== 'Idempotency-Key') {
      header.name = 'Idempotency-Key';
      changes += 1;
    }
    if (header.required !== true) {
      header.required = true;
      changes += 1;
    }
    const schema = header.schema && typeof header.schema === 'object'
      ? header.schema
      : (header.schema = {});
    if (schema.type !== 'string') {
      schema.type = 'string';
      changes += 1;
    }
    if (schema.minLength !== 1) {
      schema.minLength = 1;
      changes += 1;
    }
    if (schema.maxLength !== 128) {
      schema.maxLength = 128;
      changes += 1;
    }
  }
  return changes;
}

function canonicalIdempotencyHeader() {
  return {
    name: 'Idempotency-Key',
    in: 'header',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  };
}

function resolveParameter(parameter, document) {
  if (typeof parameter !== 'object' || typeof parameter.$ref !== 'string') {
    return parameter;
  }
  const match = parameter.$ref.match(/^#\/components\/parameters\/([^/]+)$/u);
  if (!match) {
    return parameter;
  }
  const name = decodeURIComponent(match[1].replace(/~1/gu, '/').replace(/~0/gu, '~'));
  return document?.components?.parameters?.[name] ?? parameter;
}

/**
 * Close the int64 string contract: every `format: int64` schema property and
 * parameter MUST be `type: string` with `x-sdkwork-int64-string: true`.
 * openai-compat documents are exempt. See classifyInt64StringContract.
 */
function alignInt64StringContract(document) {
  if (document?.['x-sdkwork-int64-openai-compat'] === true) {
    return 0;
  }
  let changes = 0;
  const schemas = (document?.components?.schemas) || {};
  for (const schema of Object.values(schemas)) {
    if (!schema || typeof schema !== 'object') {
      continue;
    }
    const properties = (schema.properties && typeof schema.properties === 'object')
      ? schema.properties
      : {};
    for (const property of Object.values(properties)) {
      if (!property || typeof property !== 'object' || property.format !== 'int64') {
        continue;
      }
      if (property.type !== 'string') {
        property.type = 'string';
        changes += 1;
      }
      if (property['x-sdkwork-int64-string'] !== true) {
        property['x-sdkwork-int64-string'] = true;
        changes += 1;
      }
    }
  }
  const paths = (document?.paths) || {};
  for (const pathItem of Object.values(paths)) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }
    for (const operation of Object.values(pathItem)) {
      if (!operation || typeof operation !== 'object' || !Array.isArray(operation.parameters)) {
        continue;
      }
      for (const parameter of operation.parameters) {
        const schema = parameter && typeof parameter === 'object' ? parameter.schema : null;
        if (!schema || typeof schema !== 'object' || schema.format !== 'int64') {
          continue;
        }
        if (schema.type !== 'string') {
          schema.type = 'string';
          changes += 1;
        }
        if (schema['x-sdkwork-int64-string'] !== true) {
          schema['x-sdkwork-int64-string'] = true;
          changes += 1;
        }
      }
    }
  }
  return changes;
}

function alignOperationId(operation, expectedAction) {
  if (!expectedAction || typeof operation.operationId !== 'string') {
    return 0;
  }
  const segments = operation.operationId.split('.');
  if (segments.at(-1) === expectedAction) {
    return 0;
  }
  segments[segments.length - 1] = expectedAction;
  operation.operationId = segments.join('.');
  return 1;
}

function alignResponses(operation, kind) {
  const responses = operation.responses && typeof operation.responses === 'object'
    ? operation.responses
    : (operation.responses = {});
  if (kind === 'create') {
    return moveSuccessResponse(responses, '201', ['200', '202']);
  }
  if (kind === 'delete') {
    return alignDeleteResponses(responses);
  }
  if (['retrieve', 'list', 'search', 'update', 'stream'].includes(kind)) {
    return moveSuccessResponse(responses, '200', ['201', '202']);
  }
  if (kind === 'command' || kind === 'bulk') {
    if (hasAnyStatus(responses, ['200', '202'])) {
      return 0;
    }
    return moveSuccessResponse(responses, '200', ['201']);
  }
  return 0;
}

function moveSuccessResponse(responses, targetStatus, sourceStatuses) {
  if (hasStatus(responses, targetStatus)) {
    return 0;
  }
  const sourceStatus = sourceStatuses.find((status) => hasStatus(responses, status));
  if (!sourceStatus) {
    return 0;
  }
  responses[targetStatus] = responses[sourceStatus];
  delete responses[sourceStatus];
  return 1;
}

function alignDeleteResponses(responses) {
  let changes = 0;
  if (!hasStatus(responses, '204')) {
    const sourceStatus = ['200', '201', '202'].find((status) => hasStatus(responses, status));
    const description = sourceStatus && typeof responses[sourceStatus]?.description === 'string'
      ? responses[sourceStatus].description
      : 'Deleted';
    responses['204'] = { description };
    changes += 1;
  } else if (responses['204']?.content) {
    delete responses['204'].content;
    changes += 1;
  }
  for (const status of ['200', '201', '202']) {
    if (hasStatus(responses, status)) {
      delete responses[status];
      changes += 1;
    }
  }
  return changes;
}

function hasStatus(responses, status) {
  return Object.prototype.hasOwnProperty.call(responses, status);
}

function hasAnyStatus(responses, statuses) {
  return statuses.some((status) => hasStatus(responses, status));
}
