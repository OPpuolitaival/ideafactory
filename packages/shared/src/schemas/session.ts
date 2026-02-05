import { z } from 'zod';

export const StageSchema = z.enum(['taxonomy', 'methods', 'rubric', 'factory', 'output', 'completed']);
export type Stage = z.infer<typeof StageSchema>;

export const FactoryPhaseSchema = z.enum(['diverge', 'converge', 'evolve', 'qa']);
export type FactoryPhase = z.infer<typeof FactoryPhaseSchema>;

export const PersonaSchema = z.object({
  name: z.string(),
  systemPrompt: z.string(),
  defaultMethod: z.string().optional(),
  builtIn: z.boolean().default(true),
});

export type Persona = z.infer<typeof PersonaSchema>;

export const SessionConfigSchema = z.object({
  workerCount: z.number().min(1).max(5).default(3),
  ideasPerWorker: z.number().min(5).max(30).default(15),
  webSearch: z.boolean().default(false),
  personas: z.array(z.string()).optional(),
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
