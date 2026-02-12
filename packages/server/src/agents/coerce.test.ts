import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { coerceAndParse } from './coerce.js';

describe('coerceAndParse', () => {
  // ---- String → Number coercion ----

  it('coerces score string to number', () => {
    const schema = z.object({ score: z.number() });
    const result = coerceAndParse({ score: '4' }, schema);
    expect(result.score).toBe(4);
  });

  it('coerces totalScore string to number', () => {
    const schema = z.object({ totalScore: z.number() });
    const result = coerceAndParse({ totalScore: '19.5' }, schema);
    expect(result.totalScore).toBe(19.5);
  });

  it('coerces weight string to number', () => {
    const schema = z.object({ weight: z.number() });
    const result = coerceAndParse({ weight: '3' }, schema);
    expect(result.weight).toBe(3);
  });

  it('coerces feasibilityScore string to number', () => {
    const schema = z.object({ feasibilityScore: z.number() });
    const result = coerceAndParse({ feasibilityScore: '5' }, schema);
    expect(result.feasibilityScore).toBe(5);
  });

  it('leaves non-numeric string score alone (lets Zod reject)', () => {
    const schema = z.object({ score: z.number() });
    expect(() => coerceAndParse({ score: 'abc' }, schema)).toThrow();
  });

  // ---- String → Boolean coercion ----

  it('coerces pass "true" string to boolean true', () => {
    const schema = z.object({ pass: z.boolean() });
    const result = coerceAndParse({ pass: 'true' }, schema);
    expect(result.pass).toBe(true);
  });

  it('coerces pass "false" string to boolean false', () => {
    const schema = z.object({ pass: z.boolean() });
    const result = coerceAndParse({ pass: 'false' }, schema);
    expect(result.pass).toBe(false);
  });

  it('coerces eliminated "true" string to boolean true', () => {
    const schema = z.object({ eliminated: z.boolean() });
    const result = coerceAndParse({ eliminated: 'true' }, schema);
    expect(result.eliminated).toBe(true);
  });

  it('coerces builtIn "false" string to boolean false', () => {
    const schema = z.object({ builtIn: z.boolean() });
    const result = coerceAndParse({ builtIn: 'false' }, schema);
    expect(result.builtIn).toBe(false);
  });

  it('leaves non-boolean string alone (lets Zod reject)', () => {
    const schema = z.object({ pass: z.boolean() });
    expect(() => coerceAndParse({ pass: 'yes' }, schema)).toThrow();
  });

  // ---- String → Array wrapping ----

  it('wraps bare string sourceIds into array', () => {
    const schema = z.object({ sourceIds: z.array(z.string()) });
    const result = coerceAndParse({ sourceIds: 'id-1' }, schema);
    expect(result.sourceIds).toEqual(['id-1']);
  });

  it('wraps bare object gateResults into array', () => {
    const schema = z.object({
      gateResults: z.array(z.object({ gateId: z.string(), pass: z.boolean() })),
    });
    const result = coerceAndParse(
      { gateResults: { gateId: 'g1', pass: 'true' } },
      schema,
    );
    expect(result.gateResults).toEqual([{ gateId: 'g1', pass: true }]);
  });

  it('leaves existing arrays as-is', () => {
    const schema = z.object({ sourceIds: z.array(z.string()) });
    const result = coerceAndParse({ sourceIds: ['a', 'b'] }, schema);
    expect(result.sourceIds).toEqual(['a', 'b']);
  });

  // ---- JSON string input ----

  it('parses JSON string input before coercing', () => {
    const schema = z.object({ score: z.number(), pass: z.boolean() });
    const jsonStr = JSON.stringify({ score: '4', pass: 'true' });
    const result = coerceAndParse(jsonStr, schema);
    expect(result.score).toBe(4);
    expect(result.pass).toBe(true);
  });

  // ---- Nested coercion ----

  it('coerces nested fields inside arrays', () => {
    const schema = z.object({
      criteriaScores: z.array(
        z.object({ criterionId: z.string(), score: z.number() }),
      ),
    });
    const result = coerceAndParse(
      { criteriaScores: [{ criterionId: 'c1', score: '4' }] },
      schema,
    );
    expect(result.criteriaScores[0].score).toBe(4);
  });

  it('coerces deeply nested boolean fields', () => {
    const schema = z.object({
      gateResults: z.array(
        z.object({ gateId: z.string(), pass: z.boolean(), reason: z.string() }),
      ),
      eliminated: z.boolean(),
    });
    const result = coerceAndParse(
      {
        gateResults: [{ gateId: 'g1', pass: 'true', reason: 'OK' }],
        eliminated: 'false',
      },
      schema,
    );
    expect(result.gateResults[0].pass).toBe(true);
    expect(result.eliminated).toBe(false);
  });

  // ---- z.array() wrapper ----

  it('works with z.array() top-level schema', () => {
    const schema = z.array(z.object({ score: z.number(), eliminated: z.boolean() }));
    const result = coerceAndParse(
      [
        { score: '4', eliminated: 'false' },
        { score: '2', eliminated: 'true' },
      ],
      schema,
    );
    expect(result).toHaveLength(2);
    expect(result[0].score).toBe(4);
    expect(result[0].eliminated).toBe(false);
    expect(result[1].score).toBe(2);
    expect(result[1].eliminated).toBe(true);
  });

  // ---- Extra keys stripped by Zod ----

  it('strips extra keys when schema uses strict or passthrough is off', () => {
    const schema = z.object({ score: z.number() }).strict();
    expect(() => coerceAndParse({ score: '4', extra: 'foo' }, schema)).toThrow();
  });

  // ---- Genuinely invalid data ----

  it('rejects genuinely invalid data', () => {
    const schema = z.object({ score: z.number(), name: z.string() });
    expect(() => coerceAndParse({ score: '4' }, schema)).toThrow();
  });

  it('rejects non-JSON string input', () => {
    const schema = z.object({ score: z.number() });
    expect(() => coerceAndParse('not json', schema)).toThrow();
  });

  // ---- Passthrough: already correct types ----

  it('passes through already correct types without change', () => {
    const schema = z.object({
      score: z.number(),
      pass: z.boolean(),
      sourceIds: z.array(z.string()),
    });
    const result = coerceAndParse(
      { score: 4, pass: true, sourceIds: ['a'] },
      schema,
    );
    expect(result).toEqual({ score: 4, pass: true, sourceIds: ['a'] });
  });
});
