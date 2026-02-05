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
  defaults: { workerCount: 2, ideasPerWorker: 3, webSearch: false },
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

const allPersonas = [
  { name: 'The Engineer', systemPrompt: 'You are The Engineer. Practical, detail-oriented.', defaultMethod: 'First Principles', builtIn: true },
  { name: 'The Visionary', systemPrompt: 'You are The Visionary. Bold, future-focused.', defaultMethod: 'SCAMPER', builtIn: true },
];

vi.mock('../config/index.js', () => ({
  loadConfig: () => defaultConfig,
  getAllMethods: () => allMethods,
  getAllPersonas: () => allPersonas,
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

// Stage 2: Method Selection
const methodRecommendation = {
  recommended: [1, 3, 5],
  reasoning: {
    '1': 'First Principles helps rethink urban mobility from scratch',
    '3': 'TRIZ helps resolve range vs cost contradictions',
    '5': 'SCAMPER transforms existing transit concepts',
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

// Stage 4a: Divergence – Worker 0 ideas
const worker0Ideas = [
  { id: 'idea-0-1', method: 'First Principles', name: 'SolarPod', description: 'Solar-powered personal mobility pods', probability: 'high' },
  { id: 'idea-0-2', method: 'TRIZ', name: 'FlexLane', description: 'Dynamic lane reallocation system', probability: 'medium' },
  { id: 'idea-0-3', method: 'SCAMPER', name: 'AirBridge', description: 'Lightweight aerial cable cars for urban areas', probability: 'low' },
];

// Stage 4a: Divergence – Worker 1 ideas
const worker1Ideas = [
  { id: 'idea-1-1', method: 'SCAMPER', name: 'NeighborHub', description: 'Hyperlocal car-sharing hubs in neighborhoods', probability: 'high' },
  { id: 'idea-1-2', method: 'First Principles', name: 'ModularBus', description: 'Modular bus segments that join/split on route', probability: 'medium' },
  { id: 'idea-1-3', method: 'TRIZ', name: 'QuantumRoute', description: 'Quantum-optimized routing for existing transit', probability: 'low' },
];

// Stage 4b: Convergence – scored ideas
const scoredIdeas = [
  {
    id: 'scored-1', sourceIds: ['idea-0-1'], name: 'SolarPod', description: 'Solar-powered mobility pods',
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
    id: 'scored-2', sourceIds: ['idea-1-1', 'idea-0-2'], name: 'NeighborHub+FlexLane', description: 'Combined hub and dynamic lane system',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Both feasible' },
      { gateId: 'g2', pass: true, reason: 'Regulatory path exists' },
      { gateId: 'g3', pass: true, reason: 'Multi-modal solution' },
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
    id: 'scored-3', sourceIds: ['idea-0-3'], name: 'AirBridge', description: 'Urban aerial cable cars',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Technically feasible' },
      { gateId: 'g2', pass: false, reason: 'Complex airspace regulation' },
      { gateId: 'g3', pass: true, reason: 'Solves congestion' },
    ],
    criteriaScores: [],
    totalScore: 0, eliminated: true, eliminationReason: 'Failed gate g2: airspace regulations',
  },
  {
    id: 'scored-4', sourceIds: ['idea-1-3'], name: 'QuantumRoute', description: 'Quantum routing',
    gateResults: [
      { gateId: 'g1', pass: false, reason: 'Quantum computers not mature enough' },
      { gateId: 'g2', pass: true, reason: 'Software only' },
      { gateId: 'g3', pass: true, reason: 'Addresses routing' },
    ],
    criteriaScores: [],
    totalScore: 0, eliminated: true, eliminationReason: 'Failed gate g1: technology not ready',
  },
];

// Stage 4c: Evolution – only survivors
const evolvedIdeas = [
  {
    id: 'scored-1', sourceIds: ['idea-0-1'], name: 'SolarPod v2', description: 'Improved solar pods with swappable batteries and subscription pricing',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Enhanced design' },
      { gateId: 'g2', pass: true, reason: 'Still micro-vehicle' },
      { gateId: 'g3', pass: true, reason: 'Expanded use cases' },
    ],
    criteriaScores: [
      { criterionId: 'c1', score: 5, reason: 'More novel with battery swapping' },
      { criterionId: 'c2', score: 4, reason: 'Buildable' },
      { criterionId: 'c3', score: 4, reason: 'Subscription reduces upfront cost' },
      { criterionId: 'c4', score: 5, reason: 'Even higher delight' },
      { criterionId: 'c5', score: 4, reason: 'Scale via franchising' },
    ],
    totalScore: 22, eliminated: false,
  },
  {
    id: 'scored-2', sourceIds: ['idea-1-1', 'idea-0-2'], name: 'SmartHub Network', description: 'AI-managed neighborhood mobility hubs with dynamic lane priority',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Proven tech' },
      { gateId: 'g2', pass: true, reason: 'City partnership model' },
      { gateId: 'g3', pass: true, reason: 'Multi-modal coverage' },
    ],
    criteriaScores: [
      { criterionId: 'c1', score: 4, reason: 'AI management novel' },
      { criterionId: 'c2', score: 5, reason: 'Leverages existing infra' },
      { criterionId: 'c3', score: 5, reason: 'Very cost effective' },
      { criterionId: 'c4', score: 4, reason: 'Convenient access' },
      { criterionId: 'c5', score: 5, reason: 'Franchisable model' },
    ],
    totalScore: 23, eliminated: false,
  },
];

// Stage 4d: QA
const qaResults = [
  {
    conceptId: 'scored-1',
    feasibilityScore: 4,
    risks: [
      { category: 'Technical', description: 'Battery degradation in heat', severity: 'medium' as const, mitigation: 'Use thermal management system' },
      { category: 'Market', description: 'Consumer adoption uncertainty', severity: 'medium' as const },
      { category: 'Regulatory', description: 'Micro-vehicle classification varies by city', severity: 'low' as const },
    ],
    verdict: 'strong' as const,
    summary: 'Strong concept with manageable technical risks and high user appeal.',
  },
  {
    conceptId: 'scored-2',
    feasibilityScore: 5,
    risks: [
      { category: 'Political', description: 'Requires city government partnership', severity: 'medium' as const, mitigation: 'Start with pilot programs' },
      { category: 'Operational', description: 'Fleet management complexity', severity: 'low' as const },
      { category: 'Competition', description: 'Existing ride-share incumbents', severity: 'high' as const, mitigation: 'Differentiate on hyperlocal focus' },
    ],
    verdict: 'strong' as const,
    summary: 'Highly feasible concept with strong scalability but competitive pressure.',
  },
];

// Stage 5: Output package
const outputPackage = {
  concepts: [
    {
      rank: 1,
      name: 'SmartHub Network',
      description: 'AI-managed neighborhood mobility hubs with dynamic lane priority',
      pros: ['Cost effective', 'Uses existing infrastructure', 'Scalable'],
      cons: ['Requires city partnership', 'Competitive market'],
      openQuestions: ['Which cities to pilot first?'],
      nextSteps: ['City partnership outreach', 'Pilot program design'],
      qaVerdict: 'strong' as const,
    },
    {
      rank: 2,
      name: 'SolarPod v2',
      description: 'Solar-powered personal mobility pods with subscription model',
      pros: ['High user delight', 'Novel form factor', 'Green energy'],
      cons: ['Battery management needed', 'Consumer adoption risk'],
      openQuestions: ['Pricing model validation?'],
      nextSteps: ['Prototype build', 'Focus group testing'],
      qaVerdict: 'strong' as const,
    },
  ],
  overallInsights: 'Urban mobility innovation favors infrastructure-light solutions that integrate with existing transit.',
  suggestedNextSprint: ['Build SmartHub pilot proposal', 'Design SolarPod prototype spec'],
  sessionMetadata: {
    domain: 'Sustainable Urban Mobility',
    coordinate: 'Electric Vehicles > Personal EVs',
    methods: ['First Principles', 'TRIZ', 'SCAMPER'],
    workerCount: 2,
    totalIdeasGenerated: 6,
    totalIdeasSurvived: 2,
    duration: 45000,
  },
};

// Stage 5: Visual artifacts
const visualArtifacts = [
  { type: 'radar_chart' as const, format: 'svg' as const, content: '<svg viewBox="0 0 400 400"><circle cx="200" cy="200" r="150" fill="none" stroke="#666"/></svg>', label: 'Concept Comparison Radar' },
  { type: 'concept_sketch' as const, format: 'svg' as const, content: '<svg viewBox="0 0 300 200"><rect x="50" y="50" width="200" height="100" fill="none" stroke="#0ff"/></svg>', label: 'SolarPod v2 Sketch' },
  { type: 'report_page' as const, format: 'html' as const, content: '<html><body style="background:#0a0a0f;color:#fff"><h1>Session Report</h1></body></html>', label: 'Full Report' },
];

// ---------------------------------------------------------------------------
// Setup mock responses in order: taxonomy(1) + methods(1) + rubric(1) + factory(5) + output(2) = 10 calls
// ---------------------------------------------------------------------------

function setupAllMocks() {
  mockQuery
    // Stage 1: Taxonomy
    .mockReturnValueOnce(queryResult(JSON.stringify(taxonomyTree)))
    // Stage 2: Methods
    .mockReturnValueOnce(queryResult(JSON.stringify(methodRecommendation)))
    // Stage 3: Rubric
    .mockReturnValueOnce(queryResult(JSON.stringify(rubric)))
    // Stage 4a: Divergence worker 0
    .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
    // Stage 4a: Divergence worker 1
    .mockReturnValueOnce(queryResult(JSON.stringify(worker1Ideas)))
    // Stage 4b: Convergence
    .mockReturnValueOnce(queryResult(JSON.stringify(scoredIdeas)))
    // Stage 4c: Evolution
    .mockReturnValueOnce(queryResult(JSON.stringify(evolvedIdeas)))
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
      config: JSON.stringify({ workerCount: 2, ideasPerWorker: 3, webSearch: false }),
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
  // 2. Makes exactly 10 LLM calls across all stages
  // -----------------------------------------------------------------------
  it('makes exactly 10 LLM calls across all stages', async () => {
    setupAllMocks();

    await runPipeline(SESSION_ID, 'taxonomy');
    await runPipeline(SESSION_ID, 'methods');
    await runPipeline(SESSION_ID, 'rubric');
    await runPipeline(SESSION_ID, 'factory');
    await runPipeline(SESSION_ID, 'output');

    // taxonomy=1, methods=1, rubric=1, factory=5 (2 div + 1 conv + 1 evo + 1 qa), output=2
    expect(mockQuery).toHaveBeenCalledTimes(10);
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
    expect(recommended).toEqual([1, 3, 5]);
    const reasoning = JSON.parse(methodRow.reasoning);
    expect(Object.keys(reasoning)).toHaveLength(3);
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

    // Diverge: 2 workers x 3 ideas = 6
    const divergeRows = allIdeas.filter((i) => i.phase === 'diverge');
    expect(divergeRows).toHaveLength(6);

    // Converge: 4 scored ideas (2 survivors + 2 eliminated)
    const convergeRows = allIdeas.filter((i) => i.phase === 'converge');
    expect(convergeRows).toHaveLength(4);

    // Evolve: 2 evolved survivors
    const evolveRows = allIdeas.filter((i) => i.phase === 'evolve');
    expect(evolveRows).toHaveLength(2);

    // QA: 2 results
    const qaRows = allIdeas.filter((i) => i.phase === 'qa');
    expect(qaRows).toHaveLength(2);
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
    expect(storedPkg.concepts).toHaveLength(2);
    expect(storedPkg.concepts[0].name).toBe('SmartHub Network');
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
    expect(rubricPrompt).toContain('SCAMPER');
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
    expect(convergeCall.prompt).toContain('idea-0-1');
    expect(convergeCall.prompt).toContain('idea-1-1');
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

    // Output call (9th, index 8) should reference evolved concepts
    const outputPrompt = mockQuery.mock.calls[8][0].prompt;
    expect(outputPrompt).toContain('SolarPod v2');
    expect(outputPrompt).toContain('SmartHub Network');
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

    // Ideas (across all phases)
    const ideas = await testDb.select().from(schema.ideas);
    expect(ideas.length).toBeGreaterThanOrEqual(14); // 6 diverge + 4 converge + 2 evolve + 2 qa

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

    // Calls 5-7: factory converge/evolve/qa → analyst model
    expect(mockQuery.mock.calls[5][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[6][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[7][0].options.model).toBe('claude-sonnet-4-20250514');

    // Calls 8-9: output → analyst model
    expect(mockQuery.mock.calls[8][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[9][0].options.model).toBe('claude-sonnet-4-20250514');
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

    expect(worker0Rows).toHaveLength(3);
    expect(worker1Rows).toHaveLength(3);

    for (const row of worker0Rows) {
      expect(row.persona).toBe('The Engineer');
    }
    for (const row of worker1Rows) {
      expect(row.persona).toBe('The Visionary');
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

    // Both verdicts are "strong" so both should have eliminated=0
    expect(qaRows).toHaveLength(2);
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

    // 2 workers x 3 ideas = 6 events
    expect(ideaStreamEvents).toHaveLength(6);

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
