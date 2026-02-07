import type { TaxonomyNode } from './schemas/taxonomy.js';
import type { MethodRecommendation } from './schemas/methods.js';
import type { Rubric } from './schemas/rubric.js';
import type { RawIdea, ScoredIdea } from './schemas/ideas.js';
import type { QAResult } from './schemas/qa.js';
import type { OutputPackage } from './schemas/output.js';

export type SSEEvent =
  | { type: 'agent:thought'; data: { agent: string; text: string; model?: string } }
  | { type: 'agent:tool_use'; data: { agent: string; tool: string; model?: string } }
  | { type: 'data:taxonomy_update'; data: TaxonomyNode }
  | { type: 'data:methods_recommended'; data: MethodRecommendation }
  | { type: 'data:rubric_generated'; data: Rubric }
  | {
      type: 'data:idea_stream';
      data: { workerId: string; persona: string; idea: RawIdea };
    }
  | {
      type: 'data:convergence_result';
      data: { survivors: ScoredIdea[]; eliminated: ScoredIdea[] };
    }
  | { type: 'data:evolution_result'; data: { evolved: ScoredIdea[] } }
  | { type: 'data:qa_result'; data: { reviewed: QAResult[] } }
  | { type: 'data:output_package'; data: OutputPackage }
  | {
      type: 'factory:progress';
      data: {
        phase: 'diverge' | 'converge' | 'evolve' | 'qa' | 'rescore';
        detail: string;
        workersTotal?: number;
        workersDone?: number;
        workersFailed?: number;
      };
    }
  | { type: 'status:stage_start'; data: { stage: string } }
  | { type: 'status:stage_complete'; data: { stage: string; next: string } }
  | { type: 'status:error'; data: { stage: string; error: string } };
