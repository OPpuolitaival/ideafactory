import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
// Mock: sseManager – track all emitted events
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
// Mock: getDb – replaced per-test with in-memory SQLite via createTestDb()
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

/** Build the Agent SDK query result shape */
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
    status: 'taxonomy',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    config: JSON.stringify({ workerCount: 3, ideasPerWorker: 15 }),
  });
}

// ==========================================================================
// 1. extractJSON
// ==========================================================================

describe('extractJSON', () => {
  // Import lazily so mocks are already in place
  let extractJSON: typeof import('./llm.js')['extractJSON'];

  beforeEach(async () => {
    const mod = await import('./llm.js');
    extractJSON = mod.extractJSON;
  });

  it('extracts a plain JSON object', () => {
    const input = '{"name":"hello","p":"high"}';
    expect(JSON.parse(extractJSON(input))).toEqual({ name: 'hello', p: 'high' });
  });

  it('extracts JSON from a fenced code block', () => {
    const input = 'Here is the result:\n```json\n{"name":"hello","p":"high"}\n```\nDone.';
    expect(JSON.parse(extractJSON(input))).toEqual({ name: 'hello', p: 'high' });
  });

  it('extracts JSON from a code block without json language hint', () => {
    const input = '```\n{"name":"hello"}\n```';
    expect(JSON.parse(extractJSON(input))).toEqual({ name: 'hello' });
  });

  it('extracts a JSON array', () => {
    const input = 'Some text [1,2,3] more text';
    expect(JSON.parse(extractJSON(input))).toEqual([1, 2, 3]);
  });

  it('returns trimmed text for malformed / non-JSON input', () => {
    const input = '  not json at all  ';
    expect(extractJSON(input)).toBe('not json at all');
  });

  it('returns trimmed text for empty string', () => {
    expect(extractJSON('')).toBe('');
  });

  it('prefers code block over raw JSON when both present', () => {
    const input = '{"outer":true}\n```json\n{"inner":true}\n```';
    expect(JSON.parse(extractJSON(input))).toEqual({ inner: true });
  });
});

// ==========================================================================
// 2. callLLMWithRetry
// ==========================================================================

describe('callLLMWithRetry', () => {
  let callLLMWithRetry: typeof import('./llm.js')['callLLMWithRetry'];

  beforeEach(async () => {
    vi.clearAllMocks();
    const llmModule = await import('./llm.js');
    callLLMWithRetry = llmModule.callLLMWithRetry;
  });

  it('succeeds on first attempt when parse is valid', async () => {
    mockQuery.mockReturnValueOnce(
      queryResult('{"name":"result","p":"high"}'),
    );

    const result = await callLLMWithRetry(
      {
        model: 'claude-sonnet-4-20250514',
        system: 'test system',
        prompt: 'test prompt',
        sessionId: 'sess-1',
        agentName: 'TestAgent',
      },
      (text) => JSON.parse(text),
    );

    expect(result).toEqual({ name: 'result', p: 'high' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('retries on parse failure and succeeds on second attempt', async () => {
    // First call returns bad JSON, second returns good JSON
    mockQuery
      .mockReturnValueOnce(queryResult('not json'))
      .mockReturnValueOnce(queryResult('{"ok":true}'));

    const result = await callLLMWithRetry(
      {
        model: 'claude-sonnet-4-20250514',
        system: 'sys',
        prompt: 'p',
        sessionId: 'sess-1',
        agentName: 'Retry',
      },
      (text) => JSON.parse(text),
      2,
    );

    expect(result).toEqual({ ok: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries are exceeded', async () => {
    mockQuery.mockReturnValue(queryResult('bad json'));

    await expect(
      callLLMWithRetry(
        {
          model: 'claude-sonnet-4-20250514',
          system: 'sys',
          prompt: 'p',
          sessionId: 'sess-1',
          agentName: 'Fail',
        },
        (text) => JSON.parse(text),
        1, // maxRetries = 1 → 2 total attempts
      ),
    ).rejects.toThrow(/Failed after 2 attempts/);

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('emits retry SSE events on parse failure', async () => {
    mockQuery
      .mockReturnValueOnce(queryResult('bad'))
      .mockReturnValueOnce(queryResult('{"ok":true}'));

    await callLLMWithRetry(
      {
        model: 'claude-sonnet-4-20250514',
        system: 'sys',
        prompt: 'p',
        sessionId: 'sess-retry',
        agentName: 'RetryAgent',
      },
      (text) => JSON.parse(text),
      2,
    );

    // Should emit a retry thought event
    const retryEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { text: string } }]) =>
        sid === 'sess-retry' &&
        evt.type === 'agent:thought' &&
        evt.data.text.includes('retrying'),
    );
    expect(retryEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('throws immediately on auth error (401) without retrying', async () => {
    const authError = new Error('401 Unauthorized');
    Object.assign(authError, { status: 401 });
    mockQuery.mockImplementationOnce(() => { throw authError; });

    await expect(
      callLLMWithRetry(
        {
          model: 'claude-sonnet-4-20250514',
          system: 'sys',
          prompt: 'p',
          sessionId: 'sess-auth',
          agentName: 'AuthTest',
        },
        (text) => JSON.parse(text),
        2,
      ),
    ).rejects.toThrow(/Authentication failed/);

    // Should only have been called once (no retries)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('emits status:error on auth failure', async () => {
    const authError = new Error('401 Unauthorized');
    Object.assign(authError, { status: 401 });
    mockQuery.mockImplementationOnce(() => { throw authError; });

    await callLLMWithRetry(
      {
        model: 'claude-sonnet-4-20250514',
        system: 'sys',
        prompt: 'p',
        sessionId: 'sess-auth-sse',
        agentName: 'AuthSSE',
      },
      (text) => JSON.parse(text),
    ).catch(() => {});

    const errorEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-auth-sse' && evt.type === 'status:error',
    );
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('retries with backoff on rate limit error (429)', async () => {
    const rateLimitError = new Error('429 Rate limit exceeded');
    Object.assign(rateLimitError, { status: 429 });
    mockQuery
      .mockImplementationOnce(() => { throw rateLimitError; })
      .mockReturnValueOnce(queryResult('{"ok":true}'));

    const result = await callLLMWithRetry(
      {
        model: 'claude-sonnet-4-20250514',
        system: 'sys',
        prompt: 'p',
        sessionId: 'sess-rate',
        agentName: 'RateAgent',
      },
      (text) => JSON.parse(text),
    );

    expect(result).toEqual({ ok: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Should emit a rate-limit thought event
    const rateLimitEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { text: string } }]) =>
        sid === 'sess-rate' &&
        evt.type === 'agent:thought' &&
        evt.data.text.includes('Rate limited'),
    );
    expect(rateLimitEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ==========================================================================
// 3. Navigator – runTaxonomy
// ==========================================================================

describe('Navigator – runTaxonomy', () => {
  let runTaxonomy: typeof import('./navigator.js')['runTaxonomy'];

  const validTaxonomy = {
    name: 'Root',
    p: 'high',
    children: [
      {
        name: 'Category A',
        p: 'high',
        children: [
          { name: 'Subcategory A1', p: 'medium' },
          { name: 'Subcategory A2', p: 'low' },
        ],
      },
      {
        name: 'Category B',
        p: 'medium',
        children: [{ name: 'Subcategory B1', p: 'high' }],
      },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./navigator.js');
    runTaxonomy = mod.runTaxonomy;
  });

  it('persists taxonomy to database on valid LLM response', async () => {
    await insertSession(testDb, 'sess-nav');
    mockQuery.mockReturnValueOnce(
      queryResult(JSON.stringify(validTaxonomy)),
    );

    await runTaxonomy({
      sessionId: 'sess-nav',
      domain: 'test domain',
      webSearch: false,
      model: 'claude-haiku-4-20250414',
    });

    const [row] = await testDb
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, 'sess-nav'));

    expect(row).toBeDefined();
    const stored = JSON.parse(row.tree);
    expect(stored.name).toBe('Root');
    expect(stored.children).toHaveLength(2);
  });

  it('validates taxonomy against TaxonomyNodeSchema', async () => {
    await insertSession(testDb, 'sess-invalid-tax');
    // Missing required "p" field
    mockQuery.mockReturnValue(
      queryResult(JSON.stringify({ name: 'Root', children: [] })),
    );

    await expect(
      runTaxonomy({
        sessionId: 'sess-invalid-tax',
        domain: 'test domain',
        webSearch: false,
        model: 'claude-haiku-4-20250414',
      }),
    ).rejects.toThrow();
  });

  it('emits SSE events for taxonomy updates', async () => {
    await insertSession(testDb, 'sess-sse-tax');
    mockQuery.mockReturnValueOnce(
      queryResult(JSON.stringify(validTaxonomy)),
    );

    await runTaxonomy({
      sessionId: 'sess-sse-tax',
      domain: 'test domain',
      webSearch: false,
      model: 'claude-haiku-4-20250414',
    });

    const events = mockEmit.mock.calls
      .filter(([sid]: [string]) => sid === 'sess-sse-tax')
      .map(([, evt]: [string, { type: string }]) => evt.type);

    expect(events).toContain('agent:thought');
    expect(events).toContain('data:taxonomy_update');
  });
});

// ==========================================================================
// 4. Strategist – runMethodSelection
// ==========================================================================

describe('Strategist – runMethodSelection', () => {
  let runMethodSelection: typeof import('./strategist.js')['runMethodSelection'];

  const validRecommendation = {
    recommended: [1, 3, 5],
    reasoning: {
      '1': 'First Principles is good for rethinking assumptions.',
      '3': 'TRIZ resolves trade-offs well.',
      '5': 'Extreme Constraints forces creative solutions.',
    },
  };

  const methods = [
    { id: 1, name: 'First Principles', description: 'Break into functions', goodFor: 'Rethinking', builtIn: true },
    { id: 3, name: 'TRIZ', description: 'Contradiction-solving', goodFor: 'Trade-offs', builtIn: true },
    { id: 5, name: 'Extreme Constraints', description: 'Design under limits', goodFor: 'Cost innovation', builtIn: true },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./strategist.js');
    runMethodSelection = mod.runMethodSelection;
  });

  it('persists method recommendation to database', async () => {
    await insertSession(testDb, 'sess-meth');
    mockQuery.mockReturnValueOnce(
      queryResult(JSON.stringify(validRecommendation)),
    );

    await runMethodSelection({
      sessionId: 'sess-meth',
      coordinate: 'test > coordinate',
      methods,
      model: 'claude-sonnet-4-20250514',
    });

    const [row] = await testDb
      .select()
      .from(schema.methodSelections)
      .where(eq(schema.methodSelections.sessionId, 'sess-meth'));

    expect(row).toBeDefined();
    const recommended = JSON.parse(row.recommended);
    expect(recommended).toEqual([1, 3, 5]);
  });

  it('verifies recommendation format matches MethodRecommendationSchema', async () => {
    await insertSession(testDb, 'sess-meth-bad');
    // Missing "recommended" array
    mockQuery.mockReturnValue(
      queryResult(JSON.stringify({ reasoning: {} })),
    );

    await expect(
      runMethodSelection({
        sessionId: 'sess-meth-bad',
        coordinate: 'coord',
        methods,
        model: 'claude-sonnet-4-20250514',
      }),
    ).rejects.toThrow();
  });

  it('emits SSE events for method recommendations', async () => {
    await insertSession(testDb, 'sess-meth-sse');
    mockQuery.mockReturnValueOnce(
      queryResult(JSON.stringify(validRecommendation)),
    );

    await runMethodSelection({
      sessionId: 'sess-meth-sse',
      coordinate: 'coord',
      methods,
      model: 'claude-sonnet-4-20250514',
    });

    const events = mockEmit.mock.calls
      .filter(([sid]: [string]) => sid === 'sess-meth-sse')
      .map(([, evt]: [string, { type: string }]) => evt.type);

    expect(events).toContain('data:methods_recommended');
    expect(events).toContain('agent:thought');
  });
});

// ==========================================================================
// 5. Strategist – runRubricDesign
// ==========================================================================

describe('Strategist – runRubricDesign', () => {
  let runRubricDesign: typeof import('./strategist.js')['runRubricDesign'];

  const validRubric = {
    gates: [
      { id: 'g1', text: 'Must be physically possible' },
      { id: 'g2', text: 'Must not violate regulations' },
      { id: 'g3', text: 'Must solve the stated problem' },
    ],
    criteria: [
      { id: 'c1', text: 'Novelty', weight: 4, description: 'How new is this idea?' },
      { id: 'c2', text: 'Feasibility', weight: 5, description: 'Can it be built?' },
      { id: 'c3', text: 'Cost', weight: 3, description: 'Budget reasonable?' },
      { id: 'c4', text: 'Delight', weight: 4, description: 'User joy factor' },
      { id: 'c5', text: 'Scalability', weight: 3, description: 'Can it scale?' },
    ],
    tests: [
      { id: 't1', text: 'Can a user explain it in one sentence?' },
      { id: 't2', text: 'Would a competitor struggle to copy it?' },
      { id: 't3', text: 'Does it pass a basic cost-benefit analysis?' },
    ],
  };

  const methods = [
    { id: 1, name: 'First Principles', description: 'Break into functions', goodFor: 'Rethinking', builtIn: true },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./strategist.js');
    runRubricDesign = mod.runRubricDesign;
  });

  it('persists rubric to database', async () => {
    await insertSession(testDb, 'sess-rubric');
    mockQuery.mockReturnValueOnce(
      queryResult(JSON.stringify(validRubric)),
    );

    await runRubricDesign({
      sessionId: 'sess-rubric',
      coordinate: 'test > coordinate',
      domain: 'test domain',
      methods,
      model: 'claude-sonnet-4-20250514',
    });

    const [row] = await testDb
      .select()
      .from(schema.rubrics)
      .where(eq(schema.rubrics.sessionId, 'sess-rubric'));

    expect(row).toBeDefined();
    const stored = JSON.parse(row.rubric);
    expect(stored.gates).toHaveLength(3);
    expect(stored.criteria).toHaveLength(5);
    expect(stored.tests).toHaveLength(3);
  });

  it('validates rubric structure against RubricSchema', async () => {
    await insertSession(testDb, 'sess-rubric-bad');
    // Missing gates
    mockQuery.mockReturnValue(
      queryResult(JSON.stringify({ criteria: [], tests: [] })),
    );

    await expect(
      runRubricDesign({
        sessionId: 'sess-rubric-bad',
        coordinate: 'coord',
        domain: 'domain',
        methods,
        model: 'claude-sonnet-4-20250514',
      }),
    ).rejects.toThrow();
  });

  it('emits SSE events for rubric generation', async () => {
    await insertSession(testDb, 'sess-rubric-sse');
    mockQuery.mockReturnValueOnce(
      queryResult(JSON.stringify(validRubric)),
    );

    await runRubricDesign({
      sessionId: 'sess-rubric-sse',
      coordinate: 'coord',
      domain: 'domain',
      methods,
      model: 'claude-sonnet-4-20250514',
    });

    const events = mockEmit.mock.calls
      .filter(([sid]: [string]) => sid === 'sess-rubric-sse')
      .map(([, evt]: [string, { type: string }]) => evt.type);

    expect(events).toContain('data:rubric_generated');
    expect(events).toContain('agent:thought');
  });

  it('rubric criteria weights are within valid range (1-5)', async () => {
    await insertSession(testDb, 'sess-rubric-weight');
    mockQuery.mockReturnValueOnce(
      queryResult(JSON.stringify(validRubric)),
    );

    await runRubricDesign({
      sessionId: 'sess-rubric-weight',
      coordinate: 'coord',
      domain: 'domain',
      methods,
      model: 'claude-sonnet-4-20250514',
    });

    const [row] = await testDb
      .select()
      .from(schema.rubrics)
      .where(eq(schema.rubrics.sessionId, 'sess-rubric-weight'));

    const stored = JSON.parse(row.rubric);
    for (const criterion of stored.criteria) {
      expect(criterion.weight).toBeGreaterThanOrEqual(1);
      expect(criterion.weight).toBeLessThanOrEqual(5);
    }
  });
});

// ==========================================================================
// 8. callLLM – basic behavior
// ==========================================================================

describe('callLLM', () => {
  let callLLM: typeof import('./llm.js')['callLLM'];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./llm.js');
    callLLM = mod.callLLM;
  });

  it('returns text content from LLM response', async () => {
    mockQuery.mockReturnValueOnce(queryResult('hello world'));

    const result = await callLLM({
      model: 'claude-sonnet-4-20250514',
      system: 'system',
      prompt: 'say hello',
    });

    expect(result).toBe('hello world');
  });

  it('emits agent:thought SSE when sessionId and agentName provided', async () => {
    mockQuery.mockReturnValueOnce(queryResult('response'));

    await callLLM({
      model: 'model',
      system: 'sys',
      prompt: 'p',
      sessionId: 'sess-thought',
      agentName: 'TestAgent',
    });

    const thoughtEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-thought' && evt.type === 'agent:thought',
    );
    expect(thoughtEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT emit SSE when sessionId or agentName is missing', async () => {
    mockQuery.mockReturnValueOnce(queryResult('response'));

    await callLLM({
      model: 'model',
      system: 'sys',
      prompt: 'p',
    });

    // No SSE events should have been emitted for "Starting work..."
    const startingEvents = mockEmit.mock.calls.filter(
      ([, evt]: [string, { type: string; data: { text: string } }]) =>
        evt.type === 'agent:thought' && evt.data.text === 'Starting work...',
    );
    expect(startingEvents).toHaveLength(0);
  });

  it('passes model and systemPrompt to Agent SDK', async () => {
    mockQuery.mockReturnValueOnce(queryResult('ok'));
    await callLLM({
      model: 'my-model',
      system: 'my-system',
      prompt: 'my-prompt',
    });
    const args = mockQuery.mock.calls[0][0];
    expect(args.prompt).toBe('my-prompt');
    expect(args.options.model).toBe('my-model');
    expect(args.options.systemPrompt).toBe('my-system');
  });

  it('passes abortController to Agent SDK for timeout', async () => {
    mockQuery.mockReturnValueOnce(queryResult('ok'));
    await callLLM({
      model: 'model',
      system: 'sys',
      prompt: 'p',
      timeoutMs: 30000,
    });
    const args = mockQuery.mock.calls[0][0];
    expect(args.options.abortController).toBeDefined();
    expect(args.options.abortController).toBeInstanceOf(AbortController);
  });

  it('uses 120s default timeout', async () => {
    mockQuery.mockReturnValueOnce(queryResult('ok'));
    await callLLM({
      model: 'model',
      system: 'sys',
      prompt: 'p',
    });
    const args = mockQuery.mock.calls[0][0];
    expect(args.options.abortController).toBeDefined();
    // Signal should not be aborted yet (120s hasn't passed)
    expect(args.options.abortController.signal.aborted).toBe(false);
  });

  it('rejects when the request times out', async () => {
    mockQuery.mockImplementationOnce(({ options }: { options: { abortController: AbortController } }) => ({
      [Symbol.asyncIterator]: async function* () {
        await new Promise((_resolve, reject) => {
          options.abortController.signal.addEventListener('abort', () => {
            reject(new Error('Request was aborted.'));
          });
        });
      },
    }));
    await expect(
      callLLM({
        model: 'model',
        system: 'sys',
        prompt: 'p',
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/aborted/i);
  });
});

// ==========================================================================
// 9. Navigator – additional edge cases
// ==========================================================================

describe('Navigator – edge cases', () => {
  let runTaxonomy: typeof import('./navigator.js')['runTaxonomy'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./navigator.js');
    runTaxonomy = mod.runTaxonomy;
  });

  it('handles taxonomy returned inside code block', async () => {
    await insertSession(testDb, 'sess-cb');
    const taxonomy = { name: 'Root', p: 'high', children: [] };
    mockQuery.mockReturnValueOnce(
      queryResult('```json\n' + JSON.stringify(taxonomy) + '\n```'),
    );

    await runTaxonomy({
      sessionId: 'sess-cb',
      domain: 'test',
      webSearch: false,
      model: 'model',
    });

    const [row] = await testDb
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, 'sess-cb'));
    expect(row).toBeDefined();
    expect(JSON.parse(row.tree).name).toBe('Root');
  });

  it('emits thought events with correct agent name "Navigator"', async () => {
    await insertSession(testDb, 'sess-agent-name');
    const taxonomy = { name: 'Root', p: 'high', children: [] };
    mockQuery.mockReturnValueOnce(queryResult(JSON.stringify(taxonomy)));

    await runTaxonomy({
      sessionId: 'sess-agent-name',
      domain: 'test',
      webSearch: false,
      model: 'model',
    });

    const navigatorEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { agent?: string } }]) =>
        sid === 'sess-agent-name' &&
        evt.type === 'agent:thought' &&
        evt.data.agent === 'Navigator',
    );
    expect(navigatorEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ==========================================================================
// 10. Strategist – runMethodSelection edge cases
// ==========================================================================

describe('Strategist – runMethodSelection edge cases', () => {
  let runMethodSelection: typeof import('./strategist.js')['runMethodSelection'];

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./strategist.js');
    runMethodSelection = mod.runMethodSelection;
  });

  it('defaults selected to recommended in DB', async () => {
    await insertSession(testDb, 'sess-default-sel');
    const rec = { recommended: [2, 4], reasoning: { '2': 'Good', '4': 'Great' } };
    mockQuery.mockReturnValueOnce(queryResult(JSON.stringify(rec)));

    await runMethodSelection({
      sessionId: 'sess-default-sel',
      coordinate: 'coord',
      methods: [
        { id: 2, name: 'M2', description: 'd', goodFor: 'g', builtIn: true },
        { id: 4, name: 'M4', description: 'd', goodFor: 'g', builtIn: true },
      ],
      model: 'model',
    });

    const [row] = await testDb
      .select()
      .from(schema.methodSelections)
      .where(eq(schema.methodSelections.sessionId, 'sess-default-sel'));

    // selected should equal recommended by default
    expect(JSON.parse(row.selected)).toEqual(JSON.parse(row.recommended));
  });

  it('emits thought events with correct agent name "Strategist"', async () => {
    await insertSession(testDb, 'sess-strat-name');
    const rec = { recommended: [1], reasoning: { '1': 'ok' } };
    mockQuery.mockReturnValueOnce(queryResult(JSON.stringify(rec)));

    await runMethodSelection({
      sessionId: 'sess-strat-name',
      coordinate: 'coord',
      methods: [{ id: 1, name: 'M', description: 'd', goodFor: 'g', builtIn: true }],
      model: 'model',
    });

    const strategistEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { agent?: string } }]) =>
        sid === 'sess-strat-name' &&
        evt.type === 'agent:thought' &&
        evt.data.agent === 'Strategist',
    );
    expect(strategistEvents.length).toBeGreaterThanOrEqual(1);
  });
});
