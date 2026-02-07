import { z, toJSONSchema } from 'zod';
import {
  TaxonomyNodeSchema,
  MethodRecommendationSchema,
  RubricSchema,
  RawIdeaSchema,
  ScoredIdeaSchema,
  EvolvedConceptSchema,
  QAResultSchema,
  OutputPackageSchema,
  VisualArtifactSchema,
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
export const qaResultArrayJsonSchema = toJsonSchema(z.array(QAResultSchema));
export const outputPackageJsonSchema = toJsonSchema(OutputPackageSchema);
export const visualArtifactArrayJsonSchema = toJsonSchema(z.array(VisualArtifactSchema));
