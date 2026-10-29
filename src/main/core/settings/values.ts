import { ValidationError } from '../validation-error';

export function string(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ValidationError(`${label}が正しくありません。`);
  }
  return value;
}

export function nonEmptyString(value: unknown, label: string, maxLength: number): string {
  const result = string(value, label, maxLength).trim();
  if (!result) throw new ValidationError(`${label}が正しくありません。`);
  return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
