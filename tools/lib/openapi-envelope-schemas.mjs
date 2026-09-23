/**
 * Canonical OpenAPI component schemas for SdkWorkApiResponse envelopes.
 * Authority: API_SPEC.md §14–§16, templates/openapi/components/schemas/
 */

export const SDKWORK_SUCCESS_CODE = 0;

export const sdkWorkEnvelopeComponentSchemas = {
  SdkWorkApiResponse: {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'data', 'traceId'],
    properties: {
      code: {
        type: 'integer',
        format: 'int32',
        enum: [SDKWORK_SUCCESS_CODE],
        default: SDKWORK_SUCCESS_CODE,
        minimum: 0,
        maximum: 0,
      },
      data: {
        description: 'Operation-specific payload typed per response schema.',
      },
      traceId: {
        type: 'string',
        format: 'uuid',
        description: 'Server-owned request correlation id.',
      },
    },
  },
  SdkWorkResourceData: {
    type: 'object',
    additionalProperties: false,
    required: ['item'],
    properties: {
      item: {
        type: 'object',
        additionalProperties: true,
        description: 'Typed domain resource for the operation.',
      },
    },
  },
  SdkWorkPageData: {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'pageInfo'],
    properties: {
      items: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
      pageInfo: { $ref: '#/components/schemas/PageInfo' },
    },
  },
  SdkWorkCommandData: {
    type: 'object',
    additionalProperties: false,
    required: ['accepted'],
    properties: {
      accepted: { type: 'boolean', const: true },
      resourceId: { type: 'string' },
      status: { type: 'string' },
    },
  },
  PageInfo: {
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: {
      mode: { type: 'string', enum: ['offset', 'cursor'] },
      page: { type: 'integer', minimum: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 200 },
      // API_SPEC 13.6: totalItems is an int64 wire field, so it must be a string
      // carrying format int64 plus the marker. Without the marker the generated
      // TypeScript SDK emits `number`, and a Memory space with more than 2^53
      // rows would silently round its total on the wire.
      totalItems: {
        type: 'string',
        format: 'int64',
        pattern: '^[0-9]+$',
        'x-sdkwork-int64-string': true,
      },
      totalPages: { type: 'integer', minimum: 0 },
      nextCursor: { type: ['string', 'null'] },
      hasMore: { type: 'boolean' },
    },
  },
  SdkWorkPlatformErrorCode: {
    type: 'integer',
    format: 'int32',
    minimum: 40001,
    maximum: 79999,
    description: 'Platform or domain error code per API_SPEC.md §15.3.',
  },
  ProblemDetail: {
    type: 'object',
    additionalProperties: true,
    required: ['type', 'title', 'status', 'code', 'traceId'],
    properties: {
      type: { type: 'string', format: 'uri-reference' },
      title: { type: 'string' },
      status: { type: 'integer', minimum: 100, maximum: 599 },
      detail: { type: 'string' },
      instance: { type: 'string' },
      code: { $ref: '#/components/schemas/SdkWorkPlatformErrorCode' },
      traceId: {
        type: 'string',
        format: 'uuid',
        description: 'Server-owned request correlation id.',
      },
      i18nKey: {
        type: 'string',
        description: 'Optional stable localization key such as errors.result.40001.',
      },
      locale: {
        type: 'string',
        description: 'Optional effective BCP 47 locale used by framework message mapping.',
      },
      errors: {
        type: 'array',
        items: { $ref: '#/components/schemas/FieldError' },
      },
    },
  },
  FieldError: {
    type: 'object',
    additionalProperties: false,
    required: ['field', 'message'],
    properties: {
      field: { type: 'string' },
      message: { type: 'string' },
      code: {
        type: 'integer',
        format: 'int32',
        minimum: 40011,
        maximum: 40099,
      },
      i18nKey: { type: 'string' },
      params: {
        type: 'object',
        additionalProperties: {
          oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'integer' }, { type: 'boolean' }],
        },
      },
    },
  },
  SdkWorkResourceResponse: {
    allOf: [
      { $ref: '#/components/schemas/SdkWorkApiResponse' },
      {
        type: 'object',
        required: ['data'],
        properties: {
          data: { $ref: '#/components/schemas/SdkWorkResourceData' },
        },
      },
    ],
  },
  SdkWorkListResponse: {
    allOf: [
      { $ref: '#/components/schemas/SdkWorkApiResponse' },
      {
        type: 'object',
        required: ['data'],
        properties: {
          data: { $ref: '#/components/schemas/SdkWorkPageData' },
        },
      },
    ],
  },
  SdkWorkCommandResponse: {
    allOf: [
      { $ref: '#/components/schemas/SdkWorkApiResponse' },
      {
        type: 'object',
        required: ['data'],
        properties: {
          data: { $ref: '#/components/schemas/SdkWorkCommandData' },
        },
      },
    ],
  },
};

/**
 * @param {{ method?: string, operationId?: string }} route
 */
export function successResponseSchemaRef(route) {
  if (route?.method === 'get' && String(route?.operationId || '').endsWith('.list')) {
    return '#/components/schemas/SdkWorkListResponse';
  }
  if (isCommandOperation(route)) {
    return '#/components/schemas/SdkWorkCommandResponse';
  }
  return '#/components/schemas/SdkWorkResourceResponse';
}

function isCommandOperation(route) {
  const operationId = String(route?.operationId || '');
  const action = operationId.split('.').pop() || '';
  const commandActions = new Set([
    'revoke',
    'enable',
    'disable',
    'delete',
    'heartbeat',
    'verify',
    'refresh',
    'logout',
    'provision',
    'register',
  ]);
  return route?.method === 'post' && commandActions.has(action) && !operationId.endsWith('.create');
}

export function isCreateOperation(route) {
  return route?.method === 'post' && String(route?.operationId || '').endsWith('.create');
}

export function typedSdkWorkResourceResponse(itemRef) {
  return {
    allOf: [
      { $ref: '#/components/schemas/SdkWorkApiResponse' },
      {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['item'],
            properties: {
              item: { $ref: itemRef },
            },
          },
        },
      },
    ],
  };
}
