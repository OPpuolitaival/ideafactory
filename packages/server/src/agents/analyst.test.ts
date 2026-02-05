import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/setup.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mock: @anthropic-ai/claude-agent-sdk
// ---------------------------------------------------------------------------
const mockQuery = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// ---------------------------------------------------------------------------
// Mock: sseManager
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
// Mock: getDb
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

function queryResult(text: string, structured?: unknown) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'result', result: text, structured_output: structured };
    },
  };
}

function insertSession(db: TestDb, id: string, opts?: { status?: string; coordinate?: string; config?: string }) {
  return db.insert(schema.sessions).values({
    id,
    domain: 'Test Domain',
    coordinate: opts?.coordinate ?? 'Test > Coord',
    status: opts?.status ?? 'output',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    config: opts?.config ?? JSON.stringify({ workerCount: 2, ideasPerWorker: 15 }),
  });
}

function insertIdea(
  db: TestDb,
  id: string,
  sessionId: string,
  overrides?: Partial<{
    name: string;
    description: string;
    phase: string;
    score: number | null;
    eliminated: number;
    data: string | null;
  }>,
) {
  return db.insert(schema.ideas).values({
    id,
    sessionId,
    name: overrides?.name ?? `Idea ${id}`,
    description: overrides?.description ?? `Description for ${id}`,
    phase: overrides?.phase ?? 'diverge',
    score: overrides?.score ?? null,
    eliminated: overrides?.eliminated ?? 0,
    data: overrides?.data ?? null,
  });
}

// ---------------------------------------------------------------------------
// Valid response fixtures
// ---------------------------------------------------------------------------

const outputPackage = {
  concepts: [
    {
      rank: 1,
      name: 'Concept A',
      description: 'Desc',
      pros: ['Pro1'],
      cons: ['Con1'],
      openQuestions: ['Q1'],
      nextSteps: ['Step1'],
      qaVerdict: 'strong',
    },
  ],
  overallInsights: 'Key insight here.',
  suggestedNextSprint: ['Action 1'],
  sessionMetadata: {
    domain: 'Test Domain',
    coordinate: 'Test > Coord',
    methods: ['First Principles'],
    workerCount: 2,
    totalIdeasGenerated: 6,
    totalIdeasSurvived: 2,
    duration: 30000,
  },
};

const artifacts = [
  { type: 'radar_chart', format: 'svg', content: '<svg></svg>', label: 'Radar Chart' },
  { type: 'concept_sketch', format: 'svg', content: '<svg></svg>', label: 'Concept A Sketch' },
  { type: 'report_page', format: 'html', content: '<html></html>', label: 'Full Report' },
];

const methods = [
  { id: 1, name: 'First Principles', description: 'Break into functions', goodFor: 'Rethinking', builtIn: true },
];

function makeBaseOptions(sessionId: string) {
  return {
    sessionId,
    domain: 'Test Domain',
    coordinate: 'Test > Coord',
    methods,
    workerCount: 2,
    ideas: [
      { id: 'i1', name: 'Idea 1', description: 'Desc 1', phase: 'diverge', score: null, eliminated: null, data: null },
      { id: 'i2', name: 'Idea 2', description: 'Desc 2', phase: 'diverge', score: null, eliminated: null, data: null },
      { id: 'i3', name: 'Idea 3', description: 'Desc 3', phase: 'evolve', score: 8.5, eliminated: null, data: JSON.stringify({ id: 'i3' }) },
      { id: 'i4', name: 'Idea 4', description: 'Desc 4', phase: 'evolve', score: 7.2, eliminated: null, data: JSON.stringify({ id: 'i4' }) },
      { id: 'i5', name: 'Idea 5', description: 'QA A', phase: 'qa', score: null, eliminated: null, data: JSON.stringify({ conceptId: 'c1', verdict: 'strong', feasibilityScore: 9, risks: ['r1'] }) },
      { id: 'i6', name: 'Idea 6', description: 'QA B', phase: 'qa', score: null, eliminated: null, data: JSON.stringify({ conceptId: 'c2', verdict: 'conditional', feasibilityScore: 6, risks: [] }) },
    ],
    model: 'claude-sonnet-4-20250514',
  };
}

// ==========================================================================
// Analyst - runOutput
// ==========================================================================

describe('Analyst - runOutput', () => {
  let runOutput: typeof import('./analyst.js')['runOutput'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./analyst.js');
    runOutput = mod.runOutput;
  });

  // -----------------------------------------------------------------------
  // 1. Persists output package to DB
  // -----------------------------------------------------------------------
  it('persists output package to database', async () => {
    const sid = 'sess-analyst-pkg';
    await insertSession(testDb, sid);

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(outputPackage)))
      .mockReturnValueOnce(queryResult(JSON.stringify(artifacts)));

    await runOutput(makeBaseOptions(sid));

    const [row] = await testDb
      .select()
      .from(schema.outputPackages)
      .where(eq(schema.outputPackages.sessionId, sid));

    expect(row).toBeDefined();
    const stored = JSON.parse(row.package);
    expect(stored.concepts).toHaveLength(1);
    expect(stored.concepts[0].name).toBe('Concept A');
    expect(stored.overallInsights).toBe('Key insight here.');
  });

  // -----------------------------------------------------------------------
  // 2. Persists visual artifacts to DB
  // -----------------------------------------------------------------------
  it('persists visual artifacts to database', async () => {
    const sid = 'sess-analyst-art';
    await insertSession(testDb, sid);

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(outputPackage)))
      .mockReturnValueOnce(queryResult(JSON.stringify(artifacts)));

    await runOutput(makeBaseOptions(sid));

    const [row] = await testDb
      .select()
      .from(schema.outputPackages)
      .where(eq(schema.outputPackages.sessionId, sid));

    expect(row).toBeDefined();
    expect(row.artifacts).toBeDefined();
    const storedArtifacts = JSON.parse(row.artifacts!);
    expect(storedArtifacts).toHaveLength(3);
    expect(storedArtifacts[0].type).toBe('radar_chart');
    expect(storedArtifacts[1].type).toBe('concept_sketch');
    expect(storedArtifacts[2].type).toBe('report_page');
  });

  // -----------------------------------------------------------------------
  // 3. Emits SSE data:output_package event
  // -----------------------------------------------------------------------
  it('emits SSE data:output_package event', async () => {
    const sid = 'sess-analyst-sse-pkg';
    await insertSession(testDb, sid);

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(outputPackage)))
      .mockReturnValueOnce(queryResult(JSON.stringify(artifacts)));

    await runOutput(makeBaseOptions(sid));

    const outputEvents = mockEmit.mock.calls.filter(
      ([sessionId, evt]: [string, { type: string }]) =>
        sessionId === sid && evt.type === 'data:output_package',
    );
    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0][1].data).toEqual(outputPackage);
  });

  // -----------------------------------------------------------------------
  // 4. Emits agent:thought events
  // -----------------------------------------------------------------------
  it('emits agent:thought events during execution', async () => {
    const sid = 'sess-analyst-thoughts';
    await insertSession(testDb, sid);

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(outputPackage)))
      .mockReturnValueOnce(queryResult(JSON.stringify(artifacts)));

    await runOutput(makeBaseOptions(sid));

    const thoughtEvents = mockEmit.mock.calls.filter(
      ([sessionId, evt]: [string, { type: string; data: { agent?: string } }]) =>
        sessionId === sid && evt.type === 'agent:thought' && evt.data.agent === 'Analyst',
    );

    // At least: "Packaging final output...", "Starting work...", "Generating visual artifacts...", "Starting work...", "Output packaging complete."
    expect(thoughtEvents.length).toBeGreaterThanOrEqual(3);
  });

  // -----------------------------------------------------------------------
  // 7. Validates output against OutputPackageSchema (rejects invalid)
  // -----------------------------------------------------------------------
  it('validates output against OutputPackageSchema and rejects invalid data', async () => {
    const sid = 'sess-analyst-validate-pkg';
    await insertSession(testDb, sid);

    // Missing required fields (no concepts, no overallInsights, etc.)
    const invalidPackage = { concepts: 'not-an-array' };
    mockQuery.mockReturnValue(queryResult(JSON.stringify(invalidPackage)));

    await expect(runOutput(makeBaseOptions(sid))).rejects.toThrow();
  });

  // -----------------------------------------------------------------------
  // 8. Validates artifacts against VisualArtifactSchema (rejects invalid)
  // -----------------------------------------------------------------------
  it('validates artifacts against VisualArtifactSchema and rejects invalid data', async () => {
    const sid = 'sess-analyst-validate-art';
    await insertSession(testDb, sid);

    // Valid output package, but invalid artifacts
    const invalidArtifacts = [{ type: 'invalid_type', format: 'txt', content: '', label: '' }];

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(outputPackage)))
      .mockReturnValue(queryResult(JSON.stringify(invalidArtifacts)));

    await expect(runOutput(makeBaseOptions(sid))).rejects.toThrow();
  });

  // -----------------------------------------------------------------------
  // 9. Handles ideas with different phases (filters diverge vs evolve vs qa)
  // -----------------------------------------------------------------------
  it('handles ideas with different phases correctly in LLM prompt', async () => {
    const sid = 'sess-analyst-phases';
    await insertSession(testDb, sid);

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(outputPackage)))
      .mockReturnValueOnce(queryResult(JSON.stringify(artifacts)));

    const opts = makeBaseOptions(sid);
    await runOutput(opts);

    // The first LLM call prompt should contain evolved concept data and QA data
    const firstCallPrompt = mockQuery.mock.calls[0][0].prompt;

    // Evolved ideas should appear as concept data
    expect(firstCallPrompt).toContain('Idea 3');
    expect(firstCallPrompt).toContain('Idea 4');

    // QA results should appear
    expect(firstCallPrompt).toContain('verdict=strong');
    expect(firstCallPrompt).toContain('verdict=conditional');

    // Diverge count should be referenced (total ideas generated)
    expect(firstCallPrompt).toContain('Total ideas generated: 2');
    expect(firstCallPrompt).toContain('Total ideas survived to evolution: 2');
  });

  // -----------------------------------------------------------------------
  // 10. Makes exactly two LLM calls
  // -----------------------------------------------------------------------
  it('makes exactly two LLM calls', async () => {
    const sid = 'sess-analyst-callcount';
    await insertSession(testDb, sid);

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(outputPackage)))
      .mockReturnValueOnce(queryResult(JSON.stringify(artifacts)));

    await runOutput(makeBaseOptions(sid));

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // 11. Both LLM calls use correct model
  // -----------------------------------------------------------------------
  it('passes the correct model to both LLM calls', async () => {
    const sid = 'sess-analyst-model';
    await insertSession(testDb, sid);

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(outputPackage)))
      .mockReturnValueOnce(queryResult(JSON.stringify(artifacts)));

    await runOutput(makeBaseOptions(sid));

    expect(mockQuery.mock.calls[0][0].options.model).toBe('claude-sonnet-4-20250514');
    expect(mockQuery.mock.calls[1][0].options.model).toBe('claude-sonnet-4-20250514');
  });
});
