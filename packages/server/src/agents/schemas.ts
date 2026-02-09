import { z, toJSONSchema } from 'zod';
import {
  TaxonomyNodeSchema,
  MethodRecommendationSchema,
  RubricSchema,
  RawIdeaSchema,
  ScoredIdeaSchema,
  EvolvedConceptSchema,
  QAResultSchema,
  IdeaPackageSchema,
} from '@ideafactory/shared';

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return toJSONSchema(schema) as Record<string, unknown>;
}

export const taxonomyJsonSchema = toJsonSchema(TaxonomyNodeSchema);
export const methodRecommendationJsonSchema = toJsonSchema(MethodRecommendationSchema);
export const rubricJsonSchema = toJsonSchema(RubricSchema);
export const rawIdeaArrayJsonSchema = toJsonSchema(
  z.array(RawIdeaSchema.omit({ workerId: true, persona: true })),
);
export const scoredIdeaArrayJsonSchema = toJsonSchema(z.array(ScoredIdeaSchema));
export const evolvedConceptArrayJsonSchema = toJsonSchema(z.array(EvolvedConceptSchema));
export const qaResultJsonSchema = toJsonSchema(QAResultSchema);
export const ideaPackageJsonSchema = toJsonSchema(IdeaPackageSchema);
