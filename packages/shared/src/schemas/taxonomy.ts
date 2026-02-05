import { z } from 'zod';

export const TaxonomyNodeSchema: z.ZodType<TaxonomyNode> = z.object({
  name: z.string(),
  p: z.enum(['high', 'medium', 'low']),
  children: z.array(z.lazy(() => TaxonomyNodeSchema)).optional(),
});

export type TaxonomyNode = {
  name: string;
  p: 'high' | 'medium' | 'low';
  children?: TaxonomyNode[];
};
