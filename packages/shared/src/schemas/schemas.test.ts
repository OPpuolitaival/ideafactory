import { describe, it, expect } from 'vitest';
import { TaxonomyNodeSchema } from './taxonomy.js';
import { MethodSchema, MethodRecommendationSchema } from './methods.js';
import { RubricSchema } from './rubric.js';
import { RawIdeaSchema, ScoredIdeaSchema } from './ideas.js';
import { QAResultSchema } from './qa.js';
import { OutputPackageSchema, VisualArtifactSchema } from './output.js';
import {
  StageSchema,
  FactoryPhaseSchema,
  PersonaSchema,
  SessionConfigSchema,
  SessionSchema,
} from './session.js';
import {
  BUILT_IN_METHODS,
  DEFAULT_PERSONAS,
  STAGE_ORDER,
} from '../constants.js';

// ---------------------------------------------------------------------------
// TaxonomyNodeSchema
// ---------------------------------------------------------------------------
describe('TaxonomyNodeSchema', () => {
  it('accepts a valid flat node', () => {
    const node = { name: 'Root', p: 'high' };
    const result = TaxonomyNodeSchema.safeParse(node);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Root');
      expect(result.data.p).toBe('high');
      expect(result.data.children).toBeUndefined();
    }
  });

  it('accepts all valid probability values', () => {
    for (const p of ['high', 'medium', 'low'] as const) {
      const result = TaxonomyNodeSchema.safeParse({ name: 'Node', p });
      expect(result.success).toBe(true);
    }
  });

  it('rejects a node with missing name', () => {
    const result = TaxonomyNodeSchema.safeParse({ p: 'high' });
    expect(result.success).toBe(false);
  });

  it('rejects a node with missing probability', () => {
    const result = TaxonomyNodeSchema.safeParse({ name: 'Node' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid probability value', () => {
    const result = TaxonomyNodeSchema.safeParse({ name: 'Node', p: 'extreme' });
    expect(result.success).toBe(false);
  });

  it('accepts a node with recursive children', () => {
    const node = {
      name: 'Root',
      p: 'high',
      children: [
        { name: 'Child A', p: 'medium' },
        { name: 'Child B', p: 'low', children: [] },
      ],
    };
    const result = TaxonomyNodeSchema.safeParse(node);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.children).toHaveLength(2);
      expect(result.data.children![0].name).toBe('Child A');
    }
  });

  it('accepts deep nesting (3+ levels)', () => {
    const node = {
      name: 'L1',
      p: 'high',
      children: [
        {
          name: 'L2',
          p: 'medium',
          children: [
            {
              name: 'L3',
              p: 'low',
              children: [{ name: 'L4', p: 'high' }],
            },
          ],
        },
      ],
    };
    const result = TaxonomyNodeSchema.safeParse(node);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.children![0].children![0].children![0].name).toBe('L4');
    }
  });

  it('rejects a child node with invalid probability', () => {
    const node = {
      name: 'Root',
      p: 'high',
      children: [{ name: 'Bad Child', p: 'none' }],
    };
    const result = TaxonomyNodeSchema.safeParse(node);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MethodSchema & MethodRecommendationSchema
// ---------------------------------------------------------------------------
describe('MethodSchema', () => {
  it('accepts a valid method', () => {
    const method = {
      id: 1,
      name: 'First Principles',
      description: 'Break it down',
      goodFor: 'Radical innovation',
      builtIn: true,
    };
    const result = MethodSchema.safeParse(method);
    expect(result.success).toBe(true);
  });

  it('defaults builtIn to true when omitted', () => {
    const method = {
      id: 1,
      name: 'First Principles',
      description: 'Break it down',
      goodFor: 'Radical innovation',
    };
    const result = MethodSchema.safeParse(method);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.builtIn).toBe(true);
    }
  });

  it('rejects non-numeric id', () => {
    const method = {
      id: 'abc',
      name: 'First Principles',
      description: 'Break it down',
      goodFor: 'Radical innovation',
    };
    const result = MethodSchema.safeParse(method);
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = MethodSchema.safeParse({ id: 1 });
    expect(result.success).toBe(false);
  });
});

describe('MethodRecommendationSchema', () => {
  it('accepts valid recommendations', () => {
    const rec = {
      recommended: [1, 3, 5],
      reasoning: {
        '1': 'Good for constraints',
        '3': 'Resolves trade-offs',
        '5': 'Extreme creativity',
      },
    };
    const result = MethodRecommendationSchema.safeParse(rec);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recommended).toEqual([1, 3, 5]);
    }
  });

  it('accepts an empty recommended array', () => {
    const rec = { recommended: [], reasoning: {} };
    const result = MethodRecommendationSchema.safeParse(rec);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recommended).toHaveLength(0);
    }
  });

  it('rejects non-numeric IDs in recommended array', () => {
    const rec = {
      recommended: ['a', 'b'],
      reasoning: {},
    };
    const result = MethodRecommendationSchema.safeParse(rec);
    expect(result.success).toBe(false);
  });

  it('rejects missing reasoning field', () => {
    const result = MethodRecommendationSchema.safeParse({ recommended: [1] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RubricSchema
// ---------------------------------------------------------------------------
describe('RubricSchema', () => {
  const validRubric = {
    gates: [{ id: 'g1', text: 'Feasible?' }],
    criteria: [
      { id: 'c1', text: 'Novelty', weight: 3, description: 'How novel' },
    ],
    tests: [{ id: 't1', text: 'User delight test' }],
  };

  it('accepts a valid rubric', () => {
    const result = RubricSchema.safeParse(validRubric);
    expect(result.success).toBe(true);
  });

  it('accepts weight at lower bound (1)', () => {
    const rubric = {
      ...validRubric,
      criteria: [{ id: 'c1', text: 'Novelty', weight: 1, description: 'Desc' }],
    };
    const result = RubricSchema.safeParse(rubric);
    expect(result.success).toBe(true);
  });

  it('accepts weight at upper bound (5)', () => {
    const rubric = {
      ...validRubric,
      criteria: [{ id: 'c1', text: 'Novelty', weight: 5, description: 'Desc' }],
    };
    const result = RubricSchema.safeParse(rubric);
    expect(result.success).toBe(true);
  });

  it('rejects weight of 0 (below minimum)', () => {
    const rubric = {
      ...validRubric,
      criteria: [{ id: 'c1', text: 'Novelty', weight: 0, description: 'Desc' }],
    };
    const result = RubricSchema.safeParse(rubric);
    expect(result.success).toBe(false);
  });

  it('rejects weight of 6 (above maximum)', () => {
    const rubric = {
      ...validRubric,
      criteria: [{ id: 'c1', text: 'Novelty', weight: 6, description: 'Desc' }],
    };
    const result = RubricSchema.safeParse(rubric);
    expect(result.success).toBe(false);
  });

  it('accepts empty gates array', () => {
    const rubric = { ...validRubric, gates: [] };
    const result = RubricSchema.safeParse(rubric);
    expect(result.success).toBe(true);
  });

  it('accepts empty criteria array', () => {
    const rubric = { ...validRubric, criteria: [] };
    const result = RubricSchema.safeParse(rubric);
    expect(result.success).toBe(true);
  });

  it('accepts empty tests array', () => {
    const rubric = { ...validRubric, tests: [] };
    const result = RubricSchema.safeParse(rubric);
    expect(result.success).toBe(true);
  });

  it('rejects missing gates field', () => {
    const { gates, ...rest } = validRubric;
    const result = RubricSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects criteria missing description', () => {
    const rubric = {
      ...validRubric,
      criteria: [{ id: 'c1', text: 'Novelty', weight: 3 }],
    };
    const result = RubricSchema.safeParse(rubric);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RawIdeaSchema
// ---------------------------------------------------------------------------
describe('RawIdeaSchema', () => {
  const validIdea = {
    id: 'idea-1',
    workerId: 'w-1',
    persona: 'The Engineer',
    method: 'First Principles',
    name: 'Super Widget',
    description: 'A widget that is super',
    probability: 'high',
  };

  it('accepts a valid idea', () => {
    const result = RawIdeaSchema.safeParse(validIdea);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('idea-1');
      expect(result.data.probability).toBe('high');
    }
  });

  it('rejects missing required fields (no name)', () => {
    const { name, ...rest } = validIdea;
    const result = RawIdeaSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields (no description)', () => {
    const { description, ...rest } = validIdea;
    const result = RawIdeaSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields (no workerId)', () => {
    const { workerId, ...rest } = validIdea;
    const result = RawIdeaSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects invalid probability value', () => {
    const result = RawIdeaSchema.safeParse({ ...validIdea, probability: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid probability values', () => {
    for (const p of ['high', 'medium', 'low'] as const) {
      const result = RawIdeaSchema.safeParse({ ...validIdea, probability: p });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ScoredIdeaSchema
// ---------------------------------------------------------------------------
describe('ScoredIdeaSchema', () => {
  const validScored = {
    id: 'scored-1',
    sourceIds: ['idea-1', 'idea-2'],
    name: 'Merged Widget',
    description: 'Combined idea',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Feasible' },
      { gateId: 'g2', pass: false, reason: 'Too expensive' },
    ],
    criteriaScores: [
      { criterionId: 'c1', score: 4, reason: 'Very novel' },
    ],
    totalScore: 4.0,
    eliminated: false,
  };

  it('accepts a valid scored idea', () => {
    const result = ScoredIdeaSchema.safeParse(validScored);
    expect(result.success).toBe(true);
  });

  it('accepts scored idea with elimination reason', () => {
    const eliminated = {
      ...validScored,
      eliminated: true,
      eliminationReason: 'Failed gate g2',
    };
    const result = ScoredIdeaSchema.safeParse(eliminated);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eliminationReason).toBe('Failed gate g2');
    }
  });

  it('accepts criteria score at lower bound (1)', () => {
    const scored = {
      ...validScored,
      criteriaScores: [{ criterionId: 'c1', score: 1, reason: 'Low' }],
    };
    const result = ScoredIdeaSchema.safeParse(scored);
    expect(result.success).toBe(true);
  });

  it('accepts criteria score at upper bound (5)', () => {
    const scored = {
      ...validScored,
      criteriaScores: [{ criterionId: 'c1', score: 5, reason: 'Max' }],
    };
    const result = ScoredIdeaSchema.safeParse(scored);
    expect(result.success).toBe(true);
  });

  it('rejects criteria score of 0 (below minimum)', () => {
    const scored = {
      ...validScored,
      criteriaScores: [{ criterionId: 'c1', score: 0, reason: 'Too low' }],
    };
    const result = ScoredIdeaSchema.safeParse(scored);
    expect(result.success).toBe(false);
  });

  it('rejects criteria score of 6 (above maximum)', () => {
    const scored = {
      ...validScored,
      criteriaScores: [{ criterionId: 'c1', score: 6, reason: 'Too high' }],
    };
    const result = ScoredIdeaSchema.safeParse(scored);
    expect(result.success).toBe(false);
  });

  it('validates gate results contain required fields', () => {
    const scored = {
      ...validScored,
      gateResults: [{ gateId: 'g1', pass: true }], // missing reason
    };
    const result = ScoredIdeaSchema.safeParse(scored);
    expect(result.success).toBe(false);
  });

  it('accepts totalScore as any number', () => {
    const scored = { ...validScored, totalScore: 3.75 };
    const result = ScoredIdeaSchema.safeParse(scored);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalScore).toBe(3.75);
    }
  });
});

// ---------------------------------------------------------------------------
// QAResultSchema
// ---------------------------------------------------------------------------
describe('QAResultSchema', () => {
  const validQA = {
    conceptId: 'concept-1',
    feasibilityScore: 3,
    risks: [
      {
        category: 'Technical',
        description: 'Hard to manufacture',
        severity: 'high',
      },
    ],
    verdict: 'conditional',
    summary: 'Needs more research',
  };

  it('accepts a valid QA result', () => {
    const result = QAResultSchema.safeParse(validQA);
    expect(result.success).toBe(true);
  });

  it('accepts feasibility score at lower bound (1)', () => {
    const result = QAResultSchema.safeParse({ ...validQA, feasibilityScore: 1 });
    expect(result.success).toBe(true);
  });

  it('accepts feasibility score at upper bound (5)', () => {
    const result = QAResultSchema.safeParse({ ...validQA, feasibilityScore: 5 });
    expect(result.success).toBe(true);
  });

  it('rejects feasibility score of 0 (below minimum)', () => {
    const result = QAResultSchema.safeParse({ ...validQA, feasibilityScore: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects feasibility score of 6 (above maximum)', () => {
    const result = QAResultSchema.safeParse({ ...validQA, feasibilityScore: 6 });
    expect(result.success).toBe(false);
  });

  it('accepts all valid severity values', () => {
    for (const severity of ['low', 'medium', 'high', 'critical'] as const) {
      const qa = {
        ...validQA,
        risks: [{ category: 'X', description: 'Y', severity }],
      };
      const result = QAResultSchema.safeParse(qa);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid severity enum value', () => {
    const qa = {
      ...validQA,
      risks: [{ category: 'X', description: 'Y', severity: 'extreme' }],
    };
    const result = QAResultSchema.safeParse(qa);
    expect(result.success).toBe(false);
  });

  it('accepts all valid verdict values', () => {
    for (const verdict of ['strong', 'conditional', 'weak'] as const) {
      const result = QAResultSchema.safeParse({ ...validQA, verdict });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid verdict enum value', () => {
    const result = QAResultSchema.safeParse({ ...validQA, verdict: 'excellent' });
    expect(result.success).toBe(false);
  });

  it('accepts risk with optional mitigation field', () => {
    const qa = {
      ...validQA,
      risks: [
        {
          category: 'Cost',
          description: 'Expensive',
          severity: 'medium',
          mitigation: 'Use cheaper materials',
        },
      ],
    };
    const result = QAResultSchema.safeParse(qa);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.risks[0].mitigation).toBe('Use cheaper materials');
    }
  });

  it('accepts empty risks array', () => {
    const qa = { ...validQA, risks: [] };
    const result = QAResultSchema.safeParse(qa);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OutputPackageSchema
// ---------------------------------------------------------------------------
describe('OutputPackageSchema', () => {
  const validOutput = {
    concepts: [
      {
        rank: 1,
        name: 'Top Concept',
        description: 'Best idea',
        pros: ['Novel', 'Feasible'],
        cons: ['Expensive'],
        openQuestions: ['Will users like it?'],
        nextSteps: ['Prototype'],
        qaVerdict: 'strong',
      },
    ],
    overallInsights: 'Great session',
    suggestedNextSprint: ['Explore materials'],
    sessionMetadata: {
      domain: 'Consumer electronics',
      coordinate: 'Portable speaker',
      methods: ['First Principles', 'Biomimicry'],
      workerCount: 3,
      totalIdeasGenerated: 45,
      totalIdeasSurvived: 5,
      duration: 120000,
    },
  };

  it('accepts a complete output package', () => {
    const result = OutputPackageSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('rejects missing concepts section', () => {
    const { concepts, ...rest } = validOutput;
    const result = OutputPackageSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing overallInsights section', () => {
    const { overallInsights, ...rest } = validOutput;
    const result = OutputPackageSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing sessionMetadata section', () => {
    const { sessionMetadata, ...rest } = validOutput;
    const result = OutputPackageSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing suggestedNextSprint section', () => {
    const { suggestedNextSprint, ...rest } = validOutput;
    const result = OutputPackageSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('validates sessionMetadata completeness - rejects missing domain', () => {
    const { domain, ...metaRest } = validOutput.sessionMetadata;
    const output = { ...validOutput, sessionMetadata: metaRest };
    const result = OutputPackageSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it('validates sessionMetadata completeness - rejects missing workerCount', () => {
    const { workerCount, ...metaRest } = validOutput.sessionMetadata;
    const output = { ...validOutput, sessionMetadata: metaRest };
    const result = OutputPackageSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it('validates sessionMetadata completeness - rejects missing duration', () => {
    const { duration, ...metaRest } = validOutput.sessionMetadata;
    const output = { ...validOutput, sessionMetadata: metaRest };
    const result = OutputPackageSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it('validates concept qaVerdict enum', () => {
    const output = {
      ...validOutput,
      concepts: [{ ...validOutput.concepts[0], qaVerdict: 'amazing' }],
    };
    const result = OutputPackageSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it('accepts empty concepts array', () => {
    const output = { ...validOutput, concepts: [] };
    const result = OutputPackageSchema.safeParse(output);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// VisualArtifactSchema
// ---------------------------------------------------------------------------
describe('VisualArtifactSchema', () => {
  const validArtifact = {
    type: 'radar_chart',
    format: 'svg',
    content: '<svg>...</svg>',
    label: 'Concept Radar',
  };

  it('accepts a valid artifact', () => {
    const result = VisualArtifactSchema.safeParse(validArtifact);
    expect(result.success).toBe(true);
  });

  it('accepts all valid type enum values', () => {
    for (const type of ['radar_chart', 'concept_sketch', 'report_page'] as const) {
      const result = VisualArtifactSchema.safeParse({ ...validArtifact, type });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid type enum value', () => {
    const result = VisualArtifactSchema.safeParse({
      ...validArtifact,
      type: 'bar_chart',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid format enum values', () => {
    for (const format of ['svg', 'html'] as const) {
      const result = VisualArtifactSchema.safeParse({ ...validArtifact, format });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid format enum value', () => {
    const result = VisualArtifactSchema.safeParse({
      ...validArtifact,
      format: 'png',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing label', () => {
    const { label, ...rest } = validArtifact;
    const result = VisualArtifactSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing content', () => {
    const { content, ...rest } = validArtifact;
    const result = VisualArtifactSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SessionConfigSchema
// ---------------------------------------------------------------------------
describe('SessionConfigSchema', () => {
  it('accepts a valid config', () => {
    const config = {
      workerCount: 3,
      ideasPerWorker: 15,
      webSearch: false,
      personas: ['The Engineer'],
    };
    const result = SessionConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('applies defaults when all fields omitted', () => {
    const result = SessionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workerCount).toBe(3);
      expect(result.data.ideasPerWorker).toBe(15);
      expect(result.data.webSearch).toBe(false);
    }
  });

  it('accepts workerCount at lower bound (1)', () => {
    const result = SessionConfigSchema.safeParse({ workerCount: 1 });
    expect(result.success).toBe(true);
  });

  it('accepts workerCount at upper bound (5)', () => {
    const result = SessionConfigSchema.safeParse({ workerCount: 5 });
    expect(result.success).toBe(true);
  });

  it('rejects workerCount of 0 (below minimum)', () => {
    const result = SessionConfigSchema.safeParse({ workerCount: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects workerCount of 6 (above maximum)', () => {
    const result = SessionConfigSchema.safeParse({ workerCount: 6 });
    expect(result.success).toBe(false);
  });

  it('accepts ideasPerWorker at lower bound (5)', () => {
    const result = SessionConfigSchema.safeParse({ ideasPerWorker: 5 });
    expect(result.success).toBe(true);
  });

  it('accepts ideasPerWorker at upper bound (30)', () => {
    const result = SessionConfigSchema.safeParse({ ideasPerWorker: 30 });
    expect(result.success).toBe(true);
  });

  it('rejects ideasPerWorker below minimum (4)', () => {
    const result = SessionConfigSchema.safeParse({ ideasPerWorker: 4 });
    expect(result.success).toBe(false);
  });

  it('rejects ideasPerWorker above maximum (31)', () => {
    const result = SessionConfigSchema.safeParse({ ideasPerWorker: 31 });
    expect(result.success).toBe(false);
  });

  it('accepts optional personas field', () => {
    const result = SessionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.personas).toBeUndefined();
    }
  });

  it('accepts personas as an array of strings', () => {
    const result = SessionConfigSchema.safeParse({
      personas: ['The Engineer', 'The Visionary'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.personas).toEqual(['The Engineer', 'The Visionary']);
    }
  });

  it('accepts optional models field with all roles', () => {
    const result = SessionConfigSchema.safeParse({
      models: {
        navigator: 'claude-haiku-4-5-20251001',
        strategist: 'claude-sonnet-4-5-20250929',
        worker: 'claude-opus-4-6',
        analyst: 'claude-opus-4-6',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.models).toEqual({
        navigator: 'claude-haiku-4-5-20251001',
        strategist: 'claude-sonnet-4-5-20250929',
        worker: 'claude-opus-4-6',
        analyst: 'claude-opus-4-6',
      });
    }
  });

  it('accepts config without models field', () => {
    const result = SessionConfigSchema.safeParse({
      workerCount: 3,
      ideasPerWorker: 15,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.models).toBeUndefined();
    }
  });

  it('rejects models with missing role', () => {
    const result = SessionConfigSchema.safeParse({
      models: {
        navigator: 'claude-haiku-4-5-20251001',
        strategist: 'claude-sonnet-4-5-20250929',
        // missing worker and analyst
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StageSchema & FactoryPhaseSchema
// ---------------------------------------------------------------------------
describe('StageSchema', () => {
  it('accepts all valid stage values', () => {
    const validStages = ['taxonomy', 'methods', 'rubric', 'factory', 'output', 'completed'];
    for (const stage of validStages) {
      const result = StageSchema.safeParse(stage);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid stage value', () => {
    const result = StageSchema.safeParse('planning');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = StageSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects numeric value', () => {
    const result = StageSchema.safeParse(1);
    expect(result.success).toBe(false);
  });
});

describe('FactoryPhaseSchema', () => {
  it('accepts all valid factory phase values', () => {
    for (const phase of ['diverge', 'converge', 'evolve', 'qa'] as const) {
      const result = FactoryPhaseSchema.safeParse(phase);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid factory phase value', () => {
    const result = FactoryPhaseSchema.safeParse('brainstorm');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PersonaSchema
// ---------------------------------------------------------------------------
describe('PersonaSchema', () => {
  it('accepts a valid persona with all fields', () => {
    const persona = {
      name: 'The Hacker',
      systemPrompt: 'You hack things together fast.',
      defaultMethod: 'First Principles',
      builtIn: false,
    };
    const result = PersonaSchema.safeParse(persona);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.builtIn).toBe(false);
    }
  });

  it('defaults builtIn to true when omitted', () => {
    const persona = {
      name: 'The Hacker',
      systemPrompt: 'You hack things together fast.',
    };
    const result = PersonaSchema.safeParse(persona);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.builtIn).toBe(true);
    }
  });

  it('treats defaultMethod as optional', () => {
    const persona = {
      name: 'The Hacker',
      systemPrompt: 'You hack things together fast.',
    };
    const result = PersonaSchema.safeParse(persona);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultMethod).toBeUndefined();
    }
  });

  it('rejects missing name', () => {
    const result = PersonaSchema.safeParse({ systemPrompt: 'Prompt text' });
    expect(result.success).toBe(false);
  });

  it('rejects missing systemPrompt', () => {
    const result = PersonaSchema.safeParse({ name: 'The Hacker' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SessionSchema
// ---------------------------------------------------------------------------
describe('SessionSchema', () => {
  const validSession = {
    id: 'sess-123',
    domain: 'Consumer electronics',
    coordinate: 'Portable speaker',
    status: 'taxonomy',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    config: {
      workerCount: 3,
      ideasPerWorker: 15,
      webSearch: false,
    },
  };

  it('accepts a valid session', () => {
    const result = SessionSchema.safeParse(validSession);
    expect(result.success).toBe(true);
  });

  it('accepts optional coordinate as undefined', () => {
    const { coordinate, ...rest } = validSession;
    const result = SessionSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.coordinate).toBeUndefined();
    }
  });

  it('validates nested config schema', () => {
    const session = {
      ...validSession,
      config: { workerCount: 0 }, // invalid
    };
    const result = SessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  it('validates status uses StageSchema', () => {
    const session = { ...validSession, status: 'invalid_stage' };
    const result = SessionSchema.safeParse(session);
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const { id, ...rest } = validSession;
    const result = SessionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe('Constants', () => {
  it('BUILT_IN_METHODS has exactly 10 entries', () => {
    expect(BUILT_IN_METHODS).toHaveLength(10);
  });

  it('every BUILT_IN_METHODS entry validates against MethodSchema', () => {
    for (const method of BUILT_IN_METHODS) {
      const result = MethodSchema.safeParse(method);
      expect(result.success).toBe(true);
    }
  });

  it('BUILT_IN_METHODS ids are unique and sequential 1-10', () => {
    const ids = BUILT_IN_METHODS.map((m) => m.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('DEFAULT_PERSONAS has exactly 3 entries', () => {
    expect(DEFAULT_PERSONAS).toHaveLength(3);
  });

  it('every DEFAULT_PERSONAS entry validates against PersonaSchema', () => {
    for (const persona of DEFAULT_PERSONAS) {
      const result = PersonaSchema.safeParse(persona);
      expect(result.success).toBe(true);
    }
  });

  it('DEFAULT_PERSONAS names are The Engineer, The Visionary, The Anthropologist', () => {
    const names = DEFAULT_PERSONAS.map((p) => p.name);
    expect(names).toEqual(['The Engineer', 'The Visionary', 'The Anthropologist']);
  });

  it('STAGE_ORDER has correct sequence', () => {
    expect(STAGE_ORDER).toEqual([
      'taxonomy',
      'methods',
      'rubric',
      'factory',
      'output',
      'completed',
    ]);
  });

  it('every STAGE_ORDER entry validates against StageSchema', () => {
    for (const stage of STAGE_ORDER) {
      const result = StageSchema.safeParse(stage);
      expect(result.success).toBe(true);
    }
  });
});
