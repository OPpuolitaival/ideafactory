import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/setup.js';
import * as schema from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mock: @anthropic-ai/claude-agent-sdk
// ---------------------------------------------------------------------------
const mockQuery = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// ---------------------------------------------------------------------------
// Mock: sseManager – capture all events for ordering assertions
// ---------------------------------------------------------------------------
const emittedEvents: Array<{ sessionId: string; event: { type: string; data: unknown } }> = [];
const mockEmit = vi.fn(
  (sessionId: string, event: { type: string; data: unknown }) => {
    emittedEvents.push({ sessionId, event });
  },
);

vi.mock('../sse/index.js', () => ({
  sseManager: {
    emit: (...args: unknown[]) => mockEmit(...(args as [string, { type: string; data: unknown }])),
    subscribe: vi.fn(),
    hasListeners: vi.fn().mockReturnValue(true),
  },
}));

// ---------------------------------------------------------------------------
// Mock: getDb – replaced per-test with in-memory SQLite
// ---------------------------------------------------------------------------
let testDb: TestDb;

vi.mock('../db/index.js', async () => {
  const actual = await vi.importActual<typeof import('../db/schema.js')>('../db/schema.js');
  return {
    getDb: () => testDb,
    schema: actual,
  };
});

// ---------------------------------------------------------------------------
// Mock: config
// ---------------------------------------------------------------------------
const defaultConfig = {
  defaults: { ideasPerWorker: 2, webSearch: false },
  models: {
    default: 'claude-sonnet-4-20250514',
    navigator: 'claude-haiku-4-20250414',
    strategist: 'claude-sonnet-4-20250514',
    worker: 'claude-sonnet-4-20250514',
    analyst: 'claude-sonnet-4-20250514',
  },
  server: { port: 3000 },
};

const allMethods = [
  { id: 1, name: 'First Principles', description: 'Break into fundamentals', goodFor: 'Rethinking', builtIn: true },
  { id: 3, name: 'TRIZ', description: 'Contradiction-solving', goodFor: 'Trade-offs', builtIn: true },
  { id: 5, name: 'SCAMPER', description: 'Transform existing ideas', goodFor: 'Improvement', builtIn: true },
];

vi.mock('../config/index.js', () => ({
  loadConfig: () => defaultConfig,
  getAllMethods: () => allMethods,
}));

// ---------------------------------------------------------------------------
// LLM Response Fixtures – schema-valid data for each stage
// ---------------------------------------------------------------------------

function queryResult(text: string, structured?: unknown) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'result', result: text, structured_output: structured };
    },
  };
}

// Stage 1: Taxonomy
const taxonomyTree = {
  name: 'Sustainable Urban Mobility',
  p: 'high' as const,
  children: [
    {
      name: 'Electric Vehicles',
      p: 'high' as const,
      children: [
        { name: 'Personal EVs', p: 'high' as const },
        { name: 'Commercial EVs', p: 'medium' as const },
      ],
    },
    {
      name: 'Micro-mobility',
      p: 'medium' as const,
      children: [
        { name: 'E-scooters', p: 'high' as const },
        { name: 'E-bikes', p: 'medium' as const },
      ],
    },
    {
      name: 'Autonomous Transit',
      p: 'low' as const,
      children: [
        { name: 'Robo-taxis', p: 'low' as const },
        { name: 'Drone delivery', p: 'low' as const },
      ],
    },
  ],
};

// Stage 2: Method Selection (recommends 2 of 3 available methods)
const methodRecommendation = {
  recommended: [1, 3],
  reasoning: {
    '1': 'First Principles helps rethink urban mobility from scratch',
    '3': 'TRIZ helps resolve range vs cost contradictions',
  },
};

// Stage 3: Rubric
const rubric = {
  gates: [
    { id: 'g1', text: 'Must be physically possible with current or near-future technology' },
    { id: 'g2', text: 'Must not violate transportation regulations' },
    { id: 'g3', text: 'Must solve a real mobility problem' },
  ],
  criteria: [
    { id: 'c1', text: 'Novelty', weight: 4, description: 'How novel is the approach?' },
    { id: 'c2', text: 'Feasibility', weight: 5, description: 'Can it be built and deployed?' },
    { id: 'c3', text: 'Cost-effectiveness', weight: 3, description: 'Is it affordable?' },
    { id: 'c4', text: 'User Delight', weight: 4, description: 'Will users love it?' },
    { id: 'c5', text: 'Scalability', weight: 3, description: 'Can it scale to many cities?' },
  ],
  tests: [
    { id: 't1', text: 'Explainable in one sentence?' },
    { id: 't2', text: 'Defensible against Uber/Lyft?' },
    { id: 't3', text: 'Positive cost-benefit within 3 years?' },
  ],
};

// Stage 4a: Divergence – Worker 0 ideas (2 ideas, First Principles method)
const worker0Ideas = [
  { id: 'idea-0-1', method: 'First Principles', name: 'SolarPod', description: 'Solar-powered personal mobility pods', probability: 'high' },
  { id: 'idea-0-2', method: 'First Principles', name: 'FlexLane', description: 'Dynamic lane reallocation system', probability: 'medium' },
];

// Stage 4a: Divergence – Worker 1 ideas (2 ideas, TRIZ method)
const worker1Ideas = [
  { id: 'idea-1-1', method: 'TRIZ', name: 'NeighborHub', description: 'Hyperlocal car-sharing hubs in neighborhoods', probability: 'high' },
  { id: 'idea-1-2', method: 'TRIZ', name: 'ModularBus', description: 'Modular bus segments that join/split on route', probability: 'medium' },
];

// Stage 4b: Convergence – scored ideas (4 items in 1 batch, 2 pass gates + 2 fail)
// Code does gate elimination after scoring, so all returned with eliminated: false
const scoredIdeas = [
  {
    id: 'scored-1', sourceIds: ['worker-0-0'], name: 'SolarPod', description: 'Solar-powered mobility pods',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Feasible with current solar tech' },
      { gateId: 'g2', pass: true, reason: 'Classifiable as micro-vehicle' },
      { gateId: 'g3', pass: true, reason: 'Solves last-mile problem' },
    ],
    criteriaScores: [
      { criterionId: 'c1', score: 4, reason: 'Novel form factor' },
      { criterionId: 'c2', score: 4, reason: 'Buildable now' },
      { criterionId: 'c3', score: 3, reason: 'Moderate cost' },
      { criterionId: 'c4', score: 5, reason: 'High delight factor' },
      { criterionId: 'c5', score: 4, reason: 'Scalable manufacturing' },
    ],
    totalScore: 20, eliminated: false,
  },
  {
    id: 'scored-2', sourceIds: ['worker-0-1'], name: 'FlexLane', description: 'Dynamic lane reallocation',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Uses existing roads' },
      { gateId: 'g2', pass: false, reason: 'Complex regulatory approval needed' },
      { gateId: 'g3', pass: true, reason: 'Reduces congestion' },
    ],
    criteriaScores: [],
    totalScore: 0, eliminated: false,
  },
  {
    id: 'scored-3', sourceIds: ['worker-1-0'], name: 'NeighborHub', description: 'Hyperlocal car-sharing hubs',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Uses existing vehicles' },
      { gateId: 'g2', pass: true, reason: 'Fits sharing economy regs' },
      { gateId: 'g3', pass: true, reason: 'Solves access problem' },
    ],
    criteriaScores: [
      { criterionId: 'c1', score: 3, reason: 'Incremental innovation' },
      { criterionId: 'c2', score: 5, reason: 'Uses existing infra' },
      { criterionId: 'c3', score: 4, reason: 'Low cost' },
      { criterionId: 'c4', score: 3, reason: 'Moderate delight' },
      { criterionId: 'c5', score: 5, reason: 'Highly scalable' },
    ],
    totalScore: 20, eliminated: false,
  },
  {
    id: 'scored-4', sourceIds: ['worker-1-1'], name: 'ModularBus', description: 'Modular bus segments',
    gateResults: [
      { gateId: 'g1', pass: false, reason: 'Complex mechanical coupling not proven' },
      { gateId: 'g2', pass: true, reason: 'Software only' },
      { gateId: 'g3', pass: true, reason: 'Addresses routing' },
    ],
    criteriaScores: [],
    totalScore: 0, eliminated: false,
  },
];

// Stage 4c: Evolution – EvolvedConcept from cross-pollination of 2 survivors
const evolvedConcepts = [
  { name: 'SolarHub', description: 'Solar-powered pods integrated with neighborhood sharing hubs', sourceIds: ['scored-1', 'scored-3'] },
];

// Stage 4c: Re-scored evolved concept
const rescoredEvolved = [
  {
    id: 'evolved-0', sourceIds: ['scored-1', 'scored-3'], name: 'SolarHub',
    description: 'Solar-powered pods integrated with neighborhood sharing hubs',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Combined feasible tech' },
      { gateId: 'g2', pass: true, reason: 'Micro-vehicle + sharing regs' },
      { gateId: 'g3', pass: true, reason: 'Multi-modal solution' },
    ],
    criteriaScores: [
      { criterionId: 'c1', score: 5, reason: 'Novel combination' },
      { criterionId: 'c2', score: 5, reason: 'Proven components' },
      { criterionId: 'c3', score: 4, reason: 'Shared cost model' },
      { criterionId: 'c4', score: 5, reason: 'High delight' },
      { criterionId: 'c5', score: 5, reason: 'Hub model scales' },
    ],
    totalScore: 24, eliminated: false,
  },
];

// Stage 4d: QA – 1 result for the evolved concept
const qaResults = [
  {
    conceptId: 'evolved-0',
    feasibilityScore: 5,
    risks: [
      { category: 'Technical', description: 'Battery management', severity: 'medium' as const, mitigation: 'Thermal system' },
      { category: 'Political', description: 'City partnership needed', severity: 'medium' as const, mitigation: 'Pilot programs' },
      { category: 'Competition', description: 'Ride-share incumbents', severity: 'high' as const, mitigation: 'Hyperlocal focus' },
    ],
    verdict: 'strong' as const,
    summary: 'Strong concept combining solar and hub approaches with high scalability.',
  },
];

// Stage 5: Output package
const outputPackage = {
  concepts: [
    {
      rank: 1,
      name: 'SolarHub',
      description: 'Solar-powered pods integrated with neighborhood sharing hubs',
      pros: ['Novel combination', 'Proven components', 'Scalable'],
      cons: ['Battery management', 'City partnership needed'],
      openQuestions: ['Which cities to pilot first?'],
      nextSteps: ['City partnership outreach', 'Prototype build'],
      qaVerdict: 'strong' as const,
    },
  ],
  overallInsights: 'Urban mobility innovation favors infrastructure-light solutions that integrate with existing transit.',
  suggestedNextSprint: ['Build SolarHub pilot proposal', 'Design prototype spec'],
  sessionMetadata: {
    domain: 'Sustainable Urban Mobility',
    coordinate: 'Electric Vehicles > Personal EVs',
    methods: ['First Principles', 'TRIZ'],
    methodCount: 2,
    totalIdeasGenerated: 4,
    totalIdeasSurvived: 1,
    duration: 45000,
  },
};

// Stage 5: Visual artifacts
const visualArtifacts = [
  { type: 'radar_chart' as const, format: 'svg' as const, content: '<svg viewBox="0 0 400 400"><circle cx="200" cy="200" r="150" fill="none" stroke="#666"/></svg>', label: 'Concept Comparison Radar' },
  { type: 'concept_sketch' as const, format: 'svg' as const, content: '<svg viewBox="0 0 300 200"><rect x="50" y="50" width="200" height="100" fill="none" stroke="#0ff"/></svg>', label: 'SolarHub Sketch' },
  { type: 'report_page' as const, format: 'html' as const, content: '<html><body style="background:#0a0a0f;color:#fff"><h1>Session Report</h1></body></html>', label: 'Full Report' },
];

// ---------------------------------------------------------------------------
// Setup mock responses in order:
// taxonomy(1) + methods(1) + rubric(1) + factory(6) + output(2) = 11 calls
// Factory: 2 diverge + 1 converge batch + 1 evolution + 1 rescore + 1 QA = 6
// ---------------------------------------------------------------------------

function setupAllMocks() {
  mockQuery
    // Stage 1: Taxonomy
    .mockReturnValueOnce(queryResult(JSON.stringify(taxonomyTree)))
    // Stage 2: Methods
    .mockReturnValueOnce(queryResult(JSON.stringify(methodRecommendation)))
    // Stage 3: Rubric
    .mockReturnValueOnce(queryResult(JSON.stringify(rubric)))
    // Stage 4a: Divergence worker 0 (First Principles)
    .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
    // Stage 4a: Divergence worker 1 (TRIZ)
    .mockReturnValueOnce(queryResult(JSON.stringify(worker1Ideas)))
    // Stage 4b: Convergence batch (4 ideas in 1 batch)
    .mockReturnValueOnce(queryResult(JSON.stringify(scoredIdeas)))
    // Stage 4c: Evolution worker 0 (1 pair)
    .mockReturnValueOnce(queryResult(JSON.stringify(evolvedConcepts)))
    // Stage 4c: Rescore batch (1 evolved concept)
    .mockReturnValueOnce(queryResult(JSON.stringify(rescoredEvolved)))
    // Stage 4d: QA
    .mockReturnValueOnce(queryResult(JSON.stringify(qaResults)))
    // Stage 5: Output package
    .mockReturnValueOnce(queryResult(JSON.stringify(outputPackage)))
    // Stage 5: Visual artifacts
    .mockReturnValueOnce(queryResult(JSON.stringify(visualArtifacts)));
}

// ==========================================================================
// Integration Test: Full Pipeline (taxonomy → methods → rubric → factory → output)
// ==========================================================================

describe('Integration – Full Pipeline end-to-end', () => {
  let runPipeline: typeof import('./pipeline.js')['runPipeline'];

  const SESSION_ID = 'sess-integration';

  beforeEach(async () => {
    vi.clearAllMocks();
    // mockReset clears the mockReturnValueOnce queue (clearAllMocks does not)
    mockQuery.mockReset();
    // Re-establish the mockEmit implementation after reset
    mockEmit.mockImplementation(
      (sessionId: string, event: { type: string; data: unknown }) => {
        emittedEvents.push({ sessionId, event });
      },
    );
    emittedEvents.length = 0;
    testDb = createTestDb();

    const mod = await import('./pipeline.js');
    runPipeline = mod.runPipeline;

    // Insert the initial session
    await testDb.insert(schema.sessions).values({
      id: SESSION_ID,
      domain: 'Sustainable Urban Mobility',
      coordinate: 'Electric Vehicles > Personal EVs',
      status: 'taxonomy',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      config: JSON.stringify({ ideasPerWorker: 2, webSearch: false }),
    });
  });

  // -----------------------------------------------------------------------
  // 1. Full pipeline runs all 5 stages sequentially without errors
  // -----------------------------------------------------------------------
  it('runs all 5 stages sequentially without errors', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');
    await runPipeline(SESSION_ID, 'output');

    // Should not have emitted any status:error events
    const errorEvents = emittedEvents.filter((e) => e.event.type === 'status:error');
    expect(errorEvents).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 2. Makes exactly 11 LLM calls across all stages
  // -----------------------------------------------------------------------
  it('makes exactly 11 LLM calls across all stages', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');
    await runPipeline(SESSION_ID, 'output');

    // taxonomy=1, methods=1, rubric=1, factory=6 (2 div + 1 conv + 1 evo + 1 rescore + 1 qa), output=2
    expect(mockQuery).toHaveBeenCalledTimes(11);
  });

  // -----------------------------------------------------------------------
  // 3. Taxonomy data persists and feeds into later stages
  // -----------------------------------------------------------------------
  it('persists taxonomy tree to database', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');

    const [taxonomyRow] = await testDb
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, SESSION_ID));

    expect(taxonomyRow).toBeDefined();
    const tree = JSON.parse(taxonomyRow.tree);
    expect(tree.name).toBe('Sustainable Urban Mobility');
    expect(tree.children).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // 4. Method selection persists to database
  // -----------------------------------------------------------------------
  it('persists method selection to database', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');

    const [methodRow] = await testDb
      .select()
      .from(schema.methodSelections)
      .where(eq(schema.methodSelections.sessionId, SESSION_ID));

    expect(methodRow).toBeDefined();
    const recommended = JSON.parse(methodRow.recommended);
    expect(recommended).toEqual([1, 3]);
    const reasoning = JSON.parse(methodRow.reasoning);
    expect(Object.keys(reasoning)).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // 5. Rubric persists to database
  // -----------------------------------------------------------------------
  it('persists rubric to database', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');

    const [rubricRow] = await testDb
      .select()
      .from(schema.rubrics)
      .where(eq(schema.rubrics.sessionId, SESSION_ID));

    expect(rubricRow).toBeDefined();
    const stored = JSON.parse(rubricRow.rubric);
    expect(stored.gates).toHaveLength(3);
    expect(stored.criteria).toHaveLength(5);
    expect(stored.tests).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // 6. Factory produces ideas in all 4 phases (diverge, converge, evolve, qa)
  // -----------------------------------------------------------------------
  it('factory populates all 4 idea phases in the database', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

    const allIdeas = await testDb
      .select()
      .from(schema.ideas)
      .where(eq(schema.ideas.sessionId, SESSION_ID));

    const phases = new Set(allIdeas.map((i) => i.phase));
    expect(phases).toEqual(new Set(['diverge', 'converge', 'evolve', 'qa']));

    // Diverge: 2 workers x 2 ideas = 4
    const divergeRows = allIdeas.filter((i) => i.phase === 'diverge');
    expect(divergeRows).toHaveLength(4);

    // Converge: 4 scored ideas (2 survivors + 2 eliminated)
    const convergeRows = allIdeas.filter((i) => i.phase === 'converge');
    expect(convergeRows).toHaveLength(4);

    // Evolve: 1 re-scored evolved concept
    const evolveRows = allIdeas.filter((i) => i.phase === 'evolve');
    expect(evolveRows).toHaveLength(1);

    // QA: 1 result
    const qaRows = allIdeas.filter((i) => i.phase === 'qa');
    expect(qaRows).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // 7. Output package and artifacts are persisted
  // -----------------------------------------------------------------------
  it('persists output package and visual artifacts', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');
    await runPipeline(SESSION_ID, 'output');

    const [outputRow] = await testDb
      .select()
      .from(schema.outputPackages)
      .where(eq(schema.outputPackages.sessionId, SESSION_ID));

    expect(outputRow).toBeDefined();

    const storedPkg = JSON.parse(outputRow.package);
    expect(storedPkg.concepts).toHaveLength(1);
    expect(storedPkg.concepts[0].name).toBe('SolarHub');
    expect(storedPkg.overallInsights).toContain('infrastructure-light');

    const storedArtifacts = JSON.parse(outputRow.artifacts!);
    expect(storedArtifacts).toHaveLength(3);
    expect(storedArtifacts.map((a: { type: string }) => a.type)).toEqual([
      'radar_chart',
      'concept_sketch',
      'report_page',
    ]);
  });

  // -----------------------------------------------------------------------
  // 8. Session status is 'completed' after full pipeline
  // -----------------------------------------------------------------------
  it('marks session as completed after output stage', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');
    await runPipeline(SESSION_ID, 'output');

    const [session] = await testDb
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, SESSION_ID));

    expect(session.status).toBe('completed');
  });

  // -----------------------------------------------------------------------
  // 9. All 5 stage_complete events fire in correct order
  // -----------------------------------------------------------------------
  it('emits status:stage_complete events in correct order', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');
    await runPipeline(SESSION_ID, 'output');

    const stageCompletes = emittedEvents
      .filter(
        (e) =>
          e.sessionId === SESSION_ID && e.event.type === 'status:stage_complete',
      )
      .map((e) => e.event.data as { stage: string; next: string });

    expect(stageCompletes).toHaveLength(5);
    expect(stageCompletes).toEqual([
      { stage: 'taxonomy', next: 'methods' },
      { stage: 'methods', next: 'rubric' },
      { stage: 'rubric', next: 'factory' },
      { stage: 'factory', next: 'output' },
      { stage: 'output', next: 'completed' },
    ]);
  });

  // -----------------------------------------------------------------------
  // 10. All expected SSE event types appear during the full pipeline
  // -----------------------------------------------------------------------
  it('emits all expected SSE event types during full pipeline', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');
    await runPipeline(SESSION_ID, 'output');

    const eventTypes = new Set(
      emittedEvents
        .filter((e) => e.sessionId === SESSION_ID)
        .map((e) => e.event.type),
    );

    // Core data events from each stage
    expect(eventTypes).toContain('data:taxonomy_update');
    expect(eventTypes).toContain('data:methods_recommended');
    expect(eventTypes).toContain('data:rubric_generated');
    expect(eventTypes).toContain('data:idea_stream');
    expect(eventTypes).toContain('data:convergence_result');
    expect(eventTypes).toContain('data:evolution_result');
    expect(eventTypes).toContain('data:qa_result');
    expect(eventTypes).toContain('data:output_package');

    // Lifecycle events
    expect(eventTypes).toContain('agent:thought');
    expect(eventTypes).toContain('status:stage_complete');
  });

  // -----------------------------------------------------------------------
  // 11. Data flows correctly between stages (rubric stage reads method selection from DB)
  // -----------------------------------------------------------------------
  it('rubric stage reads methods selected in method stage from DB', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');

    // Verify the rubric LLM call (3rd call, index 2) mentions the selected methods
    const rubricPrompt = mockQuery.mock.calls[2][0].prompt;
    expect(rubricPrompt).toContain('First Principles');
    expect(rubricPrompt).toContain('TRIZ');
  });

  // -----------------------------------------------------------------------
  // 12. Factory stage reads rubric and methods from DB
  // -----------------------------------------------------------------------
  it('factory stage reads rubric and methods from previous stages', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

    // Factory diverge calls (4th and 5th, indices 3,4) should reference rubric gates
    const divergeCall0 = mockQuery.mock.calls[3][0];
    expect(divergeCall0.prompt).toContain('Must be physically possible');
    expect(divergeCall0.prompt).toContain('Novelty');

    // Factory convergence call (6th, index 5) should include all raw ideas + rubric
    const convergeCall = mockQuery.mock.calls[5][0];
    expect(convergeCall.prompt).toContain('worker-0-0');
    expect(convergeCall.prompt).toContain('worker-1-0');
  });

  // -----------------------------------------------------------------------
  // 13. Output stage reads all ideas from DB
  // -----------------------------------------------------------------------
  it('output stage receives ideas from all phases', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');
    await runPipeline(SESSION_ID, 'output');

    // Output call (10th, index 9) should reference evolved concept
    const outputPrompt = mockQuery.mock.calls[9][0].prompt;
    expect(outputPrompt).toContain('SolarHub');
  });

  // -----------------------------------------------------------------------
  // 14. All DB tables populated after full pipeline
  // -----------------------------------------------------------------------
  it('populates all database tables after full pipeline', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');
    await runPipeline(SESSION_ID, 'output');

    // Sessions
    const sessions = await testDb.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('completed');

    // Taxonomy trees
    const trees = await testDb.select().from(schema.taxonomyTrees);
    expect(trees).toHaveLength(1);

    // Method selections
    const methods = await testDb.select().from(schema.methodSelections);
    expect(methods).toHaveLength(1);

    // Rubrics
    const rubrics = await testDb.select().from(schema.rubrics);
    expect(rubrics).toHaveLength(1);

    // Ideas (across all phases): 4 diverge + 4 converge + 1 evolve + 1 qa = 10
    const ideas = await testDb.select().from(schema.ideas);
    expect(ideas.length).toBeGreaterThanOrEqual(10);

    // Output packages
    const outputs = await testDb.select().from(schema.outputPackages);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].artifacts).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 15. Convergence correctly separates survivors from eliminated
  // -----------------------------------------------------------------------
  it('correctly tracks survivors and eliminated ideas through factory', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

    const convergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, SESSION_ID), eq(schema.ideas.phase, 'converge')));

    const survivors = convergeRows.filter((r) => r.eliminated === 0);
    const eliminated = convergeRows.filter((r) => r.eliminated === 1);

    expect(survivors).toHaveLength(2);
    expect(eliminated).toHaveLength(2);

    // Survivors should have positive scores
    for (const s of survivors) {
      expect(s.score).toBeGreaterThan(0);
    }
    // Eliminated should have score 0
    for (const e of eliminated) {
      expect(e.score).toBe(0);
    }
  });

  // -----------------------------------------------------------------------
  // 16. Model routing is correct per stage
  // -----------------------------------------------------------------------
  it('uses correct models per stage', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');
    await runPipeline(SESSION_ID, 'output');

    // Call 0: taxonomy → navigator model
    expect(mockQuery.mock.calls[0][0].options.model).toBe('claude-haiku-4-20250414');

    // Call 1: methods → strategist model
    expect(mockQuery.mock.calls[1][0].options.model).toBe('claude-sonnet-4-20250514');

    // Call 2: rubric → strategist model
    expect(mockQuery.mock.calls[2][0].options.model).toBe('claude-sonnet-4-20250514');

    // Calls 3-4: factory diverge → worker model
    expect(mockQuery.mock.calls[3][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[4][0].options.model).toBe('claude-sonnet-4-20250514');

    // Calls 5-8: factory converge/evolve/rescore/qa → analyst model
    expect(mockQuery.mock.calls[5][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[6][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[7][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[8][0].options.model).toBe('claude-sonnet-4-20250514');

    // Calls 9-10: output → analyst model
    expect(mockQuery.mock.calls[9][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[10][0].options.model).toBe('claude-sonnet-4-20250514');
  });

  // -----------------------------------------------------------------------
  // 17. Diverge ideas have correct workerId and persona enrichment
  // -----------------------------------------------------------------------
  it('enriches diverge ideas with workerId and persona', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

    const divergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, SESSION_ID), eq(schema.ideas.phase, 'diverge')));

    const worker0Rows = divergeRows.filter((r) => r.workerId === 'worker-0');
    const worker1Rows = divergeRows.filter((r) => r.workerId === 'worker-1');

    expect(worker0Rows).toHaveLength(2);
    expect(worker1Rows).toHaveLength(2);

    for (const row of worker0Rows) {
      expect(row.persona).toBe('First Principles');
    }
    for (const row of worker1Rows) {
      expect(row.persona).toBe('TRIZ');
    }
  });

  // -----------------------------------------------------------------------
  // 18. QA verdicts correctly set eliminated flag
  // -----------------------------------------------------------------------
  it('QA verdicts correctly set eliminated flag', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

    const qaRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, SESSION_ID), eq(schema.ideas.phase, 'qa')));

    // 1 verdict "strong" → eliminated=0
    expect(qaRows).toHaveLength(1);
    for (const row of qaRows) {
      expect(row.eliminated).toBe(0);
    }
  });

  // -----------------------------------------------------------------------
  // 19. Agent thought events reference correct agent names
  // -----------------------------------------------------------------------
  it('agent thought events reference correct agent names across pipeline', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');
    await runPipeline(SESSION_ID, 'output');

    const thoughts = emittedEvents
      .filter((e) => e.sessionId === SESSION_ID && e.event.type === 'agent:thought')
      .map((e) => (e.event.data as { agent: string }).agent);

    const uniqueAgents = new Set(thoughts);

    expect(uniqueAgents).toContain('Navigator');
    expect(uniqueAgents).toContain('Strategist');
    expect(uniqueAgents).toContain('Factory');
    expect(uniqueAgents).toContain('Analyst');

    // Worker agents
    const workerAgents = thoughts.filter((a) => a.startsWith('Worker'));
    expect(workerAgents.length).toBeGreaterThanOrEqual(4); // at least start+complete per worker
  });

  // -----------------------------------------------------------------------
  // 20. idea_stream events fire for each diverge idea
  // -----------------------------------------------------------------------
  it('emits data:idea_stream for each diverge idea', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

    const ideaStreamEvents = emittedEvents.filter(
      (e) => e.sessionId === SESSION_ID && e.event.type === 'data:idea_stream',
    );

    // 2 workers x 2 ideas = 4 events
    expect(ideaStreamEvents).toHaveLength(4);

    // Each should have workerId and persona
    for (const e of ideaStreamEvents) {
      const data = e.event.data as { workerId: string; persona: string; idea: unknown };
      expect(data.workerId).toBeDefined();
      expect(data.persona).toBeDefined();
      expect(data.idea).toBeDefined();
    }
  });

  // -----------------------------------------------------------------------
  // 21. Error in one stage prevents stage_complete and emits status:error
  // -----------------------------------------------------------------------
  it('emits status:error when a stage fails', async () => {
    // Only set up taxonomy mock, then fail on methods
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(taxonomyTree)))
      .mockImplementationOnce(() => { throw new Error('Rate limit exceeded'); });

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');

    const stageCompletes = emittedEvents
      .filter((e) => e.event.type === 'status:stage_complete')
      .map((e) => (e.event.data as { stage: string }).stage);

    // Only taxonomy should complete, not methods
    expect(stageCompletes).toContain('taxonomy');
    expect(stageCompletes).not.toContain('methods');

    // Error event should fire for methods stage
    const errors = emittedEvents.filter((e) => e.event.type === 'status:error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});
