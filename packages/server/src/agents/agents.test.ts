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
    config: JSON.stringify({ ideasPerWorker: 15 }),
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

  it('extracts JSON with surrounding prose text', () => {
    const input = 'Here is my recommendation:\n\n{"recommended":[1,4,7],"reasoning":{"1":"reason A","4":"reason B","7":"reason C"}}\n\nI hope this helps!';
    expect(JSON.parse(extractJSON(input))).toEqual({
      recommended: [1, 4, 7],
      reasoning: { '1': 'reason A', '4': 'reason B', '7': 'reason C' },
    });
  });

  it('repairs trailing commas in JSON', () => {
    const input = '{"name":"test","items":[1,2,3,],}';
    expect(JSON.parse(extractJSON(input))).toEqual({ name: 'test', items: [1, 2, 3] });
  });

  it('handles JSON with nested braces in string values', () => {
    const input = 'Result: {"text":"value with {braces} inside","count":5} end';
    expect(JSON.parse(extractJSON(input))).toEqual({ text: 'value with {braces} inside', count: 5 });
  });

  it('extracts complex nested JSON from prose', () => {
    const input = `I've analyzed the coordinate. Here are my recommendations:

{"gates":[{"id":"g1","text":"Must be feasible"}],"criteria":[{"id":"c1","text":"Novelty","weight":3,"description":"1=old; 5=new"}],"tests":[{"id":"t1","text":"User test"}]}

Let me know if you need changes.`;
    const parsed = JSON.parse(extractJSON(input));
    expect(parsed.gates[0].id).toBe('g1');
    expect(parsed.criteria[0].weight).toBe(3);
    expect(parsed.tests[0].id).toBe('t1');
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

  it('breaks out of retry loop after MAX_RATE_LIMIT_RETRIES consecutive 429 errors', async () => {
    const rateLimitError = new Error('429 Too Many Requests');
    // Return 429 every time — should cap at 10 rate-limit retries then fail
    mockQuery.mockImplementation(() => { throw rateLimitError; });

    await expect(
      callLLMWithRetry(
        {
          model: 'claude-sonnet-4-20250514',
          system: 'sys',
          prompt: 'p',
          sessionId: 'sess-rate-cap',
          agentName: 'RateCap',
        },
        (text) => JSON.parse(text),
        2, // 2 parse retries, but rate-limit retries are separate
      ),
    ).rejects.toThrow(/Failed after/);

    // Should not loop forever — calls should be capped
    // With maxRetries=2 and MAX_RATE_LIMIT_RETRIES=10, at most ~12 total calls
    expect(mockQuery.mock.calls.length).toBeLessThanOrEqual(15);
    expect(mockQuery.mock.calls.length).toBeGreaterThan(3);
  }, 30_000);

  it('drops outputSchema and retries in text mode after process crash', async () => {
    const crashError = new Error('Claude Code process exited with code 1');
    mockQuery
      .mockImplementationOnce(() => { throw crashError; })
      .mockReturnValueOnce(queryResult('{"recommended":[1,4],"reasoning":{"1":"good","4":"also good"}}'));

    const result = await callLLMWithRetry(
      {
        model: 'claude-haiku-4-5-20251001',
        system: 'sys',
        prompt: 'p',
        outputSchema: { type: 'object', properties: { recommended: { type: 'array' } } },
        sessionId: 'sess-crash',
        agentName: 'CrashAgent',
      },
      (text) => JSON.parse(text),
      2,
    );

    expect(result).toEqual({ recommended: [1, 4], reasoning: { '1': 'good', '4': 'also good' } });
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Second call should NOT have outputFormat (structured output dropped)
    const secondCallOpts = mockQuery.mock.calls[1][0].options;
    expect(secondCallOpts.outputFormat).toBeUndefined();

    // Should emit a "text mode" retry thought
    const textModeEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { text: string } }]) =>
        sid === 'sess-crash' &&
        evt.type === 'agent:thought' &&
        evt.data.text.includes('text mode'),
    );
    expect(textModeEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('retries timeout once with 1.5x timeout before failing', async () => {
    const timeoutError1 = new Error('SlowAgent timed out after 60s. Try retrying or using a faster model (e.g. Haiku).');
    timeoutError1.name = 'AbortError';
    const timeoutError2 = new Error('SlowAgent timed out after 90s. Try retrying or using a faster model (e.g. Haiku).');
    timeoutError2.name = 'AbortError';
    mockQuery
      .mockImplementationOnce(() => { throw timeoutError1; })
      .mockImplementationOnce(() => { throw timeoutError2; });

    await expect(
      callLLMWithRetry(
        {
          model: 'claude-sonnet-4-20250514',
          system: 'sys',
          prompt: 'p',
          sessionId: 'sess-timeout',
          agentName: 'SlowAgent',
          timeoutMs: 60_000,
        },
        (text) => JSON.parse(text),
        1, // 1 retry allowed
      ),
    ).rejects.toThrow(/Failed after 2 attempts/);

    // Should have been called twice (first attempt + one retry)
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Should emit a timeout retry thought event
    const retryEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { text: string } }]) =>
        sid === 'sess-timeout' &&
        evt.type === 'agent:thought' &&
        evt.data.text.includes('Timed out after 60s'),
    );
    expect(retryEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('timeout succeeds on retry with extended timeout', async () => {
    const timeoutError = new Error('SlowAgent timed out after 60s. Try retrying or using a faster model (e.g. Haiku).');
    timeoutError.name = 'AbortError';
    mockQuery
      .mockImplementationOnce(() => { throw timeoutError; })
      .mockReturnValueOnce(queryResult('{"ok":true}'));

    const result = await callLLMWithRetry(
      {
        model: 'claude-sonnet-4-20250514',
        system: 'sys',
        prompt: 'p',
        sessionId: 'sess-timeout-ok',
        agentName: 'SlowAgent',
        timeoutMs: 60_000,
      },
      (text) => JSON.parse(text),
      1,
    );

    expect(result).toEqual({ ok: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('timeout throws immediately when no retries are allowed', async () => {
    const timeoutError = new Error('SlowAgent timed out after 1s. Try retrying or using a faster model (e.g. Haiku).');
    timeoutError.name = 'AbortError';
    mockQuery.mockImplementationOnce(() => { throw timeoutError; });

    await expect(
      callLLMWithRetry(
        {
          model: 'claude-sonnet-4-20250514',
          system: 'sys',
          prompt: 'p',
          sessionId: 'sess-timeout-0',
          agentName: 'SlowAgent',
          timeoutMs: 1000,
        },
        (text) => JSON.parse(text),
        0, // no retries
      ),
    ).rejects.toThrow(/Failed after 1 attempt/);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on 404 API error without retrying', async () => {
    const notFoundError = new Error('Claude Code process exited with code 1\nSDK stderr: error 404 Not Found');
    mockQuery.mockImplementationOnce(() => { throw notFoundError; });

    await expect(
      callLLMWithRetry(
        {
          model: 'claude-haiku-4-5-20251001',
          system: 'sys',
          prompt: 'p',
          sessionId: 'sess-404',
          agentName: 'NotFound',
        },
        (text) => JSON.parse(text),
        2,
      ),
    ).rejects.toThrow(/not found/i);

    // Should only have been called once (no retries for 4xx)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on 400 Bad Request without retrying', async () => {
    const badReqError = new Error('400 Bad Request: invalid model parameter');
    mockQuery.mockImplementationOnce(() => { throw badReqError; });

    await expect(
      callLLMWithRetry(
        {
          model: 'invalid-model',
          system: 'sys',
          prompt: 'p',
          sessionId: 'sess-400',
          agentName: 'BadReq',
        },
        (text) => JSON.parse(text),
        2,
      ),
    ).rejects.toThrow(/Bad request.*400|API error.*400/i);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('emits status:error SSE event on 404 API error', async () => {
    const notFoundError = new Error('error 404 Not Found: model not available');
    mockQuery.mockImplementationOnce(() => { throw notFoundError; });

    await callLLMWithRetry(
      {
        model: 'nonexistent-model',
        system: 'sys',
        prompt: 'p',
        sessionId: 'sess-404-sse',
        agentName: 'NotFoundSSE',
      },
      (text) => JSON.parse(text),
    ).catch(() => {});

    const errorEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string }]) =>
        sid === 'sess-404-sse' && evt.type === 'status:error',
    );
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('retries on 500 server error with backoff', async () => {
    const serverError = new Error('500 Internal Server Error');
    mockQuery
      .mockImplementationOnce(() => { throw serverError; })
      .mockReturnValueOnce(queryResult('{"ok":true}'));

    const result = await callLLMWithRetry(
      {
        model: 'claude-sonnet-4-20250514',
        system: 'sys',
        prompt: 'p',
        sessionId: 'sess-500',
        agentName: 'ServerErr',
      },
      (text) => JSON.parse(text),
    );

    expect(result).toEqual({ ok: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Should emit a server error retry thought
    const serverErrEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { text: string } }]) =>
        sid === 'sess-500' &&
        evt.type === 'agent:thought' &&
        evt.data.text.includes('API server error'),
    );
    expect(serverErrEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('retries on 529 overloaded error with backoff', async () => {
    const overloadedError = new Error('529 Overloaded');
    mockQuery
      .mockImplementationOnce(() => { throw overloadedError; })
      .mockReturnValueOnce(queryResult('{"ok":true}'));

    const result = await callLLMWithRetry(
      {
        model: 'claude-sonnet-4-20250514',
        system: 'sys',
        prompt: 'p',
        sessionId: 'sess-529',
        agentName: 'OverloadAgent',
      },
      (text) => JSON.parse(text),
    );

    expect(result).toEqual({ ok: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('detects HTTP error embedded in SDK stderr', async () => {
    // Simulates what actually happens: process exits with code 1, stderr has the real error
    const error = new Error(
      'Claude Code process exited with code 1\n' +
      'SDK stderr: Error: 404 Not Found {"type":"error","error":{"type":"not_found_error","message":"model: claude-haiku-999 is not available"}}'
    );
    mockQuery.mockImplementationOnce(() => { throw error; });

    await expect(
      callLLMWithRetry(
        {
          model: 'claude-haiku-999',
          system: 'sys',
          prompt: 'p',
          sessionId: 'sess-stderr',
          agentName: 'StderrTest',
        },
        (text) => JSON.parse(text),
        2,
      ),
    ).rejects.toThrow(/not found/i);

    // Should NOT retry — 404 is a client error
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

// ==========================================================================
// 3. Navigator – runTaxonomy (two-phase: skeleton + branch expansion)
// ==========================================================================

describe('Navigator – runTaxonomy', () => {
  let runTaxonomy: typeof import('./navigator.js')['runTaxonomy'];

  // Skeleton: top-level categories with empty children
  const skeleton = {
    name: 'Root',
    p: 'high',
    children: [
      { name: 'Category A', p: 'high', children: [] },
      { name: 'Category B', p: 'medium', children: [] },
    ],
  };

  // Expanded branches
  const expandedA = {
    name: 'Category A',
    p: 'high',
    children: [
      { name: 'Subcategory A1', p: 'medium' },
      { name: 'Subcategory A2', p: 'low' },
    ],
  };

  const expandedB = {
    name: 'Category B',
    p: 'medium',
    children: [{ name: 'Subcategory B1', p: 'high' }],
  };

  /** Mock skeleton + all branch expansions */
  function mockSkeletonAndBranches(skel = skeleton, branches = [expandedA, expandedB]) {
    mockQuery.mockReturnValueOnce(queryResult(JSON.stringify(skel)));
    for (const branch of branches) {
      mockQuery.mockReturnValueOnce(queryResult(JSON.stringify(branch)));
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = createTestDb();
    const mod = await import('./navigator.js');
    runTaxonomy = mod.runTaxonomy;
  });

  it('persists assembled taxonomy (skeleton + branches) to database', async () => {
    await insertSession(testDb, 'sess-nav');
    mockSkeletonAndBranches();

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
    // Verify branches were expanded (not empty)
    expect(stored.children[0].children).toHaveLength(2);
    expect(stored.children[0].children[0].name).toBe('Subcategory A1');
    expect(stored.children[1].children).toHaveLength(1);
    expect(stored.children[1].children[0].name).toBe('Subcategory B1');
  });

  it('validates skeleton against TaxonomyNodeSchema', async () => {
    await insertSession(testDb, 'sess-invalid-tax');
    // Missing required "p" field on skeleton
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

  it('emits progressive SSE taxonomy updates (skeleton + final)', async () => {
    await insertSession(testDb, 'sess-sse-tax');
    mockSkeletonAndBranches();

    await runTaxonomy({
      sessionId: 'sess-sse-tax',
      domain: 'test domain',
      webSearch: false,
      model: 'claude-haiku-4-20250414',
    });

    const taxonomyEvents = mockEmit.mock.calls
      .filter(
        ([sid, evt]: [string, { type: string }]) =>
          sid === 'sess-sse-tax' && evt.type === 'data:taxonomy_update',
      );

    // At least 2 taxonomy updates: skeleton + final assembled tree
    expect(taxonomyEvents.length).toBeGreaterThanOrEqual(2);

    // First update is skeleton (children with empty arrays)
    const firstTree = taxonomyEvents[0][1].data;
    expect(firstTree.children[0].children).toHaveLength(0);

    // Last update is the assembled tree (children have subcategories)
    const lastTree = taxonomyEvents[taxonomyEvents.length - 1][1].data;
    expect(lastTree.children[0].children.length).toBeGreaterThan(0);
  });

  it('makes separate LLM calls for skeleton and each branch', async () => {
    await insertSession(testDb, 'sess-calls');
    mockSkeletonAndBranches();

    await runTaxonomy({
      sessionId: 'sess-calls',
      domain: 'test domain',
      webSearch: false,
      model: 'claude-haiku-4-20250414',
    });

    // 1 skeleton call + 2 branch expansion calls = 3 total
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('succeeds when some branches fail (above 50% threshold)', async () => {
    // 4 top-level categories, 2 will fail → 50% success, should pass
    const bigSkeleton = {
      name: 'Root',
      p: 'high',
      children: [
        { name: 'Cat A', p: 'high', children: [] },
        { name: 'Cat B', p: 'medium', children: [] },
        { name: 'Cat C', p: 'low', children: [] },
        { name: 'Cat D', p: 'medium', children: [] },
      ],
    };

    await insertSession(testDb, 'sess-partial');
    mockQuery
      // Skeleton
      .mockReturnValueOnce(queryResult(JSON.stringify(bigSkeleton)))
      // Branch A succeeds
      .mockReturnValueOnce(
        queryResult(JSON.stringify({ name: 'Cat A', p: 'high', children: [{ name: 'A1', p: 'high' }] })),
      )
      // Branch B succeeds
      .mockReturnValueOnce(
        queryResult(JSON.stringify({ name: 'Cat B', p: 'medium', children: [{ name: 'B1', p: 'medium' }] })),
      )
      // Branch C fails (all retries)
      .mockReturnValue(queryResult('not valid json {{{'));

    await runTaxonomy({
      sessionId: 'sess-partial',
      domain: 'test',
      webSearch: false,
      model: 'model',
    });

    const [row] = await testDb
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, 'sess-partial'));

    const stored = JSON.parse(row.tree);
    // Cat A and B have children, C and D stayed as leaves
    expect(stored.children[0].children.length).toBeGreaterThan(0);
    expect(stored.children[1].children.length).toBeGreaterThan(0);
  });

  it('throws when too many branches fail (below 50% threshold)', async () => {
    const bigSkeleton = {
      name: 'Root',
      p: 'high',
      children: [
        { name: 'Cat A', p: 'high', children: [] },
        { name: 'Cat B', p: 'medium', children: [] },
        { name: 'Cat C', p: 'low', children: [] },
        { name: 'Cat D', p: 'medium', children: [] },
      ],
    };

    await insertSession(testDb, 'sess-all-fail');
    mockQuery
      // Skeleton succeeds
      .mockReturnValueOnce(queryResult(JSON.stringify(bigSkeleton)))
      // All branches fail
      .mockReturnValue(queryResult('not valid json {{{'));

    await expect(
      runTaxonomy({
        sessionId: 'sess-all-fail',
        domain: 'test',
        webSearch: false,
        model: 'model',
      }),
    ).rejects.toThrow(/branch expansion failed/i);
  });

  it('throws when skeleton has no top-level categories', async () => {
    await insertSession(testDb, 'sess-empty');
    const emptySkeleton = { name: 'Root', p: 'high', children: [] };
    mockQuery.mockReturnValueOnce(queryResult(JSON.stringify(emptySkeleton)));

    await expect(
      runTaxonomy({
        sessionId: 'sess-empty',
        domain: 'test',
        webSearch: false,
        model: 'model',
      }),
    ).rejects.toThrow(/no top-level categories/i);
  });

  it('emits thought events with correct agent name "Navigator"', async () => {
    await insertSession(testDb, 'sess-agent-name');
    mockSkeletonAndBranches();

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

  it('emits "Expanding branch X/Y" thought for each branch', async () => {
    await insertSession(testDb, 'sess-expand-thoughts');
    mockSkeletonAndBranches();

    await runTaxonomy({
      sessionId: 'sess-expand-thoughts',
      domain: 'test',
      webSearch: false,
      model: 'model',
    });

    const expandEvents = mockEmit.mock.calls.filter(
      ([sid, evt]: [string, { type: string; data: { text: string } }]) =>
        sid === 'sess-expand-thoughts' &&
        evt.type === 'agent:thought' &&
        /Expanding branch \d+\/\d+/.test(evt.data.text),
    );
    // One per top-level category
    expect(expandEvents).toHaveLength(2);
    expect(expandEvents[0][1].data.text).toContain('1/2');
    expect(expandEvents[1][1].data.text).toContain('2/2');
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
  });

  it('validates rubric structure against RubricSchema', async () => {
    await insertSession(testDb, 'sess-rubric-bad');
    // Missing gates
    mockQuery.mockReturnValue(
      queryResult(JSON.stringify({ criteria: [] })),
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

  it('aborts when external signal is already aborted — throws DOMException with AbortError name', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Pipeline cancelled'));

    mockQuery.mockImplementationOnce(({ options }: { options: { abortController: AbortController } }) => ({
      [Symbol.asyncIterator]: async function* () {
        // External signal should have already propagated to the internal controller
        if (options.abortController.signal.aborted) {
          const err = new Error('Request was aborted.');
          err.name = 'AbortError';
          throw err;
        }
        yield { type: 'result', result: 'should not reach here' };
      },
    }));

    try {
      await callLLM({
        model: 'model',
        system: 'sys',
        prompt: 'p',
        signal: controller.signal,
      });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.name).toBe('AbortError');
      expect(err).toBeInstanceOf(DOMException);
    }
  });

  it('aborts when external signal fires during request — throws DOMException with AbortError name', async () => {
    const controller = new AbortController();

    mockQuery.mockImplementationOnce(({ options }: { options: { abortController: AbortController } }) => ({
      [Symbol.asyncIterator]: async function* () {
        // Simulate the external abort happening during the request
        await new Promise((_resolve, reject) => {
          options.abortController.signal.addEventListener('abort', () => {
            const err = new Error('Request was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
          // Trigger external abort after a short delay
          setTimeout(() => controller.abort(new Error('Pipeline cancelled')), 10);
        });
      },
    }));

    try {
      await callLLM({
        model: 'model',
        system: 'sys',
        prompt: 'p',
        signal: controller.signal,
      });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.name).toBe('AbortError');
      expect(err).toBeInstanceOf(DOMException);
    }
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

  it('handles skeleton returned inside code block', async () => {
    await insertSession(testDb, 'sess-cb');
    const skeleton = {
      name: 'Root',
      p: 'high',
      children: [{ name: 'Cat A', p: 'high', children: [] }],
    };
    const expanded = {
      name: 'Cat A',
      p: 'high',
      children: [{ name: 'Sub A1', p: 'medium' }],
    };
    // Skeleton returned in a code block
    mockQuery
      .mockReturnValueOnce(queryResult('```json\n' + JSON.stringify(skeleton) + '\n```'))
      .mockReturnValueOnce(queryResult(JSON.stringify(expanded)));

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
    expect(JSON.parse(row.tree).children[0].children[0].name).toBe('Sub A1');
  });

  it('failed branches stay as leaf nodes in assembled tree', async () => {
    await insertSession(testDb, 'sess-leaf');
    const skeleton = {
      name: 'Root',
      p: 'high',
      children: [
        { name: 'Good', p: 'high', children: [] },
        { name: 'Bad', p: 'medium', children: [] },
      ],
    };
    const expandedGood = {
      name: 'Good',
      p: 'high',
      children: [{ name: 'G1', p: 'high' }],
    };

    mockQuery
      .mockReturnValueOnce(queryResult(JSON.stringify(skeleton)))
      .mockReturnValueOnce(queryResult(JSON.stringify(expandedGood)))
      // Bad branch fails
      .mockReturnValue(queryResult('invalid json {{'));

    await runTaxonomy({
      sessionId: 'sess-leaf',
      domain: 'test',
      webSearch: false,
      model: 'model',
    });

    const [row] = await testDb
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, 'sess-leaf'));

    const stored = JSON.parse(row.tree);
    // Good branch has children
    expect(stored.children[0].children).toHaveLength(1);
    // Bad branch stays as leaf (empty children from skeleton)
    expect(stored.children[1].children).toHaveLength(0);
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
