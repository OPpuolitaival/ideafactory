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
 * Set up all 5 mockQuery responses for a full pipeline run:
 * 0. Worker 0 diverge (First Principles)
 * 1. Worker 1 diverge (TRIZ)
 * 2. Convergence batch (4 ideas in 1 batch)
 * 3. Evolution worker 0 (1 pair of survivors)
 * 4. Rescore batch (1 evolved concept)
 */
function setupFullPipelineMocks() {
  mockQuery
    .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
    .mockReturnValueOnce(queryResult(JSON.stringify(worker1Ideas)))
    .mockReturnValueOnce(queryResult(JSON.stringify(scoredIdeas)))
    .mockReturnValueOnce(queryResult(JSON.stringify(evolvedConcepts)))
    .mockReturnValueOnce(queryResult(JSON.stringify(rescoredEvolved)));
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

  // 4. All expected SSE events are emitted in order
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

    // Interactive phase event (combined pool ready)
    expect(events).toContain('factory:interactive');
  });

  // 4b. Combined pool in factory:interactive carries DB nanoid IDs (not LLM-generated)
  it('factory:interactive event contains ideas with DB nanoid IDs', async () => {
    await insertSession(testDb, 'sess-full-ids');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-full-ids'));

    const interactiveEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-full-ids' && evt.type === 'factory:interactive',
    );

    expect(interactiveEvents).toHaveLength(1);
    const { combinedPool } = interactiveEvents[0][1].data;
    expect(combinedPool.length).toBeGreaterThan(0);

    for (const idea of combinedPool) {
      // DB nanoid IDs are 12 chars, never start with scored- or evolved-
      expect(idea.id).toHaveLength(12);
      expect(idea.id).not.toMatch(/^scored-/);
      expect(idea.id).not.toMatch(/^evolved-/);
    }

    // All IDs should be unique
    const ids = combinedPool.map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // 5. Makes exactly 5 LLM calls (2 diverge + 1 converge batch + 1 evolution + 1 rescore)
  it('makes exactly 5 LLM calls', async () => {
    await insertSession(testDb, 'sess-full-6');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-full-6'));

    expect(mockQuery).toHaveBeenCalledTimes(5);
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
    // After DB persist, IDs are DB nanoids (not LLM-generated like scored-*)
    expect(survivors[0].id).not.toMatch(/^scored-/);
    expect(survivors[0].id).toHaveLength(12);
    expect(eliminated[0].id).not.toMatch(/^scored-/);
    expect(eliminated[0].id).toHaveLength(12);
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

  // 19. Evolution receives only survivors as pairs (with DB nanoid IDs after convergence)
  it('evolution LLM call receives only survivors as pairs, not eliminated ideas', async () => {
    await insertSession(testDb, 'sess-evo-1');
    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-evo-1'));

    // Fourth call (index 3) is evolution worker 0
    const userMessage = mockQuery.mock.calls[3][0].prompt;

    // After convergence, survivors have DB nanoid IDs (12 chars)
    // The prompt should contain exactly 2 idea IDs (the 2 survivors in a pair)
    // It should NOT contain LLM-generated IDs like scored-1 or scored-3 (eliminated)
    expect(userMessage).not.toContain('scored-1');
    expect(userMessage).not.toContain('scored-3');

    // Should contain "Idea A" and "Idea C" (the two survivor names)
    expect(userMessage).toContain('Idea A');
    expect(userMessage).toContain('Idea C');
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
    // Evolution merge: 2 survivors + 1 evolved = 3 combined
    expect(evolutionEvents[0][1].data.evolved).toHaveLength(3);
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

    // Convergence with 1 survivor from 2 ideas → 0 pairs → evolution fallback (no evolve LLM call)
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

    // 1 diverge + 1 converge batch + 0 evolution (1 survivor, 0 pairs) = 2
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(singleMethodScored)));

    const opts = factoryOptions('sess-edge-1');
    opts.methods = [methods[0]];

    await runFactory(opts);

    expect(mockQuery).toHaveBeenCalledTimes(2);

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

    // 2 diverge + 1 converge + 0 evolution (0 survivors, 0 pairs) = 3
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(worker1Ideas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(allEliminated)));

    await runFactory(factoryOptions('sess-edge-2'));

    expect(mockQuery).toHaveBeenCalledTimes(3);

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

    // Worker 0 succeeds, Worker 1 fails with auth error (non-retryable)
    const authError = new Error('401 Unauthorized');
    // 1 success + 1 fail + 1 converge batch + 0 evolution (1 survivor) = 3
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
      .mockImplementationOnce(() => { throw authError; })
      .mockReturnValueOnce(queryResult(JSON.stringify(partialScored)));

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
    expect(mockQuery).toHaveBeenCalledTimes(3);
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

    const notFoundError = new Error('404 model unavailable');
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker0Ideas)))
      .mockImplementationOnce(() => { throw notFoundError; })
      .mockReturnValueOnce(queryResult(JSON.stringify(partialScored)));

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

    // At least 3 analyst events: converging, convergence complete, evolving, evolution complete
    expect(analystEvents.length).toBeGreaterThanOrEqual(3);
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

    // Converge, evolution, rescore (calls 2-4) should use analystModel
    expect(mockQuery.mock.calls[2][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[3][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[4][0].options.model).toBe('claude-sonnet-4-20250514');
  });
});

// ==========================================================================
// Factory Resume
// ==========================================================================

describe('Factory – Resume', () => {
  let runFactory: typeof import('./factory.js')['runFactory'];
  let detectFactoryProgress: typeof import('./factory.js')['detectFactoryProgress'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./factory.js');
    runFactory = mod.runFactory;
    detectFactoryProgress = mod.detectFactoryProgress;
  });

  // ---- detectFactoryProgress tests ----

  it('detectFactoryProgress — empty DB returns resumeFrom: null', async () => {
    await insertSession(testDb, 'sess-resume-empty');

    const progress = await detectFactoryProgress('sess-resume-empty');

    expect(progress.resumeFrom).toBeNull();
    expect(progress.completedWorkerIds).toHaveLength(0);
    expect(progress.divergeIdeaCount).toBe(0);
    expect(progress.convergeIdeaCount).toBe(0);
    expect(progress.evolveIdeaCount).toBe(0);
  });

  it('detectFactoryProgress — partial diverge returns resumeFrom: diverge', async () => {
    await insertSession(testDb, 'sess-resume-pd');

    // Pre-insert worker-0 ideas (only 1 of 2 workers done)
    for (let j = 0; j < 2; j++) {
      await testDb.insert(schema.ideas).values({
        id: `pd-w0-${j}`,
        sessionId: 'sess-resume-pd',
        workerId: 'worker-0',
        persona: 'First Principles',
        method: 'First Principles',
        name: `Idea ${j}`,
        description: `Desc ${j}`,
        phase: 'diverge',
        data: JSON.stringify({ id: `worker-0-${j}`, workerId: 'worker-0', persona: 'First Principles', method: 'First Principles', name: `Idea ${j}`, description: `Desc ${j}`, probability: 'high' }),
      });
    }

    const progress = await detectFactoryProgress('sess-resume-pd');

    expect(progress.resumeFrom).toBe('diverge');
    expect(progress.completedWorkerIds).toEqual(['worker-0']);
    expect(progress.divergeIdeaCount).toBe(2);
    expect(progress.convergeIdeaCount).toBe(0);
    expect(progress.evolveIdeaCount).toBe(0);
  });

  it('detectFactoryProgress — full diverge returns resumeFrom: diverge', async () => {
    await insertSession(testDb, 'sess-resume-fd');

    // Pre-insert both workers' diverge ideas
    for (const wIdx of [0, 1]) {
      for (let j = 0; j < 2; j++) {
        const method = wIdx === 0 ? 'First Principles' : 'TRIZ';
        await testDb.insert(schema.ideas).values({
          id: `fd-w${wIdx}-${j}`,
          sessionId: 'sess-resume-fd',
          workerId: `worker-${wIdx}`,
          persona: method,
          method,
          name: `Idea ${wIdx}-${j}`,
          description: `Desc ${wIdx}-${j}`,
          phase: 'diverge',
          data: JSON.stringify({ id: `worker-${wIdx}-${j}`, workerId: `worker-${wIdx}`, persona: method, method, name: `Idea ${wIdx}-${j}`, description: `Desc ${wIdx}-${j}`, probability: 'high' }),
        });
      }
    }

    const progress = await detectFactoryProgress('sess-resume-fd');

    expect(progress.resumeFrom).toBe('diverge');
    expect(progress.completedWorkerIds).toHaveLength(2);
    expect(progress.divergeIdeaCount).toBe(4);
  });

  it('detectFactoryProgress — converge complete returns resumeFrom: evolve', async () => {
    await insertSession(testDb, 'sess-resume-conv');

    // Pre-insert diverge + converge ideas
    await testDb.insert(schema.ideas).values({
      id: 'conv-div-0',
      sessionId: 'sess-resume-conv',
      workerId: 'worker-0',
      persona: 'First Principles',
      method: 'First Principles',
      name: 'Idea A',
      description: 'Desc A',
      phase: 'diverge',
      data: JSON.stringify({ id: 'worker-0-0', name: 'Idea A', description: 'Desc A' }),
    });
    await testDb.insert(schema.ideas).values({
      id: 'conv-scored-0',
      sessionId: 'sess-resume-conv',
      name: 'Idea A Scored',
      description: 'Desc A Scored',
      phase: 'converge',
      score: 19,
      eliminated: 0,
      data: JSON.stringify({ id: 'conv-scored-0', name: 'Idea A Scored', description: 'Desc A Scored', totalScore: 19, eliminated: false, gateResults: [], criteriaScores: [] }),
    });

    const progress = await detectFactoryProgress('sess-resume-conv');

    expect(progress.resumeFrom).toBe('evolve');
    expect(progress.convergeIdeaCount).toBe(1);
  });

  it('detectFactoryProgress — evolve complete returns resumeFrom: interactive', async () => {
    await insertSession(testDb, 'sess-resume-evo');

    // Pre-insert all three phases
    await testDb.insert(schema.ideas).values({
      id: 'evo-div-0', sessionId: 'sess-resume-evo', workerId: 'worker-0', persona: 'First Principles', method: 'First Principles',
      name: 'Idea A', description: 'Desc A', phase: 'diverge', data: '{}',
    });
    await testDb.insert(schema.ideas).values({
      id: 'evo-conv-0', sessionId: 'sess-resume-evo', name: 'Idea A Scored', description: 'Desc', phase: 'converge',
      score: 19, eliminated: 0, data: JSON.stringify({ id: 'evo-conv-0', name: 'Idea A', totalScore: 19, eliminated: false, gateResults: [], criteriaScores: [] }),
    });
    await testDb.insert(schema.ideas).values({
      id: 'evo-evol-0', sessionId: 'sess-resume-evo', name: 'Hybrid', description: 'Evolved', phase: 'evolve',
      score: 23, eliminated: 0, data: JSON.stringify({ id: 'evo-evol-0', name: 'Hybrid', totalScore: 23, eliminated: false, gateResults: [], criteriaScores: [] }),
    });

    const progress = await detectFactoryProgress('sess-resume-evo');

    expect(progress.resumeFrom).toBe('interactive');
    expect(progress.evolveIdeaCount).toBe(1);
  });

  // ---- resume=true behavior tests ----

  it('resume=true skips completed workers and runs only missing ones', async () => {
    await insertSession(testDb, 'sess-resume-skip');

    // Pre-insert worker-0 ideas
    for (let j = 0; j < 2; j++) {
      await testDb.insert(schema.ideas).values({
        id: `skip-w0-${j}`,
        sessionId: 'sess-resume-skip',
        workerId: 'worker-0',
        persona: 'First Principles',
        method: 'First Principles',
        name: `Idea ${j}`,
        description: `Desc ${j}`,
        probability: 'high',
        phase: 'diverge',
        data: JSON.stringify({ id: `worker-0-${j}`, workerId: 'worker-0', persona: 'First Principles', method: 'First Principles', name: `Idea ${j}`, description: `Desc ${j}`, probability: 'high' }),
      });
    }

    // Mock: only need worker-1 diverge + converge + evolve + rescore = 4 calls
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker1Ideas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(scoredIdeas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(evolvedConcepts)))
      .mockReturnValueOnce(queryResult(JSON.stringify(rescoredEvolved)));

    await runFactory({ ...factoryOptions('sess-resume-skip'), resume: true });

    // Only 4 LLM calls (not 5): worker-1 diverge, converge batch, evolution, rescore
    expect(mockQuery).toHaveBeenCalledTimes(4);

    // Worker-0 ideas should still be in DB
    const worker0Rows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-resume-skip'), eq(schema.ideas.phase, 'diverge'), eq(schema.ideas.workerId, 'worker-0')));
    expect(worker0Rows).toHaveLength(2);

    // Worker-1 ideas should also be in DB
    const worker1Rows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-resume-skip'), eq(schema.ideas.phase, 'diverge'), eq(schema.ideas.workerId, 'worker-1')));
    expect(worker1Rows).toHaveLength(2);
  });

  it('resume=true preserves existing diverge ideas in DB', async () => {
    await insertSession(testDb, 'sess-resume-preserve');

    // Pre-insert worker-0 ideas with specific names
    for (let j = 0; j < 2; j++) {
      await testDb.insert(schema.ideas).values({
        id: `preserve-w0-${j}`,
        sessionId: 'sess-resume-preserve',
        workerId: 'worker-0',
        persona: 'First Principles',
        method: 'First Principles',
        name: `Preserved Idea ${j}`,
        description: `Original desc ${j}`,
        probability: 'high',
        phase: 'diverge',
        data: JSON.stringify({ id: `worker-0-${j}`, workerId: 'worker-0', persona: 'First Principles', method: 'First Principles', name: `Preserved Idea ${j}`, description: `Original desc ${j}`, probability: 'high' }),
      });
    }

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker1Ideas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(scoredIdeas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(evolvedConcepts)))
      .mockReturnValueOnce(queryResult(JSON.stringify(rescoredEvolved)));

    await runFactory({ ...factoryOptions('sess-resume-preserve'), resume: true });

    // Verify the original worker-0 ideas are untouched
    const w0Rows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-resume-preserve'), eq(schema.ideas.workerId, 'worker-0'), eq(schema.ideas.phase, 'diverge')));

    expect(w0Rows).toHaveLength(2);
    expect(w0Rows[0].name).toBe('Preserved Idea 0');
    expect(w0Rows[1].name).toBe('Preserved Idea 1');
  });

  it('resume=true with converge done re-runs evolve', async () => {
    await insertSession(testDb, 'sess-resume-evo-rerun');

    // Pre-insert diverge ideas
    await testDb.insert(schema.ideas).values({
      id: 'evo-rerun-div-0', sessionId: 'sess-resume-evo-rerun', workerId: 'worker-0',
      persona: 'First Principles', method: 'First Principles', name: 'Idea A', description: 'Desc A',
      phase: 'diverge', data: '{}',
    });

    // Pre-insert converge survivors
    const survivorData = { id: 'evo-rerun-conv-0', sourceIds: ['worker-0-0'], name: 'Idea A Scored', description: 'Desc A', gateResults: [{ gateId: 'g1', pass: true, reason: 'OK' }], criteriaScores: [{ criterionId: 'c1', score: 4, reason: 'OK' }], totalScore: 19, eliminated: false };
    await testDb.insert(schema.ideas).values({
      id: 'evo-rerun-conv-0', sessionId: 'sess-resume-evo-rerun', name: 'Idea A Scored', description: 'Desc A',
      phase: 'converge', score: 19, eliminated: 0, data: JSON.stringify(survivorData),
    });
    const survivorData2 = { ...survivorData, id: 'evo-rerun-conv-1', name: 'Idea B Scored', totalScore: 18 };
    await testDb.insert(schema.ideas).values({
      id: 'evo-rerun-conv-1', sessionId: 'sess-resume-evo-rerun', name: 'Idea B Scored', description: 'Desc B',
      phase: 'converge', score: 18, eliminated: 0, data: JSON.stringify(survivorData2),
    });

    // Mock: evolution worker + rescore = 2 LLM calls
    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(evolvedConcepts)))
      .mockReturnValueOnce(queryResult(JSON.stringify(rescoredEvolved)));

    await runFactory({ ...factoryOptions('sess-resume-evo-rerun'), resume: true });

    // Only 2 LLM calls: evolution + rescore
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Converge ideas should still be in DB
    const convergeRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-resume-evo-rerun'), eq(schema.ideas.phase, 'converge')));
    expect(convergeRows).toHaveLength(2);

    // Evolve ideas should now exist
    const evolveRows = await testDb
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.sessionId, 'sess-resume-evo-rerun'), eq(schema.ideas.phase, 'evolve')));
    expect(evolveRows.length).toBeGreaterThanOrEqual(1);
  });

  it('resume=true with all phases done re-emits interactive with 0 LLM calls', async () => {
    await insertSession(testDb, 'sess-resume-interactive');

    // Pre-insert all phases
    await testDb.insert(schema.ideas).values({
      id: 'int-div-0', sessionId: 'sess-resume-interactive', workerId: 'worker-0',
      persona: 'First Principles', method: 'First Principles', name: 'Idea A', description: 'Desc A',
      phase: 'diverge', data: '{}',
    });
    const convergeData = { id: 'int-conv-0', name: 'Scored A', description: 'Desc', totalScore: 19, eliminated: false, gateResults: [], criteriaScores: [] };
    await testDb.insert(schema.ideas).values({
      id: 'int-conv-0', sessionId: 'sess-resume-interactive', name: 'Scored A', description: 'Desc',
      phase: 'converge', score: 19, eliminated: 0, data: JSON.stringify(convergeData),
    });
    const evolveData = { id: 'int-evo-0', name: 'Hybrid', description: 'Evolved', totalScore: 23, eliminated: false, gateResults: [], criteriaScores: [] };
    await testDb.insert(schema.ideas).values({
      id: 'int-evo-0', sessionId: 'sess-resume-interactive', name: 'Hybrid', description: 'Evolved',
      phase: 'evolve', score: 23, eliminated: 0, data: JSON.stringify(evolveData),
    });

    await runFactory({ ...factoryOptions('sess-resume-interactive'), resume: true });

    // 0 LLM calls
    expect(mockQuery).toHaveBeenCalledTimes(0);

    // factory:interactive should be emitted with the combined pool
    const interactiveEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-resume-interactive' && evt.type === 'factory:interactive',
    );
    expect(interactiveEvents).toHaveLength(1);
    const pool = interactiveEvents[0][1].data.combinedPool;
    expect(pool).toHaveLength(2); // 1 converge survivor + 1 evolved
    expect(pool.map((i: { name: string }) => i.name).sort()).toEqual(['Hybrid', 'Scored A']);
  });

  it('resume=false (default) deletes all ideas — backward compat', async () => {
    await insertSession(testDb, 'sess-resume-default');

    // Pre-insert some ideas
    await testDb.insert(schema.ideas).values({
      id: 'default-div-0', sessionId: 'sess-resume-default', workerId: 'worker-0',
      persona: 'First Principles', method: 'First Principles', name: 'Old Idea', description: 'Old',
      phase: 'diverge', data: '{}',
    });

    setupFullPipelineMocks();

    await runFactory(factoryOptions('sess-resume-default'));

    // The old idea should be gone (deleted before fresh run)
    const allRows = await testDb
      .select()
      .from(schema.ideas)
      .where(eq(schema.ideas.sessionId, 'sess-resume-default'));

    const oldIdea = allRows.find((r) => r.name === 'Old Idea');
    expect(oldIdea).toBeUndefined();
  });

  it('resume=true with no data throws "Nothing to resume"', async () => {
    await insertSession(testDb, 'sess-resume-nothing');

    await expect(
      runFactory({ ...factoryOptions('sess-resume-nothing'), resume: true }),
    ).rejects.toThrow(/Nothing to resume/);

    expect(mockQuery).toHaveBeenCalledTimes(0);
  });

  it('resume=true emits "Resumed" thought for skipped workers', async () => {
    await insertSession(testDb, 'sess-resume-thought');

    // Pre-insert worker-0 ideas
    for (let j = 0; j < 2; j++) {
      await testDb.insert(schema.ideas).values({
        id: `thought-w0-${j}`,
        sessionId: 'sess-resume-thought',
        workerId: 'worker-0',
        persona: 'First Principles',
        method: 'First Principles',
        name: `Idea ${j}`,
        description: `Desc ${j}`,
        probability: 'high',
        phase: 'diverge',
        data: JSON.stringify({ id: `worker-0-${j}`, workerId: 'worker-0', persona: 'First Principles', method: 'First Principles', name: `Idea ${j}`, description: `Desc ${j}`, probability: 'high' }),
      });
    }

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(worker1Ideas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(scoredIdeas)))
      .mockReturnValueOnce(queryResult(JSON.stringify(evolvedConcepts)))
      .mockReturnValueOnce(queryResult(JSON.stringify(rescoredEvolved)));

    await runFactory({ ...factoryOptions('sess-resume-thought'), resume: true });

    // Should emit "Resumed: 2 ideas already in DB" for worker-0
    const resumedEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { text?: string } }]) =>
        sid === 'sess-resume-thought' &&
        evt.type === 'agent:thought' &&
        evt.data.text?.includes('Resumed:'),
    );
    expect(resumedEvents.length).toBeGreaterThanOrEqual(1);
    expect(resumedEvents[0][1].data.text).toContain('2 ideas already in DB');
    expect(resumedEvents[0][1].data.agent).toContain('First Principles');
  });
});
