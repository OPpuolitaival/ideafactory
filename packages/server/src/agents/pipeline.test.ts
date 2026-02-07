import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/setup.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';

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
// Mock: individual agent functions
// ---------------------------------------------------------------------------
const mockRunTaxonomy = vi.fn().mockResolvedValue(undefined);
const mockRunMethodSelection = vi.fn().mockResolvedValue(undefined);
const mockRunRubricDesign = vi.fn().mockResolvedValue(undefined);
const mockRunFactory = vi.fn().mockResolvedValue(undefined);
const mockRunOutput = vi.fn().mockResolvedValue(undefined);

vi.mock('./navigator.js', () => ({ runTaxonomy: (...args: unknown[]) => mockRunTaxonomy(...args) }));
vi.mock('./strategist.js', () => ({
  runMethodSelection: (...args: unknown[]) => mockRunMethodSelection(...args),
  runRubricDesign: (...args: unknown[]) => mockRunRubricDesign(...args),
}));
vi.mock('./factory.js', () => ({ runFactory: (...args: unknown[]) => mockRunFactory(...args) }));
vi.mock('./analyst.js', () => ({ runOutput: (...args: unknown[]) => mockRunOutput(...args) }));

// ---------------------------------------------------------------------------
// Mock: config
// ---------------------------------------------------------------------------
const mockLoadConfig = vi.fn();
const mockGetAllMethods = vi.fn();

vi.mock('../config/index.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  getAllMethods: (...args: unknown[]) => mockGetAllMethods(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultConfig = {
  defaults: { ideasPerWorker: 15, webSearch: false },
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
  { id: 1, name: 'First Principles', description: 'd', goodFor: 'g', builtIn: true },
];

function setupDefaultConfig() {
  mockLoadConfig.mockReturnValue(defaultConfig);
  mockGetAllMethods.mockReturnValue(allMethods);
}

async function insertSession(
  db: TestDb,
  id: string,
  opts?: { status?: string; coordinate?: string; config?: string; domain?: string },
) {
  return db.insert(schema.sessions).values({
    id,
    domain: opts?.domain ?? 'test domain',
    coordinate: opts?.coordinate ?? 'test > coordinate',
    status: opts?.status ?? 'taxonomy',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    config: opts?.config ?? JSON.stringify({ ideasPerWorker: 15 }),
  });
}

async function insertMethodSelection(db: TestDb, sessionId: string, selected: number[]) {
  return db.insert(schema.methodSelections).values({
    sessionId,
    recommended: JSON.stringify(selected),
    reasoning: JSON.stringify({ '1': 'Good method' }),
    selected: JSON.stringify(selected),
  });
}

async function insertRubric(db: TestDb, sessionId: string) {
  const rubric = {
    gates: [{ id: 'g1', text: 'Must be possible' }],
    criteria: [{ id: 'c1', text: 'Novelty', weight: 4, description: 'How new?' }],
    tests: [{ id: 't1', text: 'Can a user explain it?' }],
  };
  return db.insert(schema.rubrics).values({
    sessionId,
    rubric: JSON.stringify(rubric),
  });
}

async function insertIdea(
  db: TestDb,
  id: string,
  sessionId: string,
  opts?: { phase?: string; score?: number | null; data?: string | null },
) {
  return db.insert(schema.ideas).values({
    id,
    sessionId,
    name: `Idea ${id}`,
    description: `Description for ${id}`,
    phase: opts?.phase ?? 'diverge',
    score: opts?.score ?? null,
    eliminated: 0,
    data: opts?.data ?? null,
  });
}

// ==========================================================================
// Pipeline - runPipeline
// ==========================================================================

describe('Pipeline - runPipeline', () => {
  let runPipeline: typeof import('./pipeline.js')['runPipeline'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    setupDefaultConfig();
    const mod = await import('./pipeline.js');
    runPipeline = mod.runPipeline;
  });

  // -----------------------------------------------------------------------
  // 1. Taxonomy stage: calls runTaxonomy with correct args
  // -----------------------------------------------------------------------
  it('taxonomy stage calls runTaxonomy with correct args', async () => {
    const sid = 'sess-pipe-tax';
    await insertSession(testDb, sid, { config: JSON.stringify({ ideasPerWorker: 15, webSearch: true }) });

    await runPipeline(sid, 'taxonomy');

    expect(mockRunTaxonomy).toHaveBeenCalledTimes(1);
    expect(mockRunTaxonomy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sid,
        domain: 'test domain',
        webSearch: true,
        model: 'claude-haiku-4-20250414',
      }),
    );
    // Verify signal is passed
    expect(mockRunTaxonomy.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  // -----------------------------------------------------------------------
  // 2. Taxonomy stage: emits status:stage_complete with next='methods'
  // -----------------------------------------------------------------------
  it('taxonomy stage emits status:stage_complete with next methods', async () => {
    const sid = 'sess-pipe-tax-sse';
    await insertSession(testDb, sid);

    await runPipeline(sid, 'taxonomy');

    const stageCompleteEvents = mockEmit.mock.calls.filter(
      ([sessionId, evt]: [string, { type: string; data: { stage: string; next: string } }]) =>
        sessionId === sid && evt.type === 'status:stage_complete',
    );
    expect(stageCompleteEvents).toHaveLength(1);
    expect(stageCompleteEvents[0][1].data).toEqual({ stage: 'taxonomy', next: 'methods' });
  });

  // -----------------------------------------------------------------------
  // 3. Methods stage: calls runMethodSelection with correct args
  // -----------------------------------------------------------------------
  it('methods stage calls runMethodSelection with correct args', async () => {
    const sid = 'sess-pipe-meth';
    await insertSession(testDb, sid);

    await runPipeline(sid, 'methods');

    expect(mockRunMethodSelection).toHaveBeenCalledTimes(1);
    expect(mockRunMethodSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sid,
        coordinate: 'test > coordinate',
        methods: allMethods,
        model: 'claude-sonnet-4-20250514',
      }),
    );
    expect(mockRunMethodSelection.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  // -----------------------------------------------------------------------
  // 4. Methods stage: emits status:stage_complete with next='rubric'
  // -----------------------------------------------------------------------
  it('methods stage emits status:stage_complete with next rubric', async () => {
    const sid = 'sess-pipe-meth-sse';
    await insertSession(testDb, sid);

    await runPipeline(sid, 'methods');

    const stageCompleteEvents = mockEmit.mock.calls.filter(
      ([sessionId, evt]: [string, { type: string; data: { stage: string; next: string } }]) =>
        sessionId === sid && evt.type === 'status:stage_complete',
    );
    expect(stageCompleteEvents).toHaveLength(1);
    expect(stageCompleteEvents[0][1].data).toEqual({ stage: 'methods', next: 'rubric' });
  });

  // -----------------------------------------------------------------------
  // 5. Rubric stage: calls runRubricDesign with correct args (loads method selections from DB)
  // -----------------------------------------------------------------------
  it('rubric stage calls runRubricDesign with methods loaded from DB', async () => {
    const sid = 'sess-pipe-rubric';
    await insertSession(testDb, sid);
    await insertMethodSelection(testDb, sid, [1]);

    await runPipeline(sid, 'rubric');

    expect(mockRunRubricDesign).toHaveBeenCalledTimes(1);
    expect(mockRunRubricDesign).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: sid,
        coordinate: 'test > coordinate',
        domain: 'test domain',
        methods: allMethods, // id 1 matches the allMethods fixture
        model: 'claude-sonnet-4-20250514',
      }),
    );
    expect(mockRunRubricDesign.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  // -----------------------------------------------------------------------
  // 6. Factory stage: calls runFactory with correct args (loads rubric, methods from DB)
  // -----------------------------------------------------------------------
  it('factory stage calls runFactory with rubric and methods loaded from DB', async () => {
    const sid = 'sess-pipe-factory';
    await insertSession(testDb, sid);
    await insertMethodSelection(testDb, sid, [1]);
    await insertRubric(testDb, sid);

    await runPipeline(sid, 'factory');

    expect(mockRunFactory).toHaveBeenCalledTimes(1);
    const factoryArgs = mockRunFactory.mock.calls[0][0];
    expect(factoryArgs.sessionId).toBe(sid);
    expect(factoryArgs.domain).toBe('test domain');
    expect(factoryArgs.coordinate).toBe('test > coordinate');
    expect(factoryArgs.methods).toEqual(allMethods);
    expect(factoryArgs.rubric).toBeDefined();
    expect(factoryArgs.rubric.gates).toHaveLength(1);
    expect(factoryArgs.ideasPerWorker).toBe(15);
    expect(factoryArgs.workerModel).toBe('claude-sonnet-4-20250514');
    expect(factoryArgs.analystModel).toBe('claude-sonnet-4-20250514');
  });

  // -----------------------------------------------------------------------
  // 7. Output stage: calls runOutput, marks session completed
  // -----------------------------------------------------------------------
  it('output stage calls runOutput and marks session as completed', async () => {
    const sid = 'sess-pipe-output';
    await insertSession(testDb, sid);
    await insertMethodSelection(testDb, sid, [1]);
    await insertIdea(testDb, 'idea-1', sid, { phase: 'diverge' });
    await insertIdea(testDb, 'idea-2', sid, { phase: 'evolve', score: 8.5 });

    await runPipeline(sid, 'output');

    expect(mockRunOutput).toHaveBeenCalledTimes(1);
    const outputArgs = mockRunOutput.mock.calls[0][0];
    expect(outputArgs.sessionId).toBe(sid);
    expect(outputArgs.domain).toBe('test domain');
    expect(outputArgs.methods).toEqual(allMethods);
    expect(outputArgs.ideas).toHaveLength(2);
    expect(outputArgs.model).toBe('claude-sonnet-4-20250514');

    // Verify session is marked completed
    const [session] = await testDb
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sid));
    expect(session.status).toBe('completed');
  });

  // -----------------------------------------------------------------------
  // 8. Output stage: emits status:stage_complete with next='completed'
  // -----------------------------------------------------------------------
  it('output stage emits status:stage_complete with next completed', async () => {
    const sid = 'sess-pipe-output-sse';
    await insertSession(testDb, sid);
    await insertMethodSelection(testDb, sid, [1]);

    await runPipeline(sid, 'output');

    const stageCompleteEvents = mockEmit.mock.calls.filter(
      ([sessionId, evt]: [string, { type: string; data: { stage: string; next: string } }]) =>
        sessionId === sid && evt.type === 'status:stage_complete',
    );
    expect(stageCompleteEvents).toHaveLength(1);
    expect(stageCompleteEvents[0][1].data).toEqual({ stage: 'output', next: 'completed' });
  });

  // -----------------------------------------------------------------------
  // 9. Error handling: emits status:error when agent throws
  // -----------------------------------------------------------------------
  it('emits status:error when agent function throws', async () => {
    const sid = 'sess-pipe-throw';
    await insertSession(testDb, sid);

    mockRunTaxonomy.mockRejectedValueOnce(new Error('LLM rate limit exceeded'));

    await runPipeline(sid, 'taxonomy');

    const errorEvents = mockEmit.mock.calls.filter(
      ([sessionId, evt]: [string, { type: string }]) =>
        sessionId === sid && evt.type === 'status:error',
    );
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0][1].data.error).toBe('LLM rate limit exceeded');
    expect(errorEvents[0][1].data.stage).toBe('taxonomy');
  });

  // -----------------------------------------------------------------------
  // 11. Session not found: throws error (caught by error handler)
  // -----------------------------------------------------------------------
  it('emits status:error when session is not found', async () => {
    const sid = 'sess-pipe-notfound';
    // Do NOT insert a session - it should not exist

    await runPipeline(sid, 'taxonomy');

    const errorEvents = mockEmit.mock.calls.filter(
      ([sessionId, evt]: [string, { type: string }]) =>
        sessionId === sid && evt.type === 'status:error',
    );
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0][1].data.error).toBe('Session not found');
  });

  // -----------------------------------------------------------------------
  // 10. Abort: DOMException with AbortError name is silently ignored
  // -----------------------------------------------------------------------
  it('silently ignores AbortError without emitting status:error', async () => {
    const sid = 'sess-pipe-abort';
    await insertSession(testDb, sid);

    // Agent throws DOMException (as callLLM does when external signal fires)
    mockRunTaxonomy.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    await runPipeline(sid, 'taxonomy');

    // Should NOT emit status:error
    const errorEvents = mockEmit.mock.calls.filter(
      ([sessionId, evt]: [string, { type: string }]) =>
        sessionId === sid && evt.type === 'status:error',
    );
    expect(errorEvents).toHaveLength(0);

    // Should NOT emit status:stage_complete either (stage was aborted, not completed)
    const completeEvents = mockEmit.mock.calls.filter(
      ([sessionId, evt]: [string, { type: string }]) =>
        sessionId === sid && evt.type === 'status:stage_complete',
    );
    expect(completeEvents).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 12. Taxonomy stage reads webSearch from session config
  // -----------------------------------------------------------------------
  it('taxonomy stage reads webSearch=false from session config by default', async () => {
    const sid = 'sess-pipe-tax-ws';
    await insertSession(testDb, sid, { config: JSON.stringify({ ideasPerWorker: 15 }) });

    await runPipeline(sid, 'taxonomy');

    expect(mockRunTaxonomy).toHaveBeenCalledWith(
      expect.objectContaining({ webSearch: false }),
    );
  });

  // -----------------------------------------------------------------------
  // 14. Rubric stage: emits status:stage_complete with next='factory'
  // -----------------------------------------------------------------------
  it('rubric stage emits status:stage_complete with next factory', async () => {
    const sid = 'sess-pipe-rubric-sse';
    await insertSession(testDb, sid);
    await insertMethodSelection(testDb, sid, [1]);

    await runPipeline(sid, 'rubric');

    const stageCompleteEvents = mockEmit.mock.calls.filter(
      ([sessionId, evt]: [string, { type: string; data: { stage: string; next: string } }]) =>
        sessionId === sid && evt.type === 'status:stage_complete',
    );
    expect(stageCompleteEvents).toHaveLength(1);
    expect(stageCompleteEvents[0][1].data).toEqual({ stage: 'rubric', next: 'factory' });
  });

  // -----------------------------------------------------------------------
  // 15. Factory stage: emits status:stage_complete with next='output'
  // -----------------------------------------------------------------------
  it('factory stage emits status:stage_complete with next output', async () => {
    const sid = 'sess-pipe-factory-sse';
    await insertSession(testDb, sid);
    await insertMethodSelection(testDb, sid, [1]);
    await insertRubric(testDb, sid);

    await runPipeline(sid, 'factory');

    const stageCompleteEvents = mockEmit.mock.calls.filter(
      ([sessionId, evt]: [string, { type: string; data: { stage: string; next: string } }]) =>
        sessionId === sid && evt.type === 'status:stage_complete',
    );
    expect(stageCompleteEvents).toHaveLength(1);
    expect(stageCompleteEvents[0][1].data).toEqual({ stage: 'factory', next: 'output' });
  });
});
