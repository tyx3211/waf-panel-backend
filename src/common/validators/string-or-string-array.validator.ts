import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'string')
  );
}

export function IsStringOrStringArray(
  allowed?: string[],
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'IsStringOrStringArray',
      target: object.constructor,
      propertyName,
      constraints: [allowed],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const allowList = args.constraints[0] as string[] | undefined;
          if (typeof value === 'string') {
            return allowList ? allowList.includes(value) : true;
          }
          if (isStringArray(value)) {
            return allowList ? value.every((v) => allowList.includes(v)) : true;
          }
          return false;
        },
        defaultMessage(args: ValidationArguments) {
          const allowList = args.constraints[0] as string[] | undefined;
          if (!allowList || allowList.length === 0) {
            return `${args.property} must be a string or non-empty string array`;
          }
          return `${args.property} must be one of ${allowList.join(', ')}`;
        },
      },
    });
  };
}
