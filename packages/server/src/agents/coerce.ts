import type { ZodType } from 'zod';

const NUMBER_FIELDS = new Set([
  'score',
  'totalScore',
  'weight',
  'feasibilityScore',
]);

const BOOLEAN_FIELDS = new Set(['pass', 'eliminated', 'builtIn']);

const ARRAY_FIELDS = new Set([
  'sourceIds',
  'gateResults',
  'criteriaScores',
  'risks',
  'gates',
  'criteria',
  'tests',
  'recommended',
  'children',
]);

function deepCoerce(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepCoerce);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      result[key] = coerceField(key, v);
    }
    return result;
  }
  return value;
}

function coerceField(key: string, value: unknown): unknown {
  if (NUMBER_FIELDS.has(key) && typeof value === 'string') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }

  if (BOOLEAN_FIELDS.has(key) && typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }

  if (ARRAY_FIELDS.has(key) && typeof value === 'string') {
    return [value];
  }

  if (ARRAY_FIELDS.has(key) && !Array.isArray(value) && value !== undefined && value !== null) {
    return [deepCoerce(value)];
  }

  return deepCoerce(value);
}

/**
 * Parse + coerce data before Zod validation.
 * Handles: JSON strings, string→number, string→boolean, bare value→array.
 */
export function coerceAndParse<T>(data: unknown, schema: ZodType<T>): T {
  let parsed: unknown = data;
  if (typeof data === 'string') {
    parsed = JSON.parse(data);
  }
  const coerced = deepCoerce(parsed);
  return schema.parse(coerced);
}
