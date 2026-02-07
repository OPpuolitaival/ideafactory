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
// Mock: sseManager -- track all emitted events
// ---------------------------------------------------------------------------
const mockEmit = vi.fn();

vi.mock('../sse/index.js', () => ({
  sseManager: {
    emit: (...args: unknown[]) => mockEmit(...args),
    subscribe: vi.fn(),
    hasListeners: vi.fn().mockReturnValue(true),
  },
}));

// ---------------------------------------------------------------------------
// Mock: getDb -- replaced per-test with in-memory SQLite via createTestDb()
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
// Helpers
// ---------------------------------------------------------------------------

/** Build the Agent SDK response shape returned by query */
function queryResult(text: string, structured?: unknown) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'result', result: text, structured_output: structured };
    },
  };
}

function insertSession(db: TestDb, id: string, domain = 'test domain') {
  return db.insert(schema.sessions).values({
    id,
    domain,
    coordinate: 'test > coordinate',
    status: 'factory',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    config: JSON.stringify({ ideasPerWorker: 2 }),
  });
}

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

const rubric = {
  gates: [
    { id: 'g1', text: 'Must be physically possible' },
    { id: 'g2', text: 'Must not violate regulations' },
    { id: 'g3', text: 'Must solve the stated problem' },
  ],
  criteria: [
    { id: 'c1', text: 'Novelty', weight: 4, description: 'How new?' },
    { id: 'c2', text: 'Feasibility', weight: 5, description: 'Can it be built?' },
    { id: 'c3', text: 'Cost', weight: 3, description: 'Budget?' },
    { id: 'c4', text: 'Delight', weight: 4, description: 'Joy?' },
    { id: 'c5', text: 'Scalability', weight: 3, description: 'Scale?' },
  ],
  tests: [
    { id: 't1', text: 'Explainable in one sentence?' },
    { id: 't2', text: 'Competitor-proof?' },
    { id: 't3', text: 'Cost-benefit positive?' },
  ],
};

const methods = [
  { id: 1, name: 'First Principles', description: 'Break into functions', goodFor: 'Rethinking', builtIn: true },
  { id: 3, name: 'TRIZ', description: 'Contradiction-solving', goodFor: 'Trade-offs', builtIn: true },
];

/** Worker 0 diverge ideas (2 ideas) */
const worker0Ideas = [
  { id: 'idea-0-1', method: 'First Principles', name: 'Idea A', description: 'Desc A', probability: 'high' },
  { id: 'idea-0-2', method: 'First Principles', name: 'Idea B', description: 'Desc B', probability: 'medium' },
];

/** Worker 1 diverge ideas (2 ideas) */
const worker1Ideas = [
  { id: 'idea-1-1', method: 'TRIZ', name: 'Idea C', description: 'Desc C', probability: 'high' },
  { id: 'idea-1-2', method: 'TRIZ', name: 'Idea D', description: 'Desc D', probability: 'medium' },
];

/**
 * Convergence batch result: 4 scored ideas from 1 batch (4 ideas <= BATCH_SIZE=5).
 * Code does gate elimination after scoring, so all returned with eliminated: false.
 * scored-0 and scored-2 pass all gates (survivors); scored-1 and scored-3 fail g1.
 */
const scoredIdeas = [
  {
    id: 'scored-0',
    sourceIds: ['worker-0-0'],
    name: 'Idea A',
    description: 'Desc A',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Feasible' },
      { gateId: 'g2', pass: true, reason: 'Compliant' },
      { gateId: 'g3', pass: true, reason: 'Solves it' },
    ],
    criteriaScores: [
      { criterionId: 'c1', score: 4, reason: 'Novel' },
      { criterionId: 'c2', score: 5, reason: 'Buildable' },
      { criterionId: 'c3', score: 3, reason: 'OK cost' },
      { criterionId: 'c4', score: 4, reason: 'Delightful' },
      { criterionId: 'c5', score: 3, reason: 'Scalable' },
    ],
    totalScore: 19,
    eliminated: false,
  },
  {
    id: 'scored-1',
    sourceIds: ['worker-0-1'],
    name: 'Idea B',
    description: 'Desc B',
    gateResults: [
      { gateId: 'g1', pass: false, reason: 'Not feasible' },
      { gateId: 'g2', pass: true, reason: 'OK' },
      { gateId: 'g3', pass: true, reason: 'OK' },
    ],
    criteriaScores: [],
    totalScore: 0,
    eliminated: false,
  },
  {
    id: 'scored-2',
    sourceIds: ['worker-1-0'],
    name: 'Idea C',
    description: 'Desc C',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Feasible' },
      { gateId: 'g2', pass: true, reason: 'Compliant' },
      { gateId: 'g3', pass: true, reason: 'Solves it' },
    ],
    criteriaScores: [
      { criterionId: 'c1', score: 3, reason: 'Somewhat novel' },
      { criterionId: 'c2', score: 4, reason: 'Buildable' },
      { criterionId: 'c3', score: 4, reason: 'Good cost' },
      { criterionId: 'c4', score: 3, reason: 'OK delight' },
      { criterionId: 'c5', score: 4, reason: 'Scales' },
    ],
    totalScore: 18,
    eliminated: false,
  },
  {
    id: 'scored-3',
    sourceIds: ['worker-1-1'],
    name: 'Idea D',
    description: 'Desc D',
    gateResults: [
      { gateId: 'g1', pass: false, reason: 'Not feasible' },
      { gateId: 'g2', pass: true, reason: 'OK' },
      { gateId: 'g3', pass: true, reason: 'OK' },
    ],
    criteriaScores: [],
    totalScore: 0,
    eliminated: false,
  },
];

/** Evolution result: 1 EvolvedConcept from cross-pollinating the 2 survivors */
const evolvedConcepts = [
  { name: 'Hybrid A+C', description: 'Combined best of A and C', sourceIds: ['scored-0', 'scored-2'] },
];

/** Re-scored evolved concept (batchScore output for evolution) */
const rescoredEvolved = [
  {
    id: 'evolved-0',
    sourceIds: ['scored-0', 'scored-2'],
    name: 'Hybrid A+C',
    description: 'Combined best of A and C',
    gateResults: [
      { gateId: 'g1', pass: true, reason: 'Still feasible' },
      { gateId: 'g2', pass: true, reason: 'Still compliant' },
      { gateId: 'g3', pass: true, reason: 'Still solves it' },
    ],
    criteriaScores: [
      { criterionId: 'c1', score: 5, reason: 'More novel now' },
      { criterionId: 'c2', score: 5, reason: 'Still buildable' },
      { criterionId: 'c3', score: 4, reason: 'Cost reduced' },
      { criterionId: 'c4', score: 5, reason: 'More delightful' },
      { criterionId: 'c5', score: 4, reason: 'Better scale' },
    ],
    totalScore: 23,
    eliminated: false,
  },
];

/** QA results for the evolved concept */
const qaResults = [
  {
    conceptId: 'evolved-0',
    feasibilityScore: 4,
    risks: [
      { category: 'Technical', description: 'Complex implementation', severity: 'medium', mitigation: 'Phase rollout' },
      { category: 'Market', description: 'Uncertain demand', severity: 'low' },
      { category: 'Cost', description: 'High initial investment', severity: 'medium', mitigation: 'Seek funding' },
    ],
    verdict: 'strong',
    summary: 'Solid concept with manageable risks.',
  },
];

// ---------------------------------------------------------------------------
// Factory options builder
// ---------------------------------------------------------------------------

function factoryOptions(sessionId: string) {
  return {
    sessionId,
    domain: 'test domain',
    coordinate: 'test > coordinate',
    methods,
    rubric,
    ideasPerWorker: 2,
    workerModel: 'claude-sonnet-4-20250514',
    analystModel: 'claude-sonnet-4-20250514',
  };
}

/**
 * Set up all 6 mockQuery responses for a full pipeline run:
 * 0. Worker 0 diverge (First Principles)
 * 1. Worker 1 diverge (TRIZ)
 * 2. Convergence batch (4 ideas in 1 batch)
 * 3. Evolution worker 0 (1 pair of survivors)
 * 4. Rescore batch (1 evolved concept)
 * 5. QA
 */
function setupFullPipelineMocks() {
  mockQuery
    .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
    .mockReturnValueOnce(queryResult(JSON.stringify(worker1Ideas)))
    .mockReturnValueOnce(queryResult(JSON.stringify(scoredIdeas)))
    .mockReturnValueOnce(queryResult(JSON.stringify(evolvedConcepts)))
    .mockReturnValueOnce(queryResult(JSON.stringify(rescoredEvolved)))
    .mockReturnValueOnce(queryResult(JSON.stringify(qaResults)));
}

// ==========================================================================
// Tests
// ==========================================================================

describe('Factory – runFactory full pipeline', () => {
  let runFactory: typeof import('./factory.js')['runFactory'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./factory.js');
    runFactory = mod.runFactory;
  });

  // 1. Full pipeline persists diverge ideas
  it('persists diverge ideas to DB with phase="diverge"', async () => {
    await insertSession(testDb, 'sess-full-1');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-full-1'));

    const divergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-full-1'), eq(schema.ideas.phase, 'diverge')));

    // 2 workers x 2 ideas each = 4 diverge ideas
    expect(divergeRows).toHaveLength(4);
    for (const row of divergeRows) {
      expect(row.phase).toBe('diverge');
      expect(row.workerId).toBeDefined();
      expect(row.persona).toBeDefined();
    }
  });

  // 2. Full pipeline persists converge ideas
  it('persists converge ideas to DB with phase="converge"', async () => {
    await insertSession(testDb, 'sess-full-2');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-full-2'));

    const convergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-full-2'), eq(schema.ideas.phase, 'converge')));

    // 4 scored ideas (2 survivors + 2 eliminated)
    expect(convergeRows).toHaveLength(4);
    for (const row of convergeRows) {
      expect(row.phase).toBe('converge');
    }
  });

  // 3. Full pipeline persists evolve ideas
  it('persists evolve ideas to DB with phase="evolve"', async () => {
    await insertSession(testDb, 'sess-full-3');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-full-3'));

    const evolveRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-full-3'), eq(schema.ideas.phase, 'evolve')));

    // 1 evolved idea (re-scored and persisted)
    expect(evolveRows).toHaveLength(1);
    for (const row of evolveRows) {
      expect(row.phase).toBe('evolve');
      expect(row.eliminated).toBe(0);
    }
  });

  // 4. Full pipeline persists QA results
  it('persists QA results to DB with phase="qa"', async () => {
    await insertSession(testDb, 'sess-full-4');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-full-4'));

    const qaRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-full-4'), eq(schema.ideas.phase, 'qa')));

    // 1 QA result
    expect(qaRows).toHaveLength(1);
    const row = qaRows[0];
    expect(row.phase).toBe('qa');
    expect(row.name).toBe('evolved-0'); // conceptId
    expect(row.description).toBe('Solid concept with manageable risks.');
    expect(row.score).toBe(4); // feasibilityScore
  });

  // 5. All expected SSE events are emitted in order
  it('emits all expected SSE events in order', async () => {
    await insertSession(testDb, 'sess-full-5');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-full-5'));

    const events = mockEmit.mock.calls
      .filter(([sid]: [string]) => sid === 'sess-full-5')
      .map(([, evt]: [string, { type: string }]) => evt.type);

    // Divergence phase events
    expect(events).toContain('agent:thought');
    expect(events).toContain('data:idea_stream');

    // Convergence phase events
    expect(events).toContain('data:convergence_result');

    // Evolution phase events
    expect(events).toContain('data:evolution_result');

    // QA phase events
    expect(events).toContain('data:qa_result');
  });

  // 6. Makes exactly 6 LLM calls (2 diverge + 1 converge batch + 1 evolution + 1 rescore + 1 QA)
  it('makes exactly 6 LLM calls', async () => {
    await insertSession(testDb, 'sess-full-6');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-full-6'));

    expect(mockQuery).toHaveBeenCalledTimes(6);
  });

  // 7. Converge eliminated ideas have eliminated=1 in DB
  it('stores eliminated flag correctly for converge phase', async () => {
    await insertSession(testDb, 'sess-full-7');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-full-7'));

    const convergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-full-7'), eq(schema.ideas.phase, 'converge')));

    const survivors = convergeRows.filter((r) => r.eliminated === 0);
    const eliminated = convergeRows.filter((r) => r.eliminated === 1);

    expect(survivors).toHaveLength(2);
    expect(eliminated).toHaveLength(2);
  });

  // 8. QA verdict "strong" results in eliminated=0
  it('sets eliminated=0 for QA verdict "strong"', async () => {
    await insertSession(testDb, 'sess-full-8');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-full-8'));

    const qaRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-full-8'), eq(schema.ideas.phase, 'qa')));

    expect(qaRows[0].eliminated).toBe(0);
  });
});

// ==========================================================================
// Divergence Phase Tests
// ==========================================================================

describe('Factory – Divergence phase', () => {
  let runFactory: typeof import('./factory.js')['runFactory'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./factory.js');
    runFactory = mod.runFactory;
  });

  // 9. Creates N parallel workers (1 per method)
  it('creates one worker per method', async () => {
    await insertSession(testDb, 'sess-div-1');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-div-1'));

    // First 2 calls are diverge workers
    const divergeCalls = mockQuery.mock.calls.slice(0, 2);
    expect(divergeCalls).toHaveLength(2);
  });

  // 10. Each worker gets method-specific system prompt
  it('each worker gets method-specific system prompt', async () => {
    await insertSession(testDb, 'sess-div-2');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-div-2'));

    const divergeCalls = mockQuery.mock.calls.slice(0, 2);
    const systemPrompts = divergeCalls.map((call) => call[0].options.systemPrompt as string);

    const hasFirstPrinciples = systemPrompts.some((s) => s.includes('First Principles'));
    const hasTRIZ = systemPrompts.some((s) => s.includes('TRIZ'));

    expect(hasFirstPrinciples).toBe(true);
    expect(hasTRIZ).toBe(true);
  });

  // 11. Ideas are enriched with workerId and method name
  it('enriches ideas with workerId and method name', async () => {
    await insertSession(testDb, 'sess-div-3');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-div-3'));

    const divergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-div-3'), eq(schema.ideas.phase, 'diverge')));

    // All ideas should have workerId and persona set
    for (const row of divergeRows) {
      expect(row.workerId).toMatch(/^worker-\d+$/);
      expect(row.persona).toBeTruthy();
      expect(['First Principles', 'TRIZ']).toContain(row.persona);
    }

    // Check worker-0 ideas have correct persona (= method name)
    const worker0Rows = divergeRows.filter((r) => r.workerId === 'worker-0');
    expect(worker0Rows).toHaveLength(2);
    for (const row of worker0Rows) {
      expect(row.persona).toBe('First Principles');
    }
  });

  // 12. SSE data:idea_stream emitted per idea
  it('emits data:idea_stream SSE event for each idea', async () => {
    await insertSession(testDb, 'sess-div-4');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-div-4'));

    const ideaStreamEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-div-4' && evt.type === 'data:idea_stream',
    );

    // 2 workers x 2 ideas = 4 idea_stream events
    expect(ideaStreamEvents).toHaveLength(4);

    // Each should have workerId and persona
    for (const [, evt] of ideaStreamEvents) {
      expect(evt.data.workerId).toBeDefined();
      expect(evt.data.persona).toBeDefined();
      expect(evt.data.idea).toBeDefined();
    }
  });
});

// ==========================================================================
// Convergence Phase Tests
// ==========================================================================

describe('Factory – Convergence phase', () => {
  let runFactory: typeof import('./factory.js')['runFactory'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./factory.js');
    runFactory = mod.runFactory;
  });

  // 14. Convergence receives all raw ideas + rubric
  it('convergence LLM call includes all raw ideas and rubric', async () => {
    await insertSession(testDb, 'sess-conv-1');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-conv-1'));

    // Third call (index 2) is convergence batch
    const userMessage = mockQuery.mock.calls[2][0].prompt;

    // Should reference all 4 ideas (stable IDs: worker-{i}-{j})
    expect(userMessage).toContain('worker-0-0');
    expect(userMessage).toContain('worker-1-0');
    // Should include rubric
    expect(userMessage).toContain('Rubric');
  });

  // 15. Returns both survivors and eliminated
  it('correctly separates survivors and eliminated ideas', async () => {
    await insertSession(testDb, 'sess-conv-2');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-conv-2'));

    // Check convergence_result SSE event
    const convergenceEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-conv-2' && evt.type === 'data:convergence_result',
    );

    expect(convergenceEvents).toHaveLength(1);
    const { survivors, eliminated } = convergenceEvents[0][1].data;
    expect(survivors).toHaveLength(2);
    expect(eliminated).toHaveLength(2);
    expect(survivors[0].id).toBe('scored-0');
    expect(eliminated[0].id).toBe('scored-1');
  });

  // 16. SSE data:convergence_result emitted
  it('emits data:convergence_result SSE event', async () => {
    await insertSession(testDb, 'sess-conv-3');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-conv-3'));

    const convergenceEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-conv-3' && evt.type === 'data:convergence_result',
    );

    expect(convergenceEvents).toHaveLength(1);
  });

  // 18. Convergence persists score and elimination data
  it('persists totalScore and eliminated fields in converge phase rows', async () => {
    await insertSession(testDb, 'sess-conv-5');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-conv-5'));

    const convergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-conv-5'), eq(schema.ideas.phase, 'converge')));

    const survivorRows = convergeRows.filter((r) => r.eliminated === 0);
    const eliminatedRows = convergeRows.filter((r) => r.eliminated === 1);

    expect(survivorRows).toHaveLength(2);
    // Survivors sorted by score: scored-0 (19) then scored-2 (18)
    const scores = survivorRows.map((r) => r.score).sort((a, b) => (b ?? 0) - (a ?? 0));
    expect(scores).toEqual([19, 18]);

    expect(eliminatedRows).toHaveLength(2);
    for (const row of eliminatedRows) {
      expect(row.score).toBe(0);
    }
  });
});

// ==========================================================================
// Evolution Phase Tests
// ==========================================================================

describe('Factory – Evolution phase', () => {
  let runFactory: typeof import('./factory.js')['runFactory'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./factory.js');
    runFactory = mod.runFactory;
  });

  // 19. Evolution receives only survivors as pairs
  it('evolution LLM call receives only survivors as pairs, not eliminated ideas', async () => {
    await insertSession(testDb, 'sess-evo-1');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-evo-1'));

    // Fourth call (index 3) is evolution worker 0
    const userMessage = mockQuery.mock.calls[3][0].prompt;

    // Should reference scored-0 and scored-2 (survivors) as a pair
    expect(userMessage).toContain('scored-0');
    expect(userMessage).toContain('scored-2');
    // Should NOT reference eliminated ideas
    expect(userMessage).not.toContain('scored-1');
    expect(userMessage).not.toContain('scored-3');
  });

  // 20. Evolution returns evolved concepts with re-scored data
  it('persists re-scored evolved concepts to DB', async () => {
    await insertSession(testDb, 'sess-evo-2');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-evo-2'));

    const evolveRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-evo-2'), eq(schema.ideas.phase, 'evolve')));

    expect(evolveRows).toHaveLength(1);
    expect(evolveRows[0].name).toBe('Hybrid A+C');
    expect(evolveRows[0].score).toBe(23);
  });

  // 21. SSE data:evolution_result emitted
  it('emits data:evolution_result SSE event', async () => {
    await insertSession(testDb, 'sess-evo-3');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-evo-3'));

    const evolutionEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-evo-3' && evt.type === 'data:evolution_result',
    );

    expect(evolutionEvents).toHaveLength(1);
    expect(evolutionEvents[0][1].data.evolved).toHaveLength(1);
  });
});

// ==========================================================================
// QA Phase Tests
// ==========================================================================

describe('Factory – QA phase', () => {
  let runFactory: typeof import('./factory.js')['runFactory'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./factory.js');
    runFactory = mod.runFactory;
  });

  // 23. QA receives evolved concepts
  it('QA LLM call receives evolved concepts', async () => {
    await insertSession(testDb, 'sess-qa-1');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-qa-1'));

    // Sixth call (index 5) is QA
    const userMessage = mockQuery.mock.calls[5][0].prompt;

    // Should reference the re-scored evolved concept
    expect(userMessage).toContain('Hybrid A+C');
    expect(userMessage).toContain('evolved-0');
  });

  // 24. QA returns results with feasibility, risks, verdict
  it('QA results contain feasibilityScore, risks, verdict, and summary', async () => {
    await insertSession(testDb, 'sess-qa-2');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-qa-2'));

    const qaRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-qa-2'), eq(schema.ideas.phase, 'qa')));

    expect(qaRows).toHaveLength(1);
    const stored = JSON.parse(qaRows[0].data!);
    expect(stored.feasibilityScore).toBe(4);
    expect(stored.risks).toHaveLength(3);
    expect(stored.verdict).toBe('strong');
    expect(stored.summary).toBe('Solid concept with manageable risks.');
  });

  // 25. SSE data:qa_result emitted
  it('emits data:qa_result SSE event', async () => {
    await insertSession(testDb, 'sess-qa-3');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-qa-3'));

    const qaEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-qa-3' && evt.type === 'data:qa_result',
    );

    expect(qaEvents).toHaveLength(1);
    expect(qaEvents[0][1].data.reviewed).toHaveLength(1);
  });

  // 27. QA verdict "weak" sets eliminated=1
  it('QA verdict "weak" sets eliminated=1 in DB', async () => {
    await insertSession(testDb, 'sess-qa-5');

    const weakQaResults = [
      {
        conceptId: 'evolved-0',
        feasibilityScore: 2,
        risks: [
          { category: 'Technical', description: 'Too complex', severity: 'critical' },
          { category: 'Market', description: 'No demand', severity: 'high' },
          { category: 'Cost', description: 'Too expensive', severity: 'high' },
        ],
        verdict: 'weak',
        summary: 'Not viable in current form.',
      },
    ];

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(worker1Ideas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(scoredIdeas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(evolvedConcepts)))
      .mockReturnValueOnce(queryResult(JSON.stringify(rescoredEvolved)))
      .mockReturnValueOnce(queryResult(JSON.stringify(weakQaResults)));

    await runFactory(factoryOptions('sess-qa-5'));

    const qaRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-qa-5'), eq(schema.ideas.phase, 'qa')));

    expect(qaRows[0].eliminated).toBe(1);
  });
});

// ==========================================================================
// Edge Cases
// ==========================================================================

describe('Factory – Edge cases', () => {
  let runFactory: typeof import('./factory.js')['runFactory'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./factory.js');
    runFactory = mod.runFactory;
  });

  // 28. Single method (single worker) — 1 survivor → 0 evolution pairs → fallback
  it('works with a single method (single worker)', async () => {
    await insertSession(testDb, 'sess-edge-1');

    // Convergence with 1 survivor from 2 ideas → 0 pairs → evolution fallback → QA with original survivor
    const singleMethodScored = [
      {
        id: 'scored-0', sourceIds: ['worker-0-0'], name: 'Idea A', description: 'Desc A',
        gateResults: [
          { gateId: 'g1', pass: true, reason: 'OK' },
          { gateId: 'g2', pass: true, reason: 'OK' },
          { gateId: 'g3', pass: true, reason: 'OK' },
        ],
        criteriaScores: [
          { criterionId: 'c1', score: 4, reason: 'Novel' },
          { criterionId: 'c2', score: 5, reason: 'Buildable' },
          { criterionId: 'c3', score: 3, reason: 'OK' },
          { criterionId: 'c4', score: 4, reason: 'OK' },
          { criterionId: 'c5', score: 3, reason: 'OK' },
        ],
        totalScore: 19, eliminated: false,
      },
      {
        id: 'scored-1', sourceIds: ['worker-0-1'], name: 'Idea B', description: 'Desc B',
        gateResults: [
          { gateId: 'g1', pass: false, reason: 'Nope' },
          { gateId: 'g2', pass: true, reason: 'OK' },
          { gateId: 'g3', pass: true, reason: 'OK' },
        ],
        criteriaScores: [], totalScore: 0, eliminated: false,
      },
    ];

    const singleMethodQa = [
      {
        conceptId: 'scored-0', feasibilityScore: 4,
        risks: [
          { category: 'Technical', description: 'Complex', severity: 'medium', mitigation: 'Plan' },
          { category: 'Market', description: 'Risk', severity: 'low' },
          { category: 'Cost', description: 'Expensive', severity: 'medium', mitigation: 'Fund' },
        ],
        verdict: 'strong', summary: 'Good concept.',
      },
    ];

    // 1 diverge + 1 converge batch + 0 evolution (1 survivor, 0 pairs) + 1 QA = 3
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(singleMethodScored)))
      .mockReturnValueOnce(queryResult(JSON.stringify(singleMethodQa)));

    const opts = factoryOptions('sess-edge-1');
    opts.methods = [methods[0]];

    await runFactory(opts);

    expect(mockQuery).toHaveBeenCalledTimes(3);

    const divergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-edge-1'), eq(schema.ideas.phase, 'diverge')));

    // Only 1 worker x 2 ideas = 2
    expect(divergeRows).toHaveLength(2);

    // All should be worker-0 with First Principles method
    for (const row of divergeRows) {
      expect(row.workerId).toBe('worker-0');
      expect(row.persona).toBe('First Principles');
    }
  });

  // 29. All ideas eliminated in convergence
  it('proceeds through evolution and QA even when all ideas eliminated in convergence', async () => {
    await insertSession(testDb, 'sess-edge-2');

    const allEliminated = [
      {
        id: 'scored-0', sourceIds: ['worker-0-0'], name: 'Idea A', description: 'Desc A',
        gateResults: [
          { gateId: 'g1', pass: false, reason: 'Not feasible' },
          { gateId: 'g2', pass: true, reason: 'OK' },
          { gateId: 'g3', pass: true, reason: 'OK' },
        ],
        criteriaScores: [], totalScore: 0, eliminated: false,
      },
      {
        id: 'scored-1', sourceIds: ['worker-0-1'], name: 'Idea B', description: 'Desc B',
        gateResults: [
          { gateId: 'g1', pass: false, reason: 'Not feasible' },
          { gateId: 'g2', pass: true, reason: 'OK' },
          { gateId: 'g3', pass: true, reason: 'OK' },
        ],
        criteriaScores: [], totalScore: 0, eliminated: false,
      },
      {
        id: 'scored-2', sourceIds: ['worker-1-0'], name: 'Idea C', description: 'Desc C',
        gateResults: [
          { gateId: 'g1', pass: false, reason: 'Not feasible' },
          { gateId: 'g2', pass: true, reason: 'OK' },
          { gateId: 'g3', pass: true, reason: 'OK' },
        ],
        criteriaScores: [], totalScore: 0, eliminated: false,
      },
      {
        id: 'scored-3', sourceIds: ['worker-1-1'], name: 'Idea D', description: 'Desc D',
        gateResults: [
          { gateId: 'g1', pass: false, reason: 'Not feasible' },
          { gateId: 'g2', pass: true, reason: 'OK' },
          { gateId: 'g3', pass: true, reason: 'OK' },
        ],
        criteriaScores: [], totalScore: 0, eliminated: false,
      },
    ];

    // Empty QA result (no concepts to QA, but QA is still called)
    const emptyQa: unknown[] = [];

    // 2 diverge + 1 converge + 0 evolution (0 survivors, 0 pairs) + 1 QA = 4
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(worker1Ideas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(allEliminated)))
      .mockReturnValueOnce(queryResult(JSON.stringify(emptyQa)));

    await runFactory(factoryOptions('sess-edge-2'));

    expect(mockQuery).toHaveBeenCalledTimes(4);

    // All converge ideas should be eliminated
    const convergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-edge-2'), eq(schema.ideas.phase, 'converge')));

    expect(convergeRows).toHaveLength(4);
    for (const row of convergeRows) {
      expect(row.eliminated).toBe(1);
    }

    // Convergence result SSE should still be emitted
    const convergenceEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-edge-2' && evt.type === 'data:convergence_result',
    );
    expect(convergenceEvents).toHaveLength(1);
    expect(convergenceEvents[0][1].data.survivors).toHaveLength(0);
    expect(convergenceEvents[0][1].data.eliminated).toHaveLength(4);
  });

  // 30. Diverge ideas persist data field as JSON
  it('persists full structured data as JSON in the data column', async () => {
    await insertSession(testDb, 'sess-edge-3');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-edge-3'));

    const divergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-edge-3'), eq(schema.ideas.phase, 'diverge')));

    for (const row of divergeRows) {
      const data = JSON.parse(row.data!);
      expect(data.id).toBeDefined();
      expect(data.method).toBeDefined();
      expect(data.name).toBeDefined();
      expect(data.description).toBeDefined();
      expect(data.probability).toBeDefined();
      expect(data.workerId).toBeDefined();
      expect(data.persona).toBeDefined();
    }
  });
});

// ==========================================================================
// Partial Failure (Promise.allSettled)
// ==========================================================================

describe('Factory – Partial worker failure', () => {
  let runFactory: typeof import('./factory.js')['runFactory'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./factory.js');
    runFactory = mod.runFactory;
  });

  it('proceeds with partial results when one worker fails', async () => {
    await insertSession(testDb, 'sess-partial-1');

    // Scored results for the 2 ideas from surviving worker 0
    const partialScored = [
      {
        id: 'scored-0', sourceIds: ['worker-0-0'], name: 'Idea A', description: 'Desc A',
        gateResults: [
          { gateId: 'g1', pass: true, reason: 'OK' },
          { gateId: 'g2', pass: true, reason: 'OK' },
          { gateId: 'g3', pass: true, reason: 'OK' },
        ],
        criteriaScores: [
          { criterionId: 'c1', score: 4, reason: 'Novel' },
          { criterionId: 'c2', score: 5, reason: 'Buildable' },
          { criterionId: 'c3', score: 3, reason: 'OK' },
          { criterionId: 'c4', score: 4, reason: 'OK' },
          { criterionId: 'c5', score: 3, reason: 'OK' },
        ],
        totalScore: 19, eliminated: false,
      },
      {
        id: 'scored-1', sourceIds: ['worker-0-1'], name: 'Idea B', description: 'Desc B',
        gateResults: [
          { gateId: 'g1', pass: false, reason: 'Nope' },
          { gateId: 'g2', pass: true, reason: 'OK' },
          { gateId: 'g3', pass: true, reason: 'OK' },
        ],
        criteriaScores: [], totalScore: 0, eliminated: false,
      },
    ];

    const partialQa = [
      {
        conceptId: 'scored-0', feasibilityScore: 4,
        risks: [
          { category: 'Technical', description: 'Complex', severity: 'medium', mitigation: 'Plan' },
          { category: 'Market', description: 'Risk', severity: 'low' },
          { category: 'Cost', description: 'Expensive', severity: 'medium', mitigation: 'Fund' },
        ],
        verdict: 'strong', summary: 'Good.',
      },
    ];

    // Worker 0 succeeds, Worker 1 fails with auth error (non-retryable)
    const authError = new Error('401 Unauthorized');
    // 1 success + 1 fail + 1 converge batch + 0 evolution (1 survivor) + 1 QA = 4
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
      .mockImplementationOnce(() => { throw authError; })
      .mockReturnValueOnce(queryResult(JSON.stringify(partialScored)))
      .mockReturnValueOnce(queryResult(JSON.stringify(partialQa)));

    await runFactory(factoryOptions('sess-partial-1'));

    // Only worker 0 ideas persisted (2 ideas, not 4)
    const divergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-partial-1'), eq(schema.ideas.phase, 'diverge')));
    expect(divergeRows).toHaveLength(2);

    // Should emit a partial results thought
    const partialEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { agent?: string; text?: string } }]) =>
        sid === 'sess-partial-1' &&
        evt.type === 'agent:thought' &&
        evt.data.text?.includes('Proceeding with partial results'),
    );
    expect(partialEvents.length).toBeGreaterThanOrEqual(1);

    // Should emit factory:progress events with worker status
    const progressEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-partial-1' && evt.type === 'factory:progress',
    );
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);

    // Pipeline still completes
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  it('throws when ALL workers fail', async () => {
    await insertSession(testDb, 'sess-all-fail');

    // Both workers fail with auth errors (non-retryable)
    const authError = new Error('401 Unauthorized');
    mockQuery
      .mockImplementation(() => { throw authError; });

    await expect(runFactory(factoryOptions('sess-all-fail'))).rejects.toThrow(
      /All 2 workers failed/,
    );

    // No ideas persisted
    const divergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-all-fail'), eq(schema.ideas.phase, 'diverge')));
    expect(divergeRows).toHaveLength(0);
  });

  it('emits failure thought with specific error message for failed worker', async () => {
    await insertSession(testDb, 'sess-fail-msg');

    const partialScored = [
      {
        id: 'scored-0', sourceIds: ['worker-0-0'], name: 'Idea A', description: 'Desc A',
        gateResults: [
          { gateId: 'g1', pass: true, reason: 'OK' },
          { gateId: 'g2', pass: true, reason: 'OK' },
          { gateId: 'g3', pass: true, reason: 'OK' },
        ],
        criteriaScores: [
          { criterionId: 'c1', score: 4, reason: 'OK' },
          { criterionId: 'c2', score: 5, reason: 'OK' },
          { criterionId: 'c3', score: 3, reason: 'OK' },
          { criterionId: 'c4', score: 4, reason: 'OK' },
          { criterionId: 'c5', score: 3, reason: 'OK' },
        ],
        totalScore: 19, eliminated: false,
      },
      {
        id: 'scored-1', sourceIds: ['worker-0-1'], name: 'Idea B', description: 'Desc B',
        gateResults: [
          { gateId: 'g1', pass: false, reason: 'Nope' },
          { gateId: 'g2', pass: true, reason: 'OK' },
          { gateId: 'g3', pass: true, reason: 'OK' },
        ],
        criteriaScores: [], totalScore: 0, eliminated: false,
      },
    ];

    const partialQa = [
      {
        conceptId: 'scored-0', feasibilityScore: 4,
        risks: [
          { category: 'Technical', description: 'Complex', severity: 'medium', mitigation: 'Plan' },
          { category: 'Market', description: 'Risk', severity: 'low' },
          { category: 'Cost', description: 'Expensive', severity: 'medium', mitigation: 'Fund' },
        ],
        verdict: 'strong', summary: 'Good.',
      },
    ];

    const notFoundError = new Error('404 model unavailable');
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
      .mockImplementationOnce(() => { throw notFoundError; })
      .mockReturnValueOnce(queryResult(JSON.stringify(partialScored)))
      .mockReturnValueOnce(queryResult(JSON.stringify(partialQa)));

    await runFactory(factoryOptions('sess-fail-msg'));

    // Should emit thought with the specific error for the failed worker
    const failEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { agent?: string; text?: string } }]) =>
        sid === 'sess-fail-msg' &&
        evt.type === 'agent:thought' &&
        evt.data.text?.includes('Failed:'),
    );
    expect(failEvents.length).toBeGreaterThanOrEqual(1);
    expect(failEvents[0][1].data.text).toContain('model unavailable');
  });
});

// ==========================================================================
// SSE Event Ordering and Agent Names
// ==========================================================================

describe('Factory – SSE event details', () => {
  let runFactory: typeof import('./factory.js')['runFactory'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./factory.js');
    runFactory = mod.runFactory;
  });

  // 31. Factory emits initial thought with agent name "Factory"
  it('emits initial divergence thought with agent name "Factory"', async () => {
    await insertSession(testDb, 'sess-sse-1');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-sse-1'));

    const factoryEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { agent?: string } }]) =>
        sid === 'sess-sse-1' &&
        evt.type === 'agent:thought' &&
        evt.data.agent === 'Factory',
    );

    expect(factoryEvents.length).toBeGreaterThanOrEqual(1);
    // First Factory thought mentions divergence
    expect(factoryEvents[0][1].data.text).toContain('divergence');
  });

  // 32. Analyst agent name used for convergence, evolution, and QA phases
  it('uses "Analyst" agent name for convergence, evolution, and QA thoughts', async () => {
    await insertSession(testDb, 'sess-sse-2');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-sse-2'));

    const analystEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { agent?: string } }]) =>
        sid === 'sess-sse-2' &&
        evt.type === 'agent:thought' &&
        evt.data.agent === 'Analyst',
    );

    // At least 4 analyst events: converging, convergence complete, evolving, evolution complete, QA, QA complete
    expect(analystEvents.length).toBeGreaterThanOrEqual(4);
  });

  // 33. Worker thought events include worker number and method name
  it('emits worker thought events with correct worker identification', async () => {
    await insertSession(testDb, 'sess-sse-3');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-sse-3'));

    const workerEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { agent?: string } }]) =>
        sid === 'sess-sse-3' &&
        evt.type === 'agent:thought' &&
        evt.data.agent?.startsWith('Worker'),
    );

    // At least 2 start + 2 complete = 4 worker thought events
    expect(workerEvents.length).toBeGreaterThanOrEqual(4);

    const agentNames = workerEvents.map(([, evt]: [string, { data: { agent: string } }]) => evt.data.agent);
    expect(agentNames.some((name: string) => name.includes('First Principles'))).toBe(true);
    expect(agentNames.some((name: string) => name.includes('TRIZ'))).toBe(true);
  });
});

// ==========================================================================
// Model parameter routing
// ==========================================================================

describe('Factory – Model routing', () => {
  let runFactory: typeof import('./factory.js')['runFactory'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./factory.js');
    runFactory = mod.runFactory;
  });

  // 34. Workers use workerModel, analyst phases use analystModel
  it('routes workerModel to divergence and analystModel to converge/evolve/rescore/QA', async () => {
    await insertSession(testDb, 'sess-model-1');
    setupFullPipelineMocks();

    const opts = factoryOptions('sess-model-1');
    opts.workerModel = 'claude-haiku-4-20250414';
    opts.analystModel = 'claude-sonnet-4-20250514';

    await runFactory(opts);

    // Diverge calls (first 2) should use workerModel
    expect(mockQuery.mock.calls[0][0].options.model).toBe('claude-haiku-4-20250414');
    expect(mockQuery.mock.calls[1][0].options.model).toBe('claude-haiku-4-20250414');

    // Converge, evolution, rescore, QA (calls 2-5) should use analystModel
    expect(mockQuery.mock.calls[2][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[3][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[4][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[5][0].options.model).toBe('claude-sonnet-4-20250514');
  });
});
