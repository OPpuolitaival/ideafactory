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

// Stage 1: Taxonomy — skeleton (top-level only, empty children)
const taxonomySkeleton = {
  name: 'Sustainable Urban Mobility',
  p: 'high' as const,
  children: [
    { name: 'Electric Vehicles', p: 'high' as const, children: [] },
    { name: 'Micro-mobility', p: 'medium' as const, children: [] },
    { name: 'Autonomous Transit', p: 'low' as const, children: [] },
  ],
};

// Stage 1: Taxonomy — expanded branches
const expandedBranches = [
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
];

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


// ---------------------------------------------------------------------------
// Setup mock responses in order:
// taxonomy(4: 1 skeleton + 3 branches) + methods(1) + rubric(1) + factory(5) = 11 calls
// Factory: 2 diverge + 1 converge batch + 1 evolution + 1 rescore = 5
// ---------------------------------------------------------------------------

function setupAllMocks() {
  mockQuery
    // Stage 1: Taxonomy skeleton
    .mockReturnValueOnce(queryResult(JSON.stringify(taxonomySkeleton)))
    // Stage 1: Taxonomy branch expansions (3 branches)
    .mockReturnValueOnce(queryResult(JSON.stringify(expandedBranches[0])))
    .mockReturnValueOnce(queryResult(JSON.stringify(expandedBranches[1])))
    .mockReturnValueOnce(queryResult(JSON.stringify(expandedBranches[2])))
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
    .mockReturnValueOnce(queryResult(JSON.stringify(rescoredEvolved)));
}

// ==========================================================================
// Integration Test: Full Pipeline (taxonomy → methods → rubric → factory)
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
  // 1. Full pipeline runs all 4 stages sequentially without errors
  // -----------------------------------------------------------------------
  it('runs all 4 stages sequentially without errors', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

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

    // taxonomy=4 (1 skeleton + 3 branches), methods=1, rubric=1, factory=5 (2 div + 1 conv + 1 evo + 1 rescore)
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
  });

  // -----------------------------------------------------------------------
  // 6. Factory produces ideas in 3 phases (diverge, converge, evolve)
  // -----------------------------------------------------------------------
  it('factory populates all 3 idea phases in the database', async () => {
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
    expect(phases).toEqual(new Set(['diverge', 'converge', 'evolve']));

    // Diverge: 2 workers x 2 ideas = 4
    const divergeRows = allIdeas.filter((i) => i.phase === 'diverge');
    expect(divergeRows).toHaveLength(4);

    // Converge: 4 scored ideas (2 survivors + 2 eliminated)
    const convergeRows = allIdeas.filter((i) => i.phase === 'converge');
    expect(convergeRows).toHaveLength(4);

    // Evolve: 1 re-scored evolved concept
    const evolveRows = allIdeas.filter((i) => i.phase === 'evolve');
    expect(evolveRows).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // 7. Pipeline does not advance session status (that's the tRPC layer's job)
  // -----------------------------------------------------------------------
  it('pipeline does not auto-advance session status', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

    const [session] = await testDb
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, SESSION_ID));

    // Pipeline never updates session.status — tRPC session.advance does that
    expect(session.status).toBe('taxonomy');

    // But no errors should have occurred
    const errorEvents = emittedEvents.filter((e) => e.event.type === 'status:error');
    expect(errorEvents).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 9. Stage_complete events fire for taxonomy, methods, rubric (factory stays interactive)
  // -----------------------------------------------------------------------
  it('emits status:stage_complete events in correct order', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

    const stageCompletes = emittedEvents
      .filter(
        (e) =>
          e.sessionId === SESSION_ID && e.event.type === 'status:stage_complete',
      )
      .map((e) => e.event.data as { stage: string; next: string });

    // Factory does not emit stage_complete (stays in interactive mode)
    expect(stageCompletes).toHaveLength(3);
    expect(stageCompletes).toEqual([
      { stage: 'taxonomy', next: 'methods' },
      { stage: 'methods', next: 'rubric' },
      { stage: 'rubric', next: 'factory' },
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
    expect(eventTypes).toContain('factory:interactive');

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

    // Verify the rubric LLM call (index 5: 0=skeleton, 1-3=branches, 4=methods, 5=rubric)
    const rubricPrompt = mockQuery.mock.calls[5][0].prompt;
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

    // Factory diverge calls (indices 6,7) should reference rubric gates
    const divergeCall0 = mockQuery.mock.calls[6][0];
    expect(divergeCall0.prompt).toContain('Must be physically possible');
    expect(divergeCall0.prompt).toContain('Novelty');

    // Factory convergence call (index 8) should include all raw ideas + rubric
    const convergeCall = mockQuery.mock.calls[8][0];
    expect(convergeCall.prompt).toContain('worker-0-0');
    expect(convergeCall.prompt).toContain('worker-1-0');
  });

  // -----------------------------------------------------------------------
  // 13. All DB tables populated after full pipeline
  // -----------------------------------------------------------------------
  it('populates all database tables after full pipeline', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

    // Sessions (pipeline doesn't update status — stays at initial value)
    const sessions = await testDb.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);

    // Taxonomy trees
    const trees = await testDb.select().from(schema.taxonomyTrees);
    expect(trees).toHaveLength(1);

    // Method selections
    const methods = await testDb.select().from(schema.methodSelections);
    expect(methods).toHaveLength(1);

    // Rubrics
    const rubrics = await testDb.select().from(schema.rubrics);
    expect(rubrics).toHaveLength(1);

    // Ideas (across all phases): 4 diverge + 4 converge + 1 evolve = 9
    const ideas = await testDb.select().from(schema.ideas);
    expect(ideas.length).toBeGreaterThanOrEqual(9);
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

    // Call 0: taxonomy skeleton → navigator model
    expect(mockQuery.mock.calls[0][0].options.model).toBe('claude-haiku-4-20250414');

    // Calls 1-3: taxonomy branch expansion → navigator model
    expect(mockQuery.mock.calls[1][0].options.model).toBe('claude-haiku-4-20250414');
    expect(mockQuery.mock.calls[2][0].options.model).toBe('claude-haiku-4-20250414');
    expect(mockQuery.mock.calls[3][0].options.model).toBe('claude-haiku-4-20250414');

    // Call 4: methods → strategist model
    expect(mockQuery.mock.calls[4][0].options.model).toBe('claude-sonnet-4-20250514');

    // Call 5: rubric → strategist model
    expect(mockQuery.mock.calls[5][0].options.model).toBe('claude-sonnet-4-20250514');

    // Calls 6-7: factory diverge → worker model
    expect(mockQuery.mock.calls[6][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[7][0].options.model).toBe('claude-sonnet-4-20250514');

    // Calls 8-10: factory converge/evolve/rescore → analyst model
    expect(mockQuery.mock.calls[8][0].options.model).toBe('claude-sonnet-4-20250514');
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
  // 18. Agent thought events reference correct agent names
  // -----------------------------------------------------------------------
  it('agent thought events reference correct agent names across pipeline', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

    const thoughts = emittedEvents
      .filter((e) => e.sessionId === SESSION_ID && e.event.type === 'agent:thought')
      .map((e) => (e.event.data as { agent: string }).agent);

    const uniqueAgents = new Set(thoughts);

    expect(uniqueAgents).toContain('Navigator');
    expect(uniqueAgents).toContain('Strategist');
    expect(uniqueAgents).toContain('Factory');

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
    // Set up taxonomy skeleton + branches, then fail on methods
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(taxonomySkeleton)))
      .mockReturnValueOnce(queryResult(JSON.stringify(expandedBranches[0])))
      .mockReturnValueOnce(queryResult(JSON.stringify(expandedBranches[1])))
      .mockReturnValueOnce(queryResult(JSON.stringify(expandedBranches[2])))
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

  // -----------------------------------------------------------------------
  // 22. Factory emits factory:interactive with combined pool
  // -----------------------------------------------------------------------
  it('factory emits factory:interactive with combined pool', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');

    const interactiveEvents = emittedEvents.filter(
      (e) => e.sessionId === SESSION_ID && e.event.type === 'factory:interactive',
    );

    expect(interactiveEvents).toHaveLength(1);
    const data = interactiveEvents[0].event.data as { combinedPool: unknown[] };
    expect(data.combinedPool).toBeDefined();
    expect(data.combinedPool.length).toBeGreaterThan(0);
  });
});
