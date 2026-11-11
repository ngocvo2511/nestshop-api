import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { authSuccessSchema } from '../auth/auth.openapi';

export const profileSchema = authSuccessSchema(false);
const assignment: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email', 'role', 'isActive'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['CUSTOMER', 'STAFF', 'ADMIN'] },
    isActive: { type: 'boolean' },
  },
};
function envelope(data: SchemaObject): SchemaObject {
  return {
    ...profileSchema,
    properties: { ...profileSchema.properties, data },
  };
}
export const rolesListSchema = envelope({
  type: 'object',
  required: ['items', 'offset', 'limit', 'total'],
  properties: {
    items: { type: 'array', items: assignment },
    offset: { type: 'integer' },
    limit: { type: 'integer' },
    total: { type: 'integer' },
  },
});
export const roleChangeSchema = envelope({
  type: 'object',
  required: ['user', 'changed', 'auditId'],
  properties: {
    user: assignment,
    changed: { type: 'boolean' },
    auditId: { type: 'string', format: 'uuid', nullable: true },
  },
});
export function AccountErrors() {
  return applyDecorators(
    ...[400, 401, 403, 404, 500, 503].map((status) =>
      ApiResponse({
        status,
        description:
          status === 400
            ? 'VALIDATION_FAILED / EMPTY_UPDATE / INVALID_CURRENT_PASSWORD'
            : 'Safe catalog error',
        schema: { $ref: '#/components/schemas/ErrorEnvelope' },
      }),
    ),
  );
}
