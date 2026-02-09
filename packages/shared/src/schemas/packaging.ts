import { z } from 'zod';

export const IdeaPackageSchema = z.object({
  ideaId: z.string(),
  ideaName: z.string(),
  htmlContent: z.string(),
  deepResearchPrompt: z.string(),
});

export type IdeaPackage = z.infer<typeof IdeaPackageSchema>;
