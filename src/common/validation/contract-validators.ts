import { ValidateBy, ValidationOptions } from 'class-validator';

export const MAX_VND = 9223372036854775807n;
export const MAX_DB_INTEGER = 2147483647;

export function isVndAmount(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= MAX_VND
  );
}

export function IsVndAmount(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    { name: 'isVndAmount', validator: { validate: isVndAmount } },
    options,
  );
}

export function IsSafeText(
  max: number,
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isSafeText',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          value.length > 0 &&
          value === value.trim() &&
          Array.from(value).length <= max &&
          !/\p{Cc}/u.test(value),
      },
    },
    options,
  );
}

export function trimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
