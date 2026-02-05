import { z } from 'zod';

export const RubricSchema = z.object({
  gates: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
    }),
  ),
  criteria: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      weight: z.number().min(1).max(5),
      description: z.string(),
    }),
  ),
  tests: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
    }),
  ),
});

export type Rubric = z.infer<typeof RubricSchema>;
