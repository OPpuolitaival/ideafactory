import { z } from 'zod';

export const OutputPackageSchema = z.object({
  concepts: z.array(
    z.object({
      rank: z.number(),
      name: z.string(),
      description: z.string(),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
      openQuestions: z.array(z.string()),
      nextSteps: z.array(z.string()),
      qaVerdict: z.enum(['strong', 'conditional', 'weak']),
    }),
  ),
  overallInsights: z.string(),
  suggestedNextSprint: z.array(z.string()),
  sessionMetadata: z.object({
    domain: z.string(),
    coordinate: z.string(),
    methods: z.array(z.string()),
    workerCount: z.number(),
    totalIdeasGenerated: z.number(),
    totalIdeasSurvived: z.number(),
    duration: z.number(),
  }),
});

export type OutputPackage = z.infer<typeof OutputPackageSchema>;

export const VisualArtifactSchema = z.object({
  type: z.enum(['radar_chart', 'concept_sketch', 'report_page']),
  format: z.enum(['svg', 'html']),
  content: z.string(),
  label: z.string(),
});

export type VisualArtifact = z.infer<typeof VisualArtifactSchema>;
