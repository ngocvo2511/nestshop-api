import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

const user: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'email',
    'role',
    'isActive',
    'fullName',
    'phoneNumber',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['CUSTOMER', 'STAFF', 'ADMIN'] },
    isActive: { type: 'boolean' },
    fullName: { type: 'string', nullable: true },
    phoneNumber: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
export function authSuccessSchema(
  pair: boolean,
  includeUser = true,
): SchemaObject {
  return {
    type: 'object',
    required: ['success', 'data', 'meta'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      meta: {
        type: 'object',
        properties: { correlationId: { type: 'string', format: 'uuid' } },
      },
      data: pair
        ? {
            type: 'object',
            additionalProperties: false,
            required: [
              ...(includeUser ? ['user'] : []),
              'accessToken',
              'tokenType',
              'expiresIn',
              'refreshToken',
              'refreshExpiresAt',
            ],
            properties: {
              ...(includeUser
                ? {
                    user: {
                      type: 'object' as const,
                      additionalProperties: false,
                      required: ['id', 'email', 'role', 'fullName'],
                      properties: {
                        id: user.properties!.id,
                        email: user.properties!.email,
                        role: user.properties!.role,
                        fullName: user.properties!.fullName,
                      },
                    },
                  }
                : {}),
              accessToken: { type: 'string' },
              tokenType: { type: 'string', enum: ['Bearer'] },
              expiresIn: { type: 'integer' },
              refreshToken: { type: 'string', minLength: 43, maxLength: 43 },
              refreshExpiresAt: { type: 'string', format: 'date-time' },
            },
          }
        : user,
    },
  };
}
