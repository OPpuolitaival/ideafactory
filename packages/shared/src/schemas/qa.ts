import { z } from 'zod';

export const QAResultSchema = z.object({
  conceptId: z.string(),
  feasibilityScore: z.number().min(1).max(5),
  risks: z.array(
    z.object({
      category: z.string(),
      description: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      mitigation: z.string().optional(),
    }),
  ),
  verdict: z.enum(['strong', 'conditional', 'weak']),
  summary: z.string(),
});

export type QAResult = z.infer<typeof QAResultSchema>;
