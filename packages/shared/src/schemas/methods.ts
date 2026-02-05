import { z } from 'zod';

export const MethodSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  goodFor: z.string(),
  builtIn: z.boolean().default(true),
});

export type Method = z.infer<typeof MethodSchema>;

export const MethodRecommendationSchema = z.object({
  recommended: z.array(z.number()),
  reasoning: z.record(z.string(), z.string()),
});

export type MethodRecommendation = z.infer<typeof MethodRecommendationSchema>;
