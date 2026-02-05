import { z } from 'zod';

export const RawIdeaSchema = z.object({
  id: z.string(),
  workerId: z.string(),
  persona: z.string(),
  method: z.string(),
  name: z.string(),
  description: z.string(),
  probability: z.enum(['high', 'medium', 'low']),
});

export type RawIdea = z.infer<typeof RawIdeaSchema>;

export const ScoredIdeaSchema = z.object({
  id: z.string(),
  sourceIds: z.array(z.string()),
  name: z.string(),
  description: z.string(),
  gateResults: z.array(
    z.object({
      gateId: z.string(),
      pass: z.boolean(),
      reason: z.string(),
    }),
  ),
  criteriaScores: z.array(
    z.object({
      criterionId: z.string(),
      score: z.number().min(1).max(5),
      reason: z.string(),
    }),
  ),
  totalScore: z.number(),
  eliminated: z.boolean(),
  eliminationReason: z.string().optional(),
});

export type ScoredIdea = z.infer<typeof ScoredIdeaSchema>;
