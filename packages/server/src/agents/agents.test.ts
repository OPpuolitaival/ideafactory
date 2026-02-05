import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/setup.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mock: @anthropic-ai/sdk
// ---------------------------------------------------------------------------
const mockCreate = vi.fn();

class MockAnthropic {
  messages = { create: mockCreate };
  constructor(_opts?: unknown) {}
}

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: MockAnthropic,
  };
});

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

/** Build the Anthropic SDK response shape returned by messages.create */
function anthropicResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
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
    // Clear the client cache so each test gets a fresh mock
    const llmModule = await import('./llm.js');
    callLLMWithRetry = llmModule.callLLMWithRetry;
  });

  it('succeeds on first attempt when parse is valid', async () => {
    mockCreate.mockResolvedValueOnce(
      anthropicResponse('{"name":"result","p":"high"}'),
    );

    const result = await callLLMWithRetry(
      {
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
        system: 'test system',
        prompt: 'test prompt',
        sessionId: 'sess-1',
        agentName: 'TestAgent',
      },
      (text) => JSON.parse(text),
    );

    expect(result).toEqual({ name: 'result', p: 'high' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries on parse failure and succeeds on second attempt', async () => {
    // First call returns bad JSON, second returns good JSON
    mockCreate
      .mockResolvedValueOnce(anthropicResponse('not json'))
      .mockResolvedValueOnce(anthropicResponse('{"ok":true}'));

    const result = await callLLMWithRetry(
      {
        apiKey: 'test-key',
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
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries are exceeded', async () => {
    mockCreate.mockResolvedValue(anthropicResponse('bad json'));

    await expect(
      callLLMWithRetry(
        {
          apiKey: 'test-key',
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

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('emits retry SSE events on parse failure', async () => {
    mockCreate
      .mockResolvedValueOnce(anthropicResponse('bad'))
      .mockResolvedValueOnce(anthropicResponse('{"ok":true}'));

    await callLLMWithRetry(
      {
        apiKey: 'test-key',
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
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify(validTaxonomy)),
    );

    await runTaxonomy({
      sessionId: 'sess-nav',
      domain: 'test domain',
      webSearch: false,
      apiKey: 'test-key',
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
    mockCreate.mockResolvedValue(
      anthropicResponse(JSON.stringify({ name: 'Root', children: [] })),
    );

    await expect(
      runTaxonomy({
        sessionId: 'sess-invalid-tax',
        domain: 'test domain',
        webSearch: false,
        apiKey: 'test-key',
        model: 'claude-haiku-4-20250414',
      }),
    ).rejects.toThrow();
  });

  it('emits SSE events for taxonomy updates', async () => {
    await insertSession(testDb, 'sess-sse-tax');
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify(validTaxonomy)),
    );

    await runTaxonomy({
      sessionId: 'sess-sse-tax',
      domain: 'test domain',
      webSearch: false,
      apiKey: 'test-key',
      model: 'claude-haiku-4-20250414',
    });

    const events = mockEmit.mock.calls
      .filter(([sid]: [string]) => sid === 'sess-sse-tax')
      .map(([, evt]: [string, { type: string }]) => evt.type);

    expect(events).toContain('agent:thought');
    expect(events).toContain('data:taxonomy_update');
  });

  it('passes correct temperature (0.7) and maxTokens (16384)', async () => {
    await insertSession(testDb, 'sess-temp-tax');
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify(validTaxonomy)),
    );

    await runTaxonomy({
      sessionId: 'sess-temp-tax',
      domain: 'test domain',
      webSearch: false,
      apiKey: 'test-key',
      model: 'claude-haiku-4-20250414',
    });

    const createCall = mockCreate.mock.calls[0][0];
    expect(createCall.temperature).toBe(0.7);
    expect(createCall.max_tokens).toBe(16384);
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
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify(validRecommendation)),
    );

    await runMethodSelection({
      sessionId: 'sess-meth',
      coordinate: 'test > coordinate',
      methods,
      apiKey: 'test-key',
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
    mockCreate.mockResolvedValue(
      anthropicResponse(JSON.stringify({ reasoning: {} })),
    );

    await expect(
      runMethodSelection({
        sessionId: 'sess-meth-bad',
        coordinate: 'coord',
        methods,
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      }),
    ).rejects.toThrow();
  });

  it('emits SSE events for method recommendations', async () => {
    await insertSession(testDb, 'sess-meth-sse');
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify(validRecommendation)),
    );

    await runMethodSelection({
      sessionId: 'sess-meth-sse',
      coordinate: 'coord',
      methods,
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const events = mockEmit.mock.calls
      .filter(([sid]: [string]) => sid === 'sess-meth-sse')
      .map(([, evt]: [string, { type: string }]) => evt.type);

    expect(events).toContain('data:methods_recommended');
    expect(events).toContain('agent:thought');
  });

  it('passes correct temperature (0.6) and maxTokens (4096)', async () => {
    await insertSession(testDb, 'sess-meth-temp');
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify(validRecommendation)),
    );

    await runMethodSelection({
      sessionId: 'sess-meth-temp',
      coordinate: 'coord',
      methods,
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const createCall = mockCreate.mock.calls[0][0];
    expect(createCall.temperature).toBe(0.6);
    expect(createCall.max_tokens).toBe(4096);
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
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify(validRubric)),
    );

    await runRubricDesign({
      sessionId: 'sess-rubric',
      coordinate: 'test > coordinate',
      domain: 'test domain',
      methods,
      apiKey: 'test-key',
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
    mockCreate.mockResolvedValue(
      anthropicResponse(JSON.stringify({ criteria: [], tests: [] })),
    );

    await expect(
      runRubricDesign({
        sessionId: 'sess-rubric-bad',
        coordinate: 'coord',
        domain: 'domain',
        methods,
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      }),
    ).rejects.toThrow();
  });

  it('emits SSE events for rubric generation', async () => {
    await insertSession(testDb, 'sess-rubric-sse');
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify(validRubric)),
    );

    await runRubricDesign({
      sessionId: 'sess-rubric-sse',
      coordinate: 'coord',
      domain: 'domain',
      methods,
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const events = mockEmit.mock.calls
      .filter(([sid]: [string]) => sid === 'sess-rubric-sse')
      .map(([, evt]: [string, { type: string }]) => evt.type);

    expect(events).toContain('data:rubric_generated');
    expect(events).toContain('agent:thought');
  });

  it('passes correct temperature (0.6) and maxTokens (4096)', async () => {
    await insertSession(testDb, 'sess-rubric-temp');
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify(validRubric)),
    );

    await runRubricDesign({
      sessionId: 'sess-rubric-temp',
      coordinate: 'coord',
      domain: 'domain',
      methods,
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const createCall = mockCreate.mock.calls[0][0];
    expect(createCall.temperature).toBe(0.6);
    expect(createCall.max_tokens).toBe(4096);
  });

  it('rubric criteria weights are within valid range (1-5)', async () => {
    await insertSession(testDb, 'sess-rubric-weight');
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify(validRubric)),
    );

    await runRubricDesign({
      sessionId: 'sess-rubric-weight',
      coordinate: 'coord',
      domain: 'domain',
      methods,
      apiKey: 'test-key',
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
// 6. Temperature verification per agent
// ==========================================================================

describe('Temperature verification per agent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
  });

  it('Navigator uses temperature 0.7', async () => {
    const { runTaxonomy } = await import('./navigator.js');
    await insertSession(testDb, 'sess-t-nav');

    const taxonomy = { name: 'Root', p: 'high', children: [] };
    mockCreate.mockResolvedValueOnce(anthropicResponse(JSON.stringify(taxonomy)));

    await runTaxonomy({
      sessionId: 'sess-t-nav',
      domain: 'test',
      webSearch: false,
      apiKey: 'key',
      model: 'model',
    });

    expect(mockCreate.mock.calls[0][0].temperature).toBe(0.7);
  });

  it('Strategist method selection uses temperature 0.6', async () => {
    const { runMethodSelection } = await import('./strategist.js');
    await insertSession(testDb, 'sess-t-ms');

    const rec = { recommended: [1], reasoning: { '1': 'Good' } };
    mockCreate.mockResolvedValueOnce(anthropicResponse(JSON.stringify(rec)));

    await runMethodSelection({
      sessionId: 'sess-t-ms',
      coordinate: 'coord',
      methods: [{ id: 1, name: 'M', description: 'd', goodFor: 'g', builtIn: true }],
      apiKey: 'key',
      model: 'model',
    });

    expect(mockCreate.mock.calls[0][0].temperature).toBe(0.6);
  });

  it('Strategist rubric design uses temperature 0.6', async () => {
    const { runRubricDesign } = await import('./strategist.js');
    await insertSession(testDb, 'sess-t-rd');

    const rubric = {
      gates: [{ id: 'g1', text: 'Gate' }],
      criteria: [{ id: 'c1', text: 'C', weight: 3, description: 'd' }],
      tests: [{ id: 't1', text: 'T' }],
    };
    mockCreate.mockResolvedValueOnce(anthropicResponse(JSON.stringify(rubric)));

    await runRubricDesign({
      sessionId: 'sess-t-rd',
      coordinate: 'coord',
      domain: 'domain',
      methods: [{ id: 1, name: 'M', description: 'd', goodFor: 'g', builtIn: true }],
      apiKey: 'key',
      model: 'model',
    });

    expect(mockCreate.mock.calls[0][0].temperature).toBe(0.6);
  });

  it('callLLM default temperature is 0.7 when not specified', async () => {
    const { callLLM } = await import('./llm.js');

    mockCreate.mockResolvedValueOnce(anthropicResponse('hello'));

    await callLLM({
      apiKey: 'key',
      model: 'model',
      system: 'sys',
      prompt: 'prompt',
    });

    expect(mockCreate.mock.calls[0][0].temperature).toBe(0.7);
  });
});

// ==========================================================================
// 7. maxTokens verification per agent
// ==========================================================================

describe('maxTokens verification per agent', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
  });

  it('Navigator taxonomy uses maxTokens 16384', async () => {
    const { runTaxonomy } = await import('./navigator.js');
    await insertSession(testDb, 'sess-mt-nav');

    const taxonomy = { name: 'Root', p: 'high', children: [] };
    mockCreate.mockResolvedValueOnce(anthropicResponse(JSON.stringify(taxonomy)));

    await runTaxonomy({
      sessionId: 'sess-mt-nav',
      domain: 'test',
      webSearch: false,
      apiKey: 'key',
      model: 'model',
    });

    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(16384);
  });

  it('Strategist method selection uses maxTokens 4096', async () => {
    const { runMethodSelection } = await import('./strategist.js');
    await insertSession(testDb, 'sess-mt-ms');

    const rec = { recommended: [1], reasoning: { '1': 'Good' } };
    mockCreate.mockResolvedValueOnce(anthropicResponse(JSON.stringify(rec)));

    await runMethodSelection({
      sessionId: 'sess-mt-ms',
      coordinate: 'coord',
      methods: [{ id: 1, name: 'M', description: 'd', goodFor: 'g', builtIn: true }],
      apiKey: 'key',
      model: 'model',
    });

    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(4096);
  });

  it('Strategist rubric design uses maxTokens 4096', async () => {
    const { runRubricDesign } = await import('./strategist.js');
    await insertSession(testDb, 'sess-mt-rd');

    const rubric = {
      gates: [{ id: 'g1', text: 'Gate' }],
      criteria: [{ id: 'c1', text: 'C', weight: 3, description: 'd' }],
      tests: [{ id: 't1', text: 'T' }],
    };
    mockCreate.mockResolvedValueOnce(anthropicResponse(JSON.stringify(rubric)));

    await runRubricDesign({
      sessionId: 'sess-mt-rd',
      coordinate: 'coord',
      domain: 'domain',
      methods: [{ id: 1, name: 'M', description: 'd', goodFor: 'g', builtIn: true }],
      apiKey: 'key',
      model: 'model',
    });

    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(4096);
  });

  it('callLLM default maxTokens is 8192 when not specified', async () => {
    const { callLLM } = await import('./llm.js');

    mockCreate.mockResolvedValueOnce(anthropicResponse('hello'));

    await callLLM({
      apiKey: 'key',
      model: 'model',
      system: 'sys',
      prompt: 'prompt',
    });

    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(8192);
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
    mockCreate.mockResolvedValueOnce(anthropicResponse('hello world'));

    const result = await callLLM({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
      system: 'system',
      prompt: 'say hello',
    });

    expect(result).toBe('hello world');
  });

  it('emits agent:thought SSE when sessionId and agentName provided', async () => {
    mockCreate.mockResolvedValueOnce(anthropicResponse('response'));

    await callLLM({
      apiKey: 'test-key',
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
    mockCreate.mockResolvedValueOnce(anthropicResponse('response'));

    await callLLM({
      apiKey: 'test-key',
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

  it('concatenates multiple text blocks', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'part1' },
        { type: 'text', text: 'part2' },
      ],
      stop_reason: 'end_turn',
    });

    const result = await callLLM({
      apiKey: 'key',
      model: 'model',
      system: 'sys',
      prompt: 'p',
    });

    expect(result).toBe('part1\npart2');
  });

  it('passes model, system, temperature, max_tokens to Anthropic SDK', async () => {
    mockCreate.mockResolvedValueOnce(anthropicResponse('ok'));

    await callLLM({
      apiKey: 'test-key',
      model: 'my-model',
      system: 'my-system',
      prompt: 'my-prompt',
      temperature: 0.42,
      maxTokens: 1234,
    });

    const args = mockCreate.mock.calls[0][0];
    expect(args.model).toBe('my-model');
    expect(args.system).toBe('my-system');
    expect(args.temperature).toBe(0.42);
    expect(args.max_tokens).toBe(1234);
    expect(args.messages).toEqual([{ role: 'user', content: 'my-prompt' }]);
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
    mockCreate.mockResolvedValueOnce(
      anthropicResponse('```json\n' + JSON.stringify(taxonomy) + '\n```'),
    );

    await runTaxonomy({
      sessionId: 'sess-cb',
      domain: 'test',
      webSearch: false,
      apiKey: 'key',
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
    mockCreate.mockResolvedValueOnce(anthropicResponse(JSON.stringify(taxonomy)));

    await runTaxonomy({
      sessionId: 'sess-agent-name',
      domain: 'test',
      webSearch: false,
      apiKey: 'key',
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
    mockCreate.mockResolvedValueOnce(anthropicResponse(JSON.stringify(rec)));

    await runMethodSelection({
      sessionId: 'sess-default-sel',
      coordinate: 'coord',
      methods: [
        { id: 2, name: 'M2', description: 'd', goodFor: 'g', builtIn: true },
        { id: 4, name: 'M4', description: 'd', goodFor: 'g', builtIn: true },
      ],
      apiKey: 'key',
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
    mockCreate.mockResolvedValueOnce(anthropicResponse(JSON.stringify(rec)));

    await runMethodSelection({
      sessionId: 'sess-strat-name',
      coordinate: 'coord',
      methods: [{ id: 1, name: 'M', description: 'd', goodFor: 'g', builtIn: true }],
      apiKey: 'key',
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
