import type { OpenAPIObject } from '@nestjs/swagger';

type JsonSchema = Record<string, unknown>;

function isReferenceObject(schema: JsonSchema): boolean {
  const ref = (schema as { $ref?: unknown }).$ref;
  return typeof ref === 'string';
}

function isEnvelopeSchema(schema: JsonSchema): boolean {
  if (isReferenceObject(schema)) {
    return (
      (schema as { $ref?: string }).$ref === '#/components/schemas/ApiEnvelope'
    );
  }
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props) return false;
  return 'code' in props && 'data' in props;
}

export function applyEnvelope(document: OpenAPIObject): void {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ApiEnvelope = {
    type: 'object',
    properties: {
      code: { type: 'number', example: 0 },
      message: { type: 'string', example: 'ok' },
      data: {},
    },
    required: ['code', 'message', 'data'],
  };

  const paths = document.paths ?? {};
  Object.values(paths).forEach((pathItem) => {
    if (!pathItem) return;
    Object.values(pathItem).forEach((operation) => {
      if (!operation || typeof operation !== 'object') return;
      const responses = (operation as { responses?: Record<string, unknown> })
        .responses;
      if (!responses) return;
      Object.values(responses).forEach((response) => {
        if (!response || typeof response !== 'object') return;
        const content = (response as { content?: Record<string, unknown> })
          .content;
        const json = content?.['application/json'] as
          | { schema?: JsonSchema }
          | undefined;
        if (!json?.schema) return;
        if (isEnvelopeSchema(json.schema)) return;
        json.schema = {
          allOf: [
            { $ref: '#/components/schemas/ApiEnvelope' },
            { type: 'object', properties: { data: json.schema } },
          ],
        };
      });
    });
  });
}
