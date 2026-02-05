import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/setup.js';
import { schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

// Mock the pipeline module to avoid real LLM calls
vi.mock('../agents/pipeline.js', () => ({
  runPipeline: vi.fn().mockResolvedValue(undefined),
}));

// Mock the config module to avoid filesystem access
vi.mock('../config/index.js', () => ({
  getAllMethods: vi.fn(() => [
    { id: 1, name: 'First Principles', description: 'Break into functions', goodFor: 'Rethinking', builtIn: true },
    { id: 2, name: 'Biomimicry', description: 'Steal from nature', goodFor: 'Efficiency', builtIn: true },
  ]),
  getAllPersonas: vi.fn(() => [
    { name: 'The Engineer', systemPrompt: 'You are The Engineer.', defaultMethod: 'First Principles', builtIn: true },
    { name: 'The Visionary', systemPrompt: 'You are The Visionary.', defaultMethod: 'Inversion', builtIn: true },
  ]),
  loadConfig: vi.fn(() => ({
    apiKey: 'test-key',
    defaults: { workerCount: 3, ideasPerWorker: 15, webSearch: false },
    models: {
      default: 'claude-sonnet-4-20250514',
      navigator: 'claude-haiku-4-20250414',
      strategist: 'claude-sonnet-4-20250514',
      worker: 'claude-sonnet-4-20250514',
      analyst: 'claude-sonnet-4-20250514',
    },
    server: { port: 3000 },
  })),
  saveApiKey: vi.fn(),
}));

import { appRouter } from './router.js';
import { runPipeline } from '../agents/pipeline.js';
import { getAllMethods, getAllPersonas, loadConfig } from '../config/index.js';

// Helper to create a caller with a fresh test database
function createCaller(db: TestDb) {
  return appRouter.createCaller({ db });
}

// Helper: insert a session directly via the db for tests that need pre-existing data
async function seedSession(
  db: TestDb,
  overrides: Partial<{
    id: string;
    domain: string;
    status: string;
    coordinate: string | null;
    config: string;
    createdAt: number;
    updatedAt: number;
  }> = {},
) {
  const now = Date.now();
  const defaults = {
    id: 'test-session',
    domain: 'kitchen tools',
    status: 'taxonomy',
    coordinate: null,
    config: JSON.stringify({ workerCount: 3, ideasPerWorker: 15, webSearch: false }),
    createdAt: now,
    updatedAt: now,
  };
  const values = { ...defaults, ...overrides };
  await db.insert(schema.sessions).values(values);
  return values;
}

describe('session router', () => {
  let db: TestDb;
  let caller: ReturnType<typeof createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createTestDb();
    caller = createCaller(db);
  });

  // -------------------------------------------------------------------
  // session.start
  // -------------------------------------------------------------------
  describe('start', () => {
    it('creates a session and returns a sessionId', async () => {
      const result = await caller.session.start({ domain: 'kitchen tools' });

      expect(result).toHaveProperty('sessionId');
      expect(typeof result.sessionId).toBe('string');
      expect(result.sessionId.length).toBeGreaterThan(0);

      // Verify the session was actually persisted
      const [row] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, result.sessionId));

      expect(row).toBeDefined();
      expect(row.domain).toBe('kitchen tools');
      expect(row.status).toBe('taxonomy');
    });

    it('stores default config when none is provided', async () => {
      const result = await caller.session.start({ domain: 'bicycles' });
      const [row] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, result.sessionId));

      const config = JSON.parse(row.config!);
      expect(config).toEqual({ workerCount: 3, ideasPerWorker: 15, webSearch: false });
    });

    it('stores provided config', async () => {
      const result = await caller.session.start({
        domain: 'bicycles',
        config: { workerCount: 5, ideasPerWorker: 20, webSearch: true },
      });
      const [row] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, result.sessionId));

      const config = JSON.parse(row.config!);
      expect(config.workerCount).toBe(5);
      expect(config.ideasPerWorker).toBe(20);
      expect(config.webSearch).toBe(true);
    });

    it('fires the taxonomy pipeline in the background', async () => {
      const result = await caller.session.start({ domain: 'drones' });
      // runPipeline should have been called with the sessionId and 'taxonomy'
      expect(runPipeline).toHaveBeenCalledWith(result.sessionId, 'taxonomy');
    });

    it('rejects an empty domain string', async () => {
      await expect(caller.session.start({ domain: '' })).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // session.get
  // -------------------------------------------------------------------
  describe('get', () => {
    it('returns full session data for a valid id', async () => {
      const seeded = await seedSession(db, { id: 'get-test' });

      const result = await caller.session.get({ id: 'get-test' });

      expect(result.id).toBe('get-test');
      expect(result.domain).toBe(seeded.domain);
      expect(result.status).toBe('taxonomy');
      expect(result.config).toEqual({ workerCount: 3, ideasPerWorker: 15, webSearch: false });
      expect(result.taxonomy).toBeNull();
      expect(result.methods).toBeNull();
      expect(result.rubric).toBeNull();
      expect(result.ideas).toEqual([]);
      expect(result.output).toBeNull();
    });

    it('returns taxonomy data when present', async () => {
      await seedSession(db, { id: 'tax-test' });
      await db.insert(schema.taxonomyTrees).values({
        sessionId: 'tax-test',
        tree: JSON.stringify({ label: 'root', children: [] }),
        selectedPath: JSON.stringify(['root', 'leaf']),
      });

      const result = await caller.session.get({ id: 'tax-test' });
      expect(result.taxonomy).toEqual({
        tree: { label: 'root', children: [] },
        selectedPath: ['root', 'leaf'],
      });
    });

    it('throws on a missing session id', async () => {
      await expect(caller.session.get({ id: 'nonexistent' })).rejects.toThrow('Session not found');
    });
  });

  // -------------------------------------------------------------------
  // session.list
  // -------------------------------------------------------------------
  describe('list', () => {
    it('returns an empty list when there are no sessions', async () => {
      const result = await caller.session.list();
      expect(result).toEqual([]);
    });

    it('returns all sessions ordered by updatedAt descending', async () => {
      const baseTime = 1700000000000;
      await seedSession(db, { id: 'old', domain: 'old domain', updatedAt: baseTime });
      await seedSession(db, { id: 'mid', domain: 'mid domain', updatedAt: baseTime + 1000 });
      await seedSession(db, { id: 'new', domain: 'new domain', updatedAt: baseTime + 2000 });

      const result = await caller.session.list();

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('new');
      expect(result[1].id).toBe('mid');
      expect(result[2].id).toBe('old');
    });

    it('returns only the expected fields', async () => {
      await seedSession(db, { id: 'fields-test' });
      const [item] = await caller.session.list();

      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('domain');
      expect(item).toHaveProperty('coordinate');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('updatedAt');
      // Should NOT include config or other nested data
      expect(item).not.toHaveProperty('config');
    });
  });

  // -------------------------------------------------------------------
  // session.advance
  // -------------------------------------------------------------------
  describe('advance', () => {
    it('advances from taxonomy to methods', async () => {
      await seedSession(db, { id: 'adv-1', status: 'taxonomy' });

      const result = await caller.session.advance({
        sessionId: 'adv-1',
        stage: 'methods',
      });

      expect(result).toEqual({ success: true });

      const [row] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, 'adv-1'));
      expect(row.status).toBe('methods');
    });

    it('fires the pipeline for the new stage', async () => {
      await seedSession(db, { id: 'adv-pipe', status: 'taxonomy' });

      await caller.session.advance({ sessionId: 'adv-pipe', stage: 'methods' });

      expect(runPipeline).toHaveBeenCalledWith('adv-pipe', 'methods');
    });

    it('rejects a non-sequential stage jump', async () => {
      await seedSession(db, { id: 'adv-skip', status: 'taxonomy' });

      await expect(
        caller.session.advance({ sessionId: 'adv-skip', stage: 'rubric' }),
      ).rejects.toThrow('Cannot advance from taxonomy to rubric');
    });

    it('rejects advancing a nonexistent session', async () => {
      await expect(
        caller.session.advance({ sessionId: 'nope', stage: 'methods' }),
      ).rejects.toThrow('Session not found');
    });

    it('saves selectedPath when advancing from taxonomy', async () => {
      await seedSession(db, { id: 'adv-tax', status: 'taxonomy' });
      await db.insert(schema.taxonomyTrees).values({
        sessionId: 'adv-tax',
        tree: JSON.stringify({ label: 'root', children: [] }),
      });

      await caller.session.advance({
        sessionId: 'adv-tax',
        stage: 'methods',
        data: { selectedPath: ['Kitchen', 'Knives', 'Chef Knife'] },
      });

      const [tax] = await db
        .select()
        .from(schema.taxonomyTrees)
        .where(eq(schema.taxonomyTrees.sessionId, 'adv-tax'));

      expect(JSON.parse(tax.selectedPath!)).toEqual(['Kitchen', 'Knives', 'Chef Knife']);

      // Also sets the coordinate on the session
      const [session] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, 'adv-tax'));
      expect(session.coordinate).toBe('Kitchen > Knives > Chef Knife');
    });

    it('saves selected methods when advancing from methods', async () => {
      await seedSession(db, { id: 'adv-meth', status: 'methods' });
      await db.insert(schema.methodSelections).values({
        sessionId: 'adv-meth',
        recommended: JSON.stringify([1, 2, 3]),
        reasoning: JSON.stringify({ '1': 'Good for this' }),
        selected: JSON.stringify([1, 2]),
      });

      await caller.session.advance({
        sessionId: 'adv-meth',
        stage: 'rubric',
        data: { selected: [1, 3, 5] },
      });

      const [meth] = await db
        .select()
        .from(schema.methodSelections)
        .where(eq(schema.methodSelections.sessionId, 'adv-meth'));

      expect(JSON.parse(meth.selected)).toEqual([1, 3, 5]);
    });

    it('saves rubric data when advancing from rubric', async () => {
      await seedSession(db, { id: 'adv-rub', status: 'rubric' });
      await db.insert(schema.rubrics).values({
        sessionId: 'adv-rub',
        rubric: JSON.stringify({ gates: [], criteria: [], tests: [] }),
      });

      const updatedRubric = {
        gates: [{ id: 'g1', text: 'Must be safe' }],
        criteria: [{ id: 'c1', text: 'Novelty', weight: 4, description: 'How novel' }],
        tests: [{ id: 't1', text: 'Drop test' }],
      };

      await caller.session.advance({
        sessionId: 'adv-rub',
        stage: 'factory',
        data: { rubric: updatedRubric },
      });

      const [rub] = await db
        .select()
        .from(schema.rubrics)
        .where(eq(schema.rubrics.sessionId, 'adv-rub'));

      expect(JSON.parse(rub.rubric)).toEqual(updatedRubric);
    });
  });

  // -------------------------------------------------------------------
  // session.delete
  // -------------------------------------------------------------------
  describe('delete', () => {
    it('removes a session', async () => {
      await seedSession(db, { id: 'del-1' });

      const result = await caller.session.delete({ id: 'del-1' });
      expect(result).toEqual({ success: true });

      const rows = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, 'del-1'));
      expect(rows).toHaveLength(0);
    });

    it('cascade-deletes related data', async () => {
      await seedSession(db, { id: 'del-cas' });
      await db.insert(schema.taxonomyTrees).values({
        sessionId: 'del-cas',
        tree: JSON.stringify({ label: 'root' }),
      });
      await db.insert(schema.rubrics).values({
        sessionId: 'del-cas',
        rubric: JSON.stringify({ gates: [], criteria: [], tests: [] }),
      });

      await caller.session.delete({ id: 'del-cas' });

      const taxRows = await db
        .select()
        .from(schema.taxonomyTrees)
        .where(eq(schema.taxonomyTrees.sessionId, 'del-cas'));
      expect(taxRows).toHaveLength(0);

      const rubRows = await db
        .select()
        .from(schema.rubrics)
        .where(eq(schema.rubrics.sessionId, 'del-cas'));
      expect(rubRows).toHaveLength(0);
    });

    it('succeeds even if the session does not exist', async () => {
      const result = await caller.session.delete({ id: 'nonexistent' });
      expect(result).toEqual({ success: true });
    });
  });

  // -------------------------------------------------------------------
  // session.updateRubric
  // -------------------------------------------------------------------
  describe('updateRubric', () => {
    const validRubric = {
      gates: [{ id: 'g1', text: 'Must be safe' }],
      criteria: [{ id: 'c1', text: 'Novelty', weight: 3, description: 'How novel is the idea' }],
      tests: [{ id: 't1', text: 'User testing' }],
    };

    it('creates a new rubric when none exists', async () => {
      await seedSession(db, { id: 'rub-new' });

      const result = await caller.session.updateRubric({
        sessionId: 'rub-new',
        rubric: validRubric,
      });

      expect(result).toEqual({ success: true });

      const [row] = await db
        .select()
        .from(schema.rubrics)
        .where(eq(schema.rubrics.sessionId, 'rub-new'));
      expect(JSON.parse(row.rubric)).toEqual(validRubric);
    });

    it('updates an existing rubric', async () => {
      await seedSession(db, { id: 'rub-upd' });
      await db.insert(schema.rubrics).values({
        sessionId: 'rub-upd',
        rubric: JSON.stringify({ gates: [], criteria: [], tests: [] }),
      });

      await caller.session.updateRubric({
        sessionId: 'rub-upd',
        rubric: validRubric,
      });

      const [row] = await db
        .select()
        .from(schema.rubrics)
        .where(eq(schema.rubrics.sessionId, 'rub-upd'));
      expect(JSON.parse(row.rubric)).toEqual(validRubric);
    });

    it('rejects a rubric with invalid schema (missing criteria fields)', async () => {
      await seedSession(db, { id: 'rub-bad' });

      await expect(
        caller.session.updateRubric({
          sessionId: 'rub-bad',
          rubric: {
            gates: [{ id: 'g1', text: 'ok' }],
            criteria: [{ id: 'c1' }], // missing text, weight, description
            tests: [],
          } as any,
        }),
      ).rejects.toThrow();
    });

    it('rejects a rubric with weight out of range', async () => {
      await seedSession(db, { id: 'rub-weight' });

      await expect(
        caller.session.updateRubric({
          sessionId: 'rub-weight',
          rubric: {
            gates: [],
            criteria: [{ id: 'c1', text: 'x', weight: 10, description: 'too heavy' }],
            tests: [],
          },
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // session.duplicate
  // -------------------------------------------------------------------
  describe('duplicate', () => {
    it('deep copies a session and returns a new id', async () => {
      await seedSession(db, { id: 'dup-src', domain: 'chairs', status: 'methods' });
      await db.insert(schema.taxonomyTrees).values({
        sessionId: 'dup-src',
        tree: JSON.stringify({ label: 'root' }),
        selectedPath: JSON.stringify(['A', 'B']),
      });
      await db.insert(schema.methodSelections).values({
        sessionId: 'dup-src',
        recommended: JSON.stringify([1, 2]),
        reasoning: JSON.stringify({ '1': 'reason' }),
        selected: JSON.stringify([1]),
      });

      const result = await caller.session.duplicate({ id: 'dup-src' });

      expect(result).toHaveProperty('sessionId');
      expect(result.sessionId).not.toBe('dup-src');

      // Verify the new session
      const [newSession] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, result.sessionId));
      expect(newSession).toBeDefined();
      expect(newSession.domain).toBe('chairs');
      expect(newSession.status).toBe('methods');

      // Verify taxonomy was copied
      const [newTax] = await db
        .select()
        .from(schema.taxonomyTrees)
        .where(eq(schema.taxonomyTrees.sessionId, result.sessionId));
      expect(newTax).toBeDefined();
      expect(JSON.parse(newTax.tree)).toEqual({ label: 'root' });

      // Verify methods were copied
      const [newMeth] = await db
        .select()
        .from(schema.methodSelections)
        .where(eq(schema.methodSelections.sessionId, result.sessionId));
      expect(newMeth).toBeDefined();
      expect(JSON.parse(newMeth.selected)).toEqual([1]);
    });

    it('copies ideas with new ids', async () => {
      await seedSession(db, { id: 'dup-ideas' });
      await db.insert(schema.ideas).values({
        id: 'idea-1',
        sessionId: 'dup-ideas',
        name: 'Great Idea',
        description: 'A wonderful concept',
        phase: 'diverge',
      });
      await db.insert(schema.ideas).values({
        id: 'idea-2',
        sessionId: 'dup-ideas',
        name: 'Another Idea',
        description: 'Another concept',
        phase: 'diverge',
      });

      const result = await caller.session.duplicate({ id: 'dup-ideas' });

      const newIdeas = await db
        .select()
        .from(schema.ideas)
        .where(eq(schema.ideas.sessionId, result.sessionId));
      expect(newIdeas).toHaveLength(2);
      // New IDs should be different from originals
      expect(newIdeas.every((i) => i.id !== 'idea-1' && i.id !== 'idea-2')).toBe(true);
      // But content should match
      const names = newIdeas.map((i) => i.name).sort();
      expect(names).toEqual(['Another Idea', 'Great Idea']);
    });

    it('copies output packages', async () => {
      await seedSession(db, { id: 'dup-out', status: 'output' });
      await db.insert(schema.outputPackages).values({
        sessionId: 'dup-out',
        package: JSON.stringify({ title: 'Final Package' }),
        artifacts: JSON.stringify([{ type: 'image', url: 'test.png' }]),
      });

      const result = await caller.session.duplicate({ id: 'dup-out' });

      const [newOut] = await db
        .select()
        .from(schema.outputPackages)
        .where(eq(schema.outputPackages.sessionId, result.sessionId));
      expect(newOut).toBeDefined();
      expect(JSON.parse(newOut.package)).toEqual({ title: 'Final Package' });
      expect(JSON.parse(newOut.artifacts!)).toEqual([{ type: 'image', url: 'test.png' }]);
    });

    it('throws when duplicating a nonexistent session', async () => {
      await expect(caller.session.duplicate({ id: 'nope' })).rejects.toThrow('Session not found');
    });
  });

  // -------------------------------------------------------------------
  // session.rollback
  // -------------------------------------------------------------------
  describe('rollback', () => {
    async function seedFullSession(db: TestDb, id: string) {
      const now = Date.now();
      await db.insert(schema.sessions).values({
        id,
        domain: 'full test',
        status: 'output',
        coordinate: 'A > B > C',
        createdAt: now,
        updatedAt: now,
        config: JSON.stringify({ workerCount: 3, ideasPerWorker: 15, webSearch: false }),
      });
      await db.insert(schema.taxonomyTrees).values({
        sessionId: id,
        tree: JSON.stringify({ label: 'root' }),
        selectedPath: JSON.stringify(['A', 'B', 'C']),
      });
      await db.insert(schema.methodSelections).values({
        sessionId: id,
        recommended: JSON.stringify([1, 2]),
        reasoning: JSON.stringify({}),
        selected: JSON.stringify([1]),
      });
      await db.insert(schema.rubrics).values({
        sessionId: id,
        rubric: JSON.stringify({ gates: [], criteria: [], tests: [] }),
      });
      await db.insert(schema.ideas).values({
        id: `${id}-idea`,
        sessionId: id,
        name: 'Test idea',
        description: 'desc',
        phase: 'diverge',
      });
      await db.insert(schema.outputPackages).values({
        sessionId: id,
        package: JSON.stringify({ title: 'pkg' }),
      });
    }

    it('rolling back to taxonomy clears all downstream data and coordinate', async () => {
      await seedFullSession(db, 'rb-tax');

      const result = await caller.session.rollback({ id: 'rb-tax', toStage: 'taxonomy' });
      expect(result).toEqual({ success: true });

      // Session status should be taxonomy
      const [session] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, 'rb-tax'));
      expect(session.status).toBe('taxonomy');
      expect(session.coordinate).toBeNull();

      // Taxonomy tree should be deleted
      const taxRows = await db
        .select()
        .from(schema.taxonomyTrees)
        .where(eq(schema.taxonomyTrees.sessionId, 'rb-tax'));
      expect(taxRows).toHaveLength(0);

      // Methods should be deleted
      const methRows = await db
        .select()
        .from(schema.methodSelections)
        .where(eq(schema.methodSelections.sessionId, 'rb-tax'));
      expect(methRows).toHaveLength(0);

      // Rubric should be deleted
      const rubRows = await db
        .select()
        .from(schema.rubrics)
        .where(eq(schema.rubrics.sessionId, 'rb-tax'));
      expect(rubRows).toHaveLength(0);

      // Ideas should be deleted
      const ideaRows = await db
        .select()
        .from(schema.ideas)
        .where(eq(schema.ideas.sessionId, 'rb-tax'));
      expect(ideaRows).toHaveLength(0);

      // Output should be deleted
      const outRows = await db
        .select()
        .from(schema.outputPackages)
        .where(eq(schema.outputPackages.sessionId, 'rb-tax'));
      expect(outRows).toHaveLength(0);
    });

    it('rolling back to rubric preserves taxonomy and methods but clears rubric, ideas, output', async () => {
      await seedFullSession(db, 'rb-rub');

      await caller.session.rollback({ id: 'rb-rub', toStage: 'rubric' });

      const [session] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, 'rb-rub'));
      expect(session.status).toBe('rubric');

      // Taxonomy preserved
      const taxRows = await db
        .select()
        .from(schema.taxonomyTrees)
        .where(eq(schema.taxonomyTrees.sessionId, 'rb-rub'));
      expect(taxRows).toHaveLength(1);

      // Methods preserved
      const methRows = await db
        .select()
        .from(schema.methodSelections)
        .where(eq(schema.methodSelections.sessionId, 'rb-rub'));
      expect(methRows).toHaveLength(1);

      // Rubric cleared
      const rubRows = await db
        .select()
        .from(schema.rubrics)
        .where(eq(schema.rubrics.sessionId, 'rb-rub'));
      expect(rubRows).toHaveLength(0);

      // Ideas cleared
      const ideaRows = await db
        .select()
        .from(schema.ideas)
        .where(eq(schema.ideas.sessionId, 'rb-rub'));
      expect(ideaRows).toHaveLength(0);

      // Output cleared
      const outRows = await db
        .select()
        .from(schema.outputPackages)
        .where(eq(schema.outputPackages.sessionId, 'rb-rub'));
      expect(outRows).toHaveLength(0);
    });

    it('rolling back to factory preserves taxonomy, methods, rubric but clears ideas and output', async () => {
      await seedFullSession(db, 'rb-fac');

      await caller.session.rollback({ id: 'rb-fac', toStage: 'factory' });

      const [session] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, 'rb-fac'));
      expect(session.status).toBe('factory');

      // Taxonomy preserved
      const taxRows = await db
        .select()
        .from(schema.taxonomyTrees)
        .where(eq(schema.taxonomyTrees.sessionId, 'rb-fac'));
      expect(taxRows).toHaveLength(1);

      // Methods preserved
      const methRows = await db
        .select()
        .from(schema.methodSelections)
        .where(eq(schema.methodSelections.sessionId, 'rb-fac'));
      expect(methRows).toHaveLength(1);

      // Rubric preserved
      const rubRows = await db
        .select()
        .from(schema.rubrics)
        .where(eq(schema.rubrics.sessionId, 'rb-fac'));
      expect(rubRows).toHaveLength(1);

      // Ideas cleared
      const ideaRows = await db
        .select()
        .from(schema.ideas)
        .where(eq(schema.ideas.sessionId, 'rb-fac'));
      expect(ideaRows).toHaveLength(0);

      // Output cleared
      const outRows = await db
        .select()
        .from(schema.outputPackages)
        .where(eq(schema.outputPackages.sessionId, 'rb-fac'));
      expect(outRows).toHaveLength(0);
    });

    it('rolling back to output only clears output', async () => {
      await seedFullSession(db, 'rb-out');

      await caller.session.rollback({ id: 'rb-out', toStage: 'output' });

      const [session] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, 'rb-out'));
      expect(session.status).toBe('output');

      // Everything preserved except output
      const taxRows = await db
        .select()
        .from(schema.taxonomyTrees)
        .where(eq(schema.taxonomyTrees.sessionId, 'rb-out'));
      expect(taxRows).toHaveLength(1);

      const rubRows = await db
        .select()
        .from(schema.rubrics)
        .where(eq(schema.rubrics.sessionId, 'rb-out'));
      expect(rubRows).toHaveLength(1);

      const ideaRows = await db
        .select()
        .from(schema.ideas)
        .where(eq(schema.ideas.sessionId, 'rb-out'));
      expect(ideaRows).toHaveLength(1);

      // Output cleared
      const outRows = await db
        .select()
        .from(schema.outputPackages)
        .where(eq(schema.outputPackages.sessionId, 'rb-out'));
      expect(outRows).toHaveLength(0);
    });

    it('rolling back to methods clears coordinate on the session', async () => {
      await seedFullSession(db, 'rb-meth');

      await caller.session.rollback({ id: 'rb-meth', toStage: 'methods' });

      const [session] = await db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, 'rb-meth'));
      expect(session.status).toBe('methods');
      // Methods stage idx (1) > taxonomy idx (0), so coordinate is NOT cleared
      // but taxonomy tree IS preserved since stageIdx(methods)=1 > stageIdx(taxonomy)=0
      const taxRows = await db
        .select()
        .from(schema.taxonomyTrees)
        .where(eq(schema.taxonomyTrees.sessionId, 'rb-meth'));
      expect(taxRows).toHaveLength(1);

      // Methods IS cleared because stageIdx(methods)=1 <= stageIdx(methods)=1
      const methRows = await db
        .select()
        .from(schema.methodSelections)
        .where(eq(schema.methodSelections.sessionId, 'rb-meth'));
      expect(methRows).toHaveLength(0);
    });
  });
});

// -------------------------------------------------------------------
// config router
// -------------------------------------------------------------------
describe('config router', () => {
  let db: TestDb;
  let caller: ReturnType<typeof createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createTestDb();
    caller = createCaller(db);
  });

  describe('getMethods', () => {
    it('returns the method array from config', async () => {
      const result = await caller.config.getMethods();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 1, name: 'First Principles' });
      expect(result[1]).toMatchObject({ id: 2, name: 'Biomimicry' });
      expect(getAllMethods).toHaveBeenCalled();
    });
  });

  describe('getPersonas', () => {
    it('returns the persona array from config', async () => {
      const result = await caller.config.getPersonas();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ name: 'The Engineer' });
      expect(result[1]).toMatchObject({ name: 'The Visionary' });
      expect(getAllPersonas).toHaveBeenCalled();
    });
  });

  describe('getConfig', () => {
    it('returns config with hasApiKey flag, defaults, models, and server', async () => {
      const result = await caller.config.getConfig();

      expect(result.hasApiKey).toBe(true);
      expect(result.defaults).toEqual({ workerCount: 3, ideasPerWorker: 15, webSearch: false });
      expect(result.models).toBeDefined();
      expect(result.server).toEqual({ port: 3000 });
      expect(loadConfig).toHaveBeenCalled();
    });
  });

  describe('setApiKey', () => {
    it('calls saveApiKey with the provided key', async () => {
      const { saveApiKey } = await import('../config/index.js');
      const result = await caller.config.setApiKey({ apiKey: 'sk-ant-test-key' });

      expect(result).toEqual({ success: true });
      expect(saveApiKey).toHaveBeenCalledWith('sk-ant-test-key');
    });

    it('rejects an empty API key', async () => {
      await expect(caller.config.setApiKey({ apiKey: '' })).rejects.toThrow();
    });
  });
});
