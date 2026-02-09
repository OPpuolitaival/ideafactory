import { z } from 'zod';

export const StageSchema = z.enum(['taxonomy', 'methods', 'rubric', 'factory', 'completed']);
export type Stage = z.infer<typeof StageSchema>;

export const FactoryPhaseSchema = z.enum(['diverge', 'converge', 'evolve', 'interactive']);
export type FactoryPhase = z.infer<typeof FactoryPhaseSchema>;

export const SessionModelsSchema = z.object({
  navigator: z.string(),
  strategist: z.string(),
  worker: z.string(),
  analyst: z.string(),
});

export type SessionModels = z.infer<typeof SessionModelsSchema>;

export const SessionConfigSchema = z.object({
  ideasPerWorker: z.number().min(5).max(30).default(15),
  webSearch: z.boolean().default(false),
  models: SessionModelsSchema.optional(),
});

export type SessionConfig = z.infer<typeof SessionConfigSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  domain: z.string(),
  coordinate: z.string().optional(),
  status: StageSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  config: SessionConfigSchema,
});

export type Session = z.infer<typeof SessionSchema>;
