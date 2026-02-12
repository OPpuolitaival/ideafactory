import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/setup.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let testDb: TestDb;

vi.mock('../db/index.js', async () => {
  const actual = await vi.importActual<typeof import('../db/schema.js')>('../db/schema.js');
  return { getDb: () => testDb, schema: actual };
});

const mockRunPipeline = vi.fn().mockResolvedValue(undefined);
vi.mock('../agents/pipeline.js', () => ({
  runPipeline: (...args: unknown[]) => mockRunPipeline(...args),
}));

const mockEmit = vi.fn();
const mockSubscribe = vi.fn();
vi.mock('../sse/index.js', () => ({
  sseManager: {
    emit: (...args: unknown[]) => mockEmit(...args),
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
    hasListeners: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('../config/index.js', () => ({
  loadConfig: () => ({
    defaults: { ideasPerWorker: 15, webSearch: false },
    models: { default: 'model', navigator: 'model', strategist: 'model', worker: 'model', analyst: 'model' },
    server: { port: 3000 },
  }),
  getAllMethods: () => [
    { id: 1, name: 'First Principles', description: 'd', goodFor: 'g', builtIn: true },
  ],
}));

let nanoidCounter = 0;
vi.mock('nanoid', () => ({
  nanoid: () => `test-id-${++nanoidCounter}`,
}));

// Mock the server import so that cmdServer does not actually start a server
vi.mock('../index.js', () => ({}));

import { runCommand } from './commands.js';

// ---------------------------------------------------------------------------
// Console & process.exit capture
// ---------------------------------------------------------------------------

let consoleOutput: string[] = [];
let consoleErrors: string[] = [];
const originalLog = console.log;
const originalError = console.error;

const _mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit');
}) as never);

beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
  console.log = (...args: unknown[]) => consoleOutput.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => consoleErrors.push(args.map(String).join(' '));
  vi.clearAllMocks();
  testDb = createTestDb();
  nanoidCounter = 0;
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a minimal session into the test database. */
async function seedSession(overrides: Partial<{
  id: string;
  domain: string;
  coordinate: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  config: string;
}> = {}) {
  const now = Date.now();
  const defaults = {
    id: 'sess-1',
    domain: 'Energy Storage',
    coordinate: null,
    status: 'taxonomy',
    createdAt: now,
    updatedAt: now,
    config: JSON.stringify({ ideasPerWorker: 15, webSearch: false }),
  };
  await testDb.insert(schema.sessions).values({ ...defaults, ...overrides });
}

/** Insert a completed session with ideas (used by export tests). */
async function seedCompletedSession() {
  await testDb.insert(schema.sessions).values({
    id: 'export-sess',
    domain: 'Test',
    coordinate: 'Test > A',
    status: 'completed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    config: '{}',
  });
  await testDb.insert(schema.ideas).values({
    id: 'idea-export-1',
    sessionId: 'export-sess',
    name: 'C1',
    description: 'D',
    phase: 'converge',
    score: 20,
  });
}

// ===========================================================================
// Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// Help / unknown command
// ---------------------------------------------------------------------------

describe('help & unknown commands', () => {
  it('prints help when no command is provided', async () => {
    await runCommand(undefined, []);

    const full = consoleOutput.join('\n');
    expect(full).toContain('ideafactory');
    expect(full).toContain('Commands:');
    expect(full).toContain('run');
    expect(full).toContain('sessions');
    expect(full).toContain('export');
  });

  it('prints help with --help flag', async () => {
    await runCommand('--help', []);

    const full = consoleOutput.join('\n');
    expect(full).toContain('Commands:');
  });

  it('exits with error for unknown command', async () => {
    await expect(runCommand('bogus', [])).rejects.toThrow('process.exit');
    expect(consoleErrors.some((e) => e.includes('Unknown command: bogus'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cmdRun
// ---------------------------------------------------------------------------

describe('cmdRun', () => {
  it('creates a session in the DB with the correct domain', async () => {
    await runCommand('run', ['--domain', 'Quantum Computing']);

    const sessions = await testDb.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].domain).toBe('Quantum Computing');
    expect(sessions[0].status).toBe('taxonomy');
    expect(sessions[0].id).toBe('test-id-1');
  });

  it('calls runPipeline with taxonomy for the first stage', async () => {
    await runCommand('run', ['--domain', 'Robotics']);

    expect(mockRunPipeline).toHaveBeenCalledWith('test-id-1', 'taxonomy');
  });

  it('advances through methods stage when --coordinate is provided', async () => {
    // After taxonomy, the command should update the session and run methods
    await runCommand('run', ['--domain', 'AI', '--coordinate', 'AI > Ethics']);

    // taxonomy + methods = 2 calls
    expect(mockRunPipeline).toHaveBeenCalledTimes(2);
    expect(mockRunPipeline).toHaveBeenNthCalledWith(1, 'test-id-1', 'taxonomy');
    expect(mockRunPipeline).toHaveBeenNthCalledWith(2, 'test-id-1', 'methods');

    // Session should be updated with the coordinate
    const [session] = await testDb.select().from(schema.sessions);
    expect(session.coordinate).toBe('AI > Ethics');
  });

  it('stops after taxonomy when --stop-at taxonomy is specified', async () => {
    await runCommand('run', ['--domain', 'Space', '--stop-at', 'taxonomy']);

    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunPipeline).toHaveBeenCalledWith('test-id-1', 'taxonomy');
  });

  it('outputs JSON when --output json is used with --stop-at', async () => {
    await runCommand('run', ['--domain', 'Space', '--stop-at', 'taxonomy', '--output', 'json']);

    // The JSON output of the session should have been logged
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    const jsonLines = consoleOutput.filter((line) => {
      try { JSON.parse(line); return true; } catch { return false; }
    });
    expect(jsonLines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(jsonLines[0]);
    expect(parsed.id).toBe('test-id-1');
    expect(parsed.domain).toBe('Space');
  });

  it('exits with error when --domain is not supplied', async () => {
    await expect(runCommand('run', [])).rejects.toThrow('process.exit');
    expect(consoleErrors.some((e) => e.includes('--domain is required'))).toBe(true);
  });

  it('runs full pipeline with --coordinate, --methods, and --auto-accept-rubric', async () => {
    await runCommand('run', [
      '--domain', 'Biotech',
      '--coordinate', 'Biotech > Gene Therapy',
      '--methods', '1',
      '--auto-accept-rubric',
    ]);

    // taxonomy, methods, rubric, factory = 4 calls (no output stage)
    expect(mockRunPipeline).toHaveBeenCalledTimes(4);
    expect(mockRunPipeline).toHaveBeenNthCalledWith(1, 'test-id-1', 'taxonomy');
    expect(mockRunPipeline).toHaveBeenNthCalledWith(2, 'test-id-1', 'methods');
    expect(mockRunPipeline).toHaveBeenNthCalledWith(3, 'test-id-1', 'rubric');
    expect(mockRunPipeline).toHaveBeenNthCalledWith(4, 'test-id-1', 'factory');
  });

  it('subscribes to SSE events for text output mode', async () => {
    await runCommand('run', ['--domain', 'Chemistry']);

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledWith('test-id-1', expect.any(Function));
  });

  it('does not subscribe to SSE events in json output mode', async () => {
    await runCommand('run', ['--domain', 'Chemistry', '--output', 'json', '--stop-at', 'taxonomy']);

    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cmdSessions
// ---------------------------------------------------------------------------

describe('cmdSessions', () => {
  it('lists sessions in text format', async () => {
    await seedSession({ id: 'sess-a', domain: 'Alpha' });
    await seedSession({ id: 'sess-b', domain: 'Beta', status: 'completed' });

    await runCommand('sessions', ['list']);

    const full = consoleOutput.join('\n');
    expect(full).toContain('sess-a');
    expect(full).toContain('Alpha');
    expect(full).toContain('sess-b');
    expect(full).toContain('Beta');
  });

  it('lists sessions in JSON format', async () => {
    await seedSession({ id: 'sess-a', domain: 'Alpha' });

    await runCommand('sessions', ['list', '--output', 'json']);

    const parsed = JSON.parse(consoleOutput.join(''));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe('sess-a');
  });

  it('shows "No sessions found." when list is empty', async () => {
    await runCommand('sessions', ['list']);
    expect(consoleOutput.some((l) => l.includes('No sessions found.'))).toBe(true);
  });

  it('gets a session by ID with JSON output (default)', async () => {
    await seedSession({ id: 'sess-get', domain: 'Gamma' });

    await runCommand('sessions', ['get', 'sess-get']);

    const parsed = JSON.parse(consoleOutput.join(''));
    expect(parsed.id).toBe('sess-get');
    expect(parsed.domain).toBe('Gamma');
    expect(parsed.taxonomy).toBeNull();
    expect(parsed.ideas).toEqual([]);
  });

  it('gets a session by ID with text output', async () => {
    await seedSession({ id: 'sess-text', domain: 'Delta', coordinate: 'Delta > Sub' });

    await runCommand('sessions', ['get', 'sess-text', '--output', 'text']);

    const full = consoleOutput.join('\n');
    expect(full).toContain('Session: sess-text');
    expect(full).toContain('Domain: Delta');
    expect(full).toContain('Coordinate: Delta > Sub');
  });

  it('exits with error when get is called without an ID', async () => {
    await expect(runCommand('sessions', ['get'])).rejects.toThrow('process.exit');
    expect(consoleErrors.some((e) => e.includes('Usage: sessions get <id>'))).toBe(true);
  });

  it('deletes a session by ID', async () => {
    await seedSession({ id: 'sess-del', domain: 'ToDelete' });

    await runCommand('sessions', ['delete', 'sess-del']);

    expect(consoleOutput.some((l) => l.includes('Deleted session: sess-del'))).toBe(true);
    const remaining = await testDb.select().from(schema.sessions);
    expect(remaining).toHaveLength(0);
  });

  it('copies a session', async () => {
    await seedSession({ id: 'sess-orig', domain: 'Original', status: 'methods' });

    await runCommand('sessions', ['copy', 'sess-orig']);

    expect(consoleOutput.some((l) => l.includes('Duplicated session: test-id-1'))).toBe(true);

    const sessions = await testDb.select().from(schema.sessions);
    expect(sessions).toHaveLength(2);
    const copy = sessions.find((s) => s.id === 'test-id-1');
    expect(copy).toBeDefined();
    expect(copy!.domain).toBe('Original');
    expect(copy!.status).toBe('methods');
  });

  it('copies a session with --output json', async () => {
    await seedSession({ id: 'sess-orig-json', domain: 'CopyJSON' });

    await runCommand('sessions', ['copy', 'sess-orig-json', '--output', 'json']);

    const parsed = JSON.parse(consoleOutput.join(''));
    expect(parsed.sessionId).toBe('test-id-1');
  });

  it('rolls back a session to a specified stage', async () => {
    await seedSession({ id: 'sess-rb', domain: 'Rollback', status: 'factory' });
    await testDb.insert(schema.taxonomyTrees).values({
      sessionId: 'sess-rb',
      tree: '{"label":"root"}',
      selectedPath: '["Rollback","Sub"]',
    });
    await testDb.insert(schema.methodSelections).values({
      sessionId: 'sess-rb',
      recommended: '[1]',
      reasoning: '{"1":"good"}',
      selected: '[1]',
    });
    await testDb.insert(schema.rubrics).values({
      sessionId: 'sess-rb',
      rubric: '{"criteria":[]}',
    });
    await testDb.insert(schema.ideas).values({
      id: 'idea-1',
      sessionId: 'sess-rb',
      name: 'Idea A',
      description: 'desc',
      phase: 'diverge',
    });

    await runCommand('sessions', ['rollback', 'sess-rb', '--to', 'methods']);

    expect(consoleOutput.some((l) => l.includes('Rolled back session sess-rb to methods'))).toBe(true);

    // Session status should be updated
    const [session] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, 'sess-rb'));
    expect(session.status).toBe('methods');

    // Method selections should be deleted (at or after 'methods' stage)
    const methods = await testDb.select().from(schema.methodSelections).where(eq(schema.methodSelections.sessionId, 'sess-rb'));
    expect(methods).toHaveLength(0);

    // Rubrics, ideas should also be deleted
    const rubrics = await testDb.select().from(schema.rubrics).where(eq(schema.rubrics.sessionId, 'sess-rb'));
    expect(rubrics).toHaveLength(0);
    const ideas = await testDb.select().from(schema.ideas).where(eq(schema.ideas.sessionId, 'sess-rb'));
    expect(ideas).toHaveLength(0);
  });

  it('exits with error for unknown sessions subcommand', async () => {
    await expect(runCommand('sessions', ['bogus'])).rejects.toThrow('process.exit');
    expect(consoleErrors.some((e) => e.includes('Usage: sessions [list|get|copy|delete|rollback]'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cmdStage
// ---------------------------------------------------------------------------

describe('cmdStage', () => {
  it('creates a temp session and runs taxonomy stage', async () => {
    // After runPipeline, the test needs a taxonomy tree in the DB for output
    mockRunPipeline.mockImplementation(async (sessionId: string) => {
      await testDb.insert(schema.taxonomyTrees).values({
        sessionId,
        tree: '{"label":"root","children":[]}',
      });
    });

    await runCommand('stage', ['taxonomy', '--domain', 'Renewable Energy', '--output', 'json']);

    expect(mockRunPipeline).toHaveBeenCalledWith('test-id-1', 'taxonomy');

    // Verify session was created
    const sessions = await testDb.select().from(schema.sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].domain).toBe('Renewable Energy');

    // Verify taxonomy tree was output
    const full = consoleOutput.join('\n');
    expect(full).toContain('root');
  });

  it('prints text description when output is not json', async () => {
    mockRunPipeline.mockImplementation(async (sessionId: string) => {
      await testDb.insert(schema.taxonomyTrees).values({
        sessionId,
        tree: '{"label":"root"}',
      });
    });

    await runCommand('stage', ['taxonomy', '--domain', 'Solar', '--output', 'text']);

    const full = consoleOutput.join('\n');
    expect(full).toContain('Taxonomy for "Solar" generated.');
  });

  it('exits with error for unknown stage name', async () => {
    await expect(runCommand('stage', ['unknown-stage'])).rejects.toThrow('process.exit');
    expect(consoleErrors.some((e) => e.includes('not yet implemented'))).toBe(true);
  });

  it('exits with error when --domain is missing for taxonomy stage', async () => {
    await expect(runCommand('stage', ['taxonomy'])).rejects.toThrow('process.exit');
    expect(consoleErrors.some((e) => e.includes('--domain required'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cmdExport
// ---------------------------------------------------------------------------

describe('cmdExport', () => {
  it('exports session as JSON', async () => {
    await seedCompletedSession();

    await runCommand('export', ['export-sess', '--format', 'json']);

    const parsed = JSON.parse(consoleOutput.join(''));
    expect(parsed.id).toBe('export-sess');
    expect(parsed.domain).toBe('Test');
    expect(parsed.ideas).toHaveLength(1);
    expect(parsed.ideas[0].name).toBe('C1');
  });

  it('defaults to JSON format when --format is not specified', async () => {
    await seedCompletedSession();

    await runCommand('export', ['export-sess']);

    const parsed = JSON.parse(consoleOutput.join(''));
    expect(parsed.id).toBe('export-sess');
    expect(parsed.ideas).toBeDefined();
  });

  it('exits with error when session ID is not provided', async () => {
    await expect(runCommand('export', [])).rejects.toThrow('process.exit');
    expect(consoleErrors.some((e) => e.includes('Usage: export <session-id>'))).toBe(true);
  });

  it('throws error for non-existent session', async () => {
    await expect(runCommand('export', ['nonexistent', '--format', 'json'])).rejects.toThrow('Session not found');
  });
});

// ---------------------------------------------------------------------------
// cmdConfig
// ---------------------------------------------------------------------------

describe('cmdConfig', () => {
  it('shows config as JSON', async () => {
    await runCommand('config', ['show']);

    const parsed = JSON.parse(consoleOutput.join(''));
    expect(parsed.defaults).toEqual({ ideasPerWorker: 15, webSearch: false });
    expect(parsed.models).toBeDefined();
    expect(parsed.server).toEqual({ port: 3000 });
  });

  it('prints message for unsupported config keys', async () => {
    await runCommand('config', ['set', 'timeout', '30']);

    expect(consoleErrors.some((e) => e.includes('not yet implemented'))).toBe(true);
  });

  it('exits with error when config set is missing key/value', async () => {
    await expect(runCommand('config', ['set'])).rejects.toThrow('process.exit');
    expect(consoleErrors.some((e) => e.includes('Usage: config set <key> <value>'))).toBe(true);
  });

  it('exits with error for unknown config subcommand', async () => {
    await expect(runCommand('config', ['bogus'])).rejects.toThrow('process.exit');
    expect(consoleErrors.some((e) => e.includes('Usage: config [show|set]'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cmdServer
// ---------------------------------------------------------------------------

describe('cmdServer', () => {
  it('imports the server module without errors', async () => {
    // The mock for ../index.js just exports an empty object,
    // so this verifies the command delegates to the import.
    await expect(runCommand('server', [])).resolves.toBeUndefined();
  });
});
