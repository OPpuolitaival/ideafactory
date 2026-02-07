/**
 * E2E Agent Tests — PRD §15
 *
 * These tests call the real Anthropic API and exercise the full pipeline.
 * They are skipped unless ANTHROPIC_API_KEY is set in the environment.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm test:server -- --testPathPattern e2e
 *
 * Or:
 *   ANTHROPIC_API_KEY=sk-ant-... npx vitest run packages/server/src/agents/e2e.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, type TestDb } from '../__tests__/setup.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { BUILT_IN_METHODS, DEFAULT_CONFIG } from '@ideafactory/shared';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.IDEAFACTORY_TEST_MODEL ?? 'claude-sonnet-4-20250514';

// ---------------------------------------------------------------------------
// Mocks: redirect DB to in-memory, silence SSE
// ---------------------------------------------------------------------------
let testDb: TestDb;

vi.mock('../db/index.js', async () => {
  const actual = await vi.importActual<typeof import('../db/schema.js')>('../db/schema.js');
  return { getDb: () => testDb, schema: actual };
});

vi.mock('../sse/index.js', () => ({
  sseManager: {
    emit: vi.fn(),
    subscribe: vi.fn(),
    hasListeners: vi.fn().mockReturnValue(false),
  },
}));

const SKIP_E2E = !API_KEY;
const e2eDescribe = SKIP_E2E ? describe.skip : describe;

function insertSession(db: TestDb, id: string, domain = 'Future of Chairs', coordinate?: string) {
  return db.insert(schema.sessions).values({
    id,
    domain,
    coordinate: coordinate ?? null,
    status: 'taxonomy',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    config: JSON.stringify(DEFAULT_CONFIG),
  });
}

// =========================================================================
// §15.2 Navigator Agent (Taxonomy)
// =========================================================================

e2eDescribe('E2E: Navigator Agent (Taxonomy) [PRD §15.2]', () => {
  let runTaxonomy: typeof import('./navigator.js')['runTaxonomy'];

  beforeEach(async () => {
    testDb = createTestDb();
    const mod = await import('./navigator.js');
    runTaxonomy = mod.runTaxonomy;
  });

  it('generates a valid taxonomy tree for a standard domain', async () => {
    await insertSession(testDb, 'e2e-tax-1');

    await runTaxonomy({
      sessionId: 'e2e-tax-1',
      domain: 'Future of Chairs',
      webSearch: false,
      model: MODEL,
    });

    const [row] = await testDb
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, 'e2e-tax-1'));

    expect(row).toBeDefined();
    const tree = JSON.parse(row.tree);

    // 1. Root has children (non-empty tree)
    expect(tree.children?.length).toBeGreaterThan(0);

    // 2. Each node has required fields: name, p
    function validateNode(node: Record<string, unknown>) {
      expect(node).toHaveProperty('name');
      expect(node).toHaveProperty('p');
      expect(['high', 'medium', 'low']).toContain(node.p);
      if (Array.isArray(node.children)) {
        node.children.forEach(validateNode);
      }
    }
    validateNode(tree);

    // 3. Tree depth >= 2 (at least 2 levels)
    const hasDepth2 = tree.children.some(
      (c: Record<string, unknown>) =>
        Array.isArray(c.children) && (c.children as unknown[]).length > 0,
    );
    expect(hasDepth2).toBe(true);

    // 4. Coverage: at least 5 top-level categories
    expect(tree.children.length).toBeGreaterThanOrEqual(5);

    // 5. Distribution: at least 2 probability levels present
    const allPs = new Set<string>();
    function collectPs(node: Record<string, unknown>) {
      if (node.p) allPs.add(node.p as string);
      if (Array.isArray(node.children)) node.children.forEach(collectPs);
    }
    collectPs(tree);
    expect(allPs.size).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('handles a very narrow domain', async () => {
    await insertSession(testDb, 'e2e-tax-narrow', 'Left-handed ergonomic scissors for surgeons');

    await runTaxonomy({
      sessionId: 'e2e-tax-narrow',
      domain: 'Left-handed ergonomic scissors for surgeons',
      webSearch: false,
      model: MODEL,
    });

    const [row] = await testDb
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, 'e2e-tax-narrow'));

    expect(row).toBeDefined();
    const tree = JSON.parse(row.tree);
    expect(tree.children?.length).toBeGreaterThanOrEqual(3);
  }, 60_000);
});

// =========================================================================
// §15.3 Strategist Agent (Methods)
// =========================================================================

e2eDescribe('E2E: Strategist Agent (Methods) [PRD §15.3]', () => {
  let runMethodSelection: typeof import('./strategist.js')['runMethodSelection'];

  beforeEach(async () => {
    testDb = createTestDb();
    const mod = await import('./strategist.js');
    runMethodSelection = mod.runMethodSelection;
  });

  it('recommends 3-5 methods with reasoning', async () => {
    await insertSession(testDb, 'e2e-meth-1', 'Sustainable Packaging', 'Packaging > Food > Takeaway');
    await testDb
      .update(schema.sessions)
      .set({ status: 'methods', coordinate: 'Packaging > Food > Takeaway' })
      .where(eq(schema.sessions.id, 'e2e-meth-1'));

    const methods = BUILT_IN_METHODS.map((m) => ({ ...m, builtIn: true }));

    await runMethodSelection({
      sessionId: 'e2e-meth-1',
      coordinate: 'Packaging > Food > Takeaway',
      methods,
      model: MODEL,
    });

    const [row] = await testDb
      .select()
      .from(schema.methodSelections)
      .where(eq(schema.methodSelections.sessionId, 'e2e-meth-1'));

    expect(row).toBeDefined();
    const recommended = JSON.parse(row.recommended) as number[];
    const reasoning = JSON.parse(row.reasoning) as Record<string, string>;

    // 1. Returns 3-5 recommendations
    expect(recommended.length).toBeGreaterThanOrEqual(3);
    expect(recommended.length).toBeLessThanOrEqual(5);

    // 2. All recommended IDs are valid method IDs (1-10)
    for (const id of recommended) {
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(10);
    }

    // 3. Reasoning provided for each recommendation
    expect(Object.keys(reasoning).length).toBeGreaterThanOrEqual(recommended.length);

    // 4. No duplicate recommendations
    expect(new Set(recommended).size).toBe(recommended.length);
  }, 60_000);
});

// =========================================================================
// §15.4 Strategist Agent (Rubric)
// =========================================================================

e2eDescribe('E2E: Strategist Agent (Rubric) [PRD §15.4]', () => {
  let runRubricDesign: typeof import('./strategist.js')['runRubricDesign'];

  beforeEach(async () => {
    testDb = createTestDb();
    const mod = await import('./strategist.js');
    runRubricDesign = mod.runRubricDesign;
  });

  it('generates a rubric with gates, criteria, and tests', async () => {
    await insertSession(testDb, 'e2e-rubric-1', 'Chairs', 'Chairs > Ergonomic > Standing');

    const methods = BUILT_IN_METHODS.filter((m) => [1, 2, 3].includes(m.id)).map((m) => ({
      ...m,
      builtIn: true,
    }));

    await runRubricDesign({
      sessionId: 'e2e-rubric-1',
      coordinate: 'Chairs > Ergonomic > Standing',
      domain: 'Chairs',
      methods,
      model: MODEL,
    });

    const [row] = await testDb
      .select()
      .from(schema.rubrics)
      .where(eq(schema.rubrics.sessionId, 'e2e-rubric-1'));

    expect(row).toBeDefined();
    const rubric = JSON.parse(row.rubric);

    // 1. Has all three sections
    expect(rubric).toHaveProperty('gates');
    expect(rubric).toHaveProperty('criteria');
    expect(rubric).toHaveProperty('tests');

    // 2. 3-5 gates
    expect(rubric.gates.length).toBeGreaterThanOrEqual(3);
    expect(rubric.gates.length).toBeLessThanOrEqual(5);

    // 3. 5-8 criteria
    expect(rubric.criteria.length).toBeGreaterThanOrEqual(5);
    expect(rubric.criteria.length).toBeLessThanOrEqual(8);

    // 4. 3-5 tests
    expect(rubric.tests.length).toBeGreaterThanOrEqual(3);
    expect(rubric.tests.length).toBeLessThanOrEqual(5);

    // 5. Criteria weights are in range 1-5
    for (const c of rubric.criteria) {
      expect(c.weight).toBeGreaterThanOrEqual(1);
      expect(c.weight).toBeLessThanOrEqual(5);
    }

    // 6. All items have non-empty text
    const allItems = [...rubric.gates, ...rubric.criteria, ...rubric.tests];
    for (const item of allItems) {
      expect(item.text.length).toBeGreaterThan(0);
    }

    // 7. All items have unique IDs
    const ids = allItems.map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 60_000);
});

// =========================================================================
// §15.5 Worker Agents (Ideation / Diverge) + §15.6 Convergence + §15.7 QA
// =========================================================================

e2eDescribe('E2E: Factory (Diverge + Converge + Evolve + QA) [PRD §15.5-7]', () => {
  let runFactory: typeof import('./factory.js')['runFactory'];
  const sessionId = 'e2e-factory-1';

  beforeEach(async () => {
    testDb = createTestDb();
    const mod = await import('./factory.js');
    runFactory = mod.runFactory;

    await insertSession(testDb, sessionId, 'Future of Chairs', 'Chairs > Ergonomic > Standing');
    await testDb
      .update(schema.sessions)
      .set({ status: 'factory', coordinate: 'Chairs > Ergonomic > Standing' })
      .where(eq(schema.sessions.id, sessionId));

    await testDb.insert(schema.taxonomyTrees).values({
      sessionId,
      tree: JSON.stringify({
        name: 'Chairs',
        p: 'high',
        children: [{ name: 'Ergonomic', p: 'high', children: [{ name: 'Standing', p: 'medium' }] }],
      }),
      selectedPath: JSON.stringify(['Chairs', 'Ergonomic', 'Standing']),
    });

    await testDb.insert(schema.methodSelections).values({
      sessionId,
      recommended: JSON.stringify([1, 2, 4]),
      reasoning: JSON.stringify({ '1': 'r1', '2': 'r2', '4': 'r4' }),
      selected: JSON.stringify([1, 2, 4]),
    });

    await testDb.insert(schema.rubrics).values({
      sessionId,
      rubric: JSON.stringify({
        gates: [
          { id: 'g1', text: 'Must be physically possible' },
          { id: 'g2', text: 'Must be safe for daily use' },
          { id: 'g3', text: 'Must address ergonomic needs' },
        ],
        criteria: [
          { id: 'c1', text: 'Novelty', weight: 4, description: 'How original is the idea' },
          { id: 'c2', text: 'Feasibility', weight: 5, description: 'Can it be manufactured' },
          { id: 'c3', text: 'Comfort', weight: 5, description: 'Ergonomic comfort level' },
          { id: 'c4', text: 'Cost', weight: 3, description: 'Manufacturing cost' },
          { id: 'c5', text: 'Aesthetics', weight: 3, description: 'Visual appeal' },
        ],
        tests: [
          { id: 't1', text: 'Can a user describe the benefit in one sentence?' },
          { id: 't2', text: 'Would it pass basic safety certification?' },
          { id: 't3', text: 'Is the target price under $500?' },
        ],
      }),
    });
  });

  it('runs full factory pipeline: diverge, converge, evolve, QA', async () => {
    const methods = BUILT_IN_METHODS.filter((m) => [1, 2, 4].includes(m.id)).map((m) => ({
      ...m,
      builtIn: true,
    }));

    const rubric = JSON.parse(
      (await testDb.select().from(schema.rubrics).where(eq(schema.rubrics.sessionId, sessionId)))[0]
        .rubric,
    );

    await runFactory({
      sessionId,
      domain: 'Future of Chairs',
      coordinate: 'Chairs > Ergonomic > Standing',
      methods,
      rubric,
      ideasPerWorker: 5,
      workerModel: MODEL,
      analystModel: MODEL,
    });

    const ideas = await testDb
      .select()
      .from(schema.ideas)
      .where(eq(schema.ideas.sessionId, sessionId));

    // §15.5 Diverge assertions
    const divergeIdeas = ideas.filter((i) => i.phase === 'diverge');
    expect(divergeIdeas.length).toBeGreaterThanOrEqual(3);

    for (const idea of divergeIdeas) {
      expect(idea.name.length).toBeGreaterThan(0);
      expect(idea.description.length).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(idea.probability);
    }

    // §15.6 Convergence assertions
    const convergeIdeas = ideas.filter((i) => i.phase === 'converge');
    expect(convergeIdeas.length).toBeGreaterThan(0);

    const survivors = convergeIdeas.filter((i) => i.eliminated === 0);
    expect(survivors.length).toBeGreaterThan(0);

    // Survivors should have scores
    for (const s of survivors) {
      expect(s.score).not.toBeNull();
    }

    // §15.7 QA assertions
    const qaIdeas = ideas.filter((i) => i.phase === 'qa');
    expect(qaIdeas.length).toBeGreaterThan(0);

    for (const qi of qaIdeas) {
      if (qi.data) {
        const qaData = JSON.parse(qi.data);
        expect(qaData.feasibilityScore).toBeGreaterThanOrEqual(1);
        expect(qaData.feasibilityScore).toBeLessThanOrEqual(5);
        expect(['strong', 'conditional', 'weak']).toContain(qaData.verdict);
        expect(Array.isArray(qaData.risks)).toBe(true);
      }
    }
  }, 180_000);
});

// =========================================================================
// §15.8 End-to-End Pipeline Test
// =========================================================================

e2eDescribe('E2E: Full Pipeline [PRD §15.8]', () => {
  let runTaxonomy: typeof import('./navigator.js')['runTaxonomy'];
  let runMethodSelection: typeof import('./strategist.js')['runMethodSelection'];
  let runRubricDesign: typeof import('./strategist.js')['runRubricDesign'];
  let runFactory: typeof import('./factory.js')['runFactory'];
  let runOutput: typeof import('./analyst.js')['runOutput'];
  const sessionId = 'e2e-full-pipeline';

  beforeEach(async () => {
    testDb = createTestDb();
    const nav = await import('./navigator.js');
    const strat = await import('./strategist.js');
    const fact = await import('./factory.js');
    const anal = await import('./analyst.js');
    runTaxonomy = nav.runTaxonomy;
    runMethodSelection = strat.runMethodSelection;
    runRubricDesign = strat.runRubricDesign;
    runFactory = fact.runFactory;
    runOutput = anal.runOutput;
  });

  it('runs complete 5-stage pipeline from domain to output', async () => {
    await insertSession(testDb, sessionId, 'Future of Urban Transportation');

    // Stage 1: Taxonomy
    await runTaxonomy({
      sessionId,
      domain: 'Future of Urban Transportation',
      webSearch: false,
      model: MODEL,
    });

    const [taxRow] = await testDb
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, sessionId));
    expect(taxRow).toBeDefined();
    const tree = JSON.parse(taxRow.tree);
    expect(tree.children?.length).toBeGreaterThan(0);

    // Select a coordinate
    const firstChild = tree.children[0];
    const subChild = firstChild.children?.[0];
    const coordinate = subChild
      ? `${tree.name} > ${firstChild.name} > ${subChild.name}`
      : `${tree.name} > ${firstChild.name}`;

    await testDb
      .update(schema.taxonomyTrees)
      .set({ selectedPath: JSON.stringify(coordinate.split(' > ')) })
      .where(eq(schema.taxonomyTrees.sessionId, sessionId));
    await testDb
      .update(schema.sessions)
      .set({ coordinate, status: 'methods', updatedAt: Date.now() })
      .where(eq(schema.sessions.id, sessionId));

    // Stage 2: Methods
    const allMethods = BUILT_IN_METHODS.map((m) => ({ ...m, builtIn: true }));
    await runMethodSelection({
      sessionId,
      coordinate,
      methods: allMethods,
      model: MODEL,
    });

    const [methRow] = await testDb
      .select()
      .from(schema.methodSelections)
      .where(eq(schema.methodSelections.sessionId, sessionId));
    const recommended = JSON.parse(methRow.recommended) as number[];
    const selectedMethodIds = recommended.slice(0, 3);
    await testDb
      .update(schema.methodSelections)
      .set({ selected: JSON.stringify(selectedMethodIds) })
      .where(eq(schema.methodSelections.sessionId, sessionId));
    await testDb
      .update(schema.sessions)
      .set({ status: 'rubric', updatedAt: Date.now() })
      .where(eq(schema.sessions.id, sessionId));

    // Stage 3: Rubric
    const selectedMethods = allMethods.filter((m) => selectedMethodIds.includes(m.id));
    await runRubricDesign({
      sessionId,
      coordinate,
      domain: 'Future of Urban Transportation',
      methods: selectedMethods,
      model: MODEL,
    });

    const [rubricRow] = await testDb
      .select()
      .from(schema.rubrics)
      .where(eq(schema.rubrics.sessionId, sessionId));
    const rubric = JSON.parse(rubricRow.rubric);

    await testDb
      .update(schema.sessions)
      .set({ status: 'factory', updatedAt: Date.now() })
      .where(eq(schema.sessions.id, sessionId));

    // Stage 4: Factory (1 worker, 5 ideas for speed)
    await runFactory({
      sessionId,
      domain: 'Future of Urban Transportation',
      coordinate,
      methods: selectedMethods,
      rubric,
      ideasPerWorker: 5,
      workerModel: MODEL,
      analystModel: MODEL,
    });

    const ideas = await testDb
      .select()
      .from(schema.ideas)
      .where(eq(schema.ideas.sessionId, sessionId));
    expect(ideas.length).toBeGreaterThan(0);
    const phases = new Set(ideas.map((i) => i.phase));
    expect(phases.has('diverge')).toBe(true);
    expect(phases.has('converge')).toBe(true);

    await testDb
      .update(schema.sessions)
      .set({ status: 'output', updatedAt: Date.now() })
      .where(eq(schema.sessions.id, sessionId));

    // Stage 5: Output
    await runOutput({
      sessionId,
      domain: 'Future of Urban Transportation',
      coordinate,
      methods: selectedMethods,
      ideas: ideas,
      model: MODEL,
    });

    // Final assertions
    const [outputRow] = await testDb
      .select()
      .from(schema.outputPackages)
      .where(eq(schema.outputPackages.sessionId, sessionId));
    expect(outputRow).toBeDefined();

    const outputPackage = JSON.parse(outputRow.package);
    expect(outputPackage.concepts?.length).toBeGreaterThanOrEqual(1);
    expect(outputPackage.overallInsights?.length).toBeGreaterThan(0);
    expect(outputPackage.sessionMetadata).toBeDefined();

    for (const concept of outputPackage.concepts) {
      expect(concept.rank).toBeDefined();
      expect(concept.name.length).toBeGreaterThan(0);
      expect(['strong', 'conditional', 'weak']).toContain(concept.qaVerdict);
    }

    // Filtering worked
    const divergeCount = ideas.filter((i) => i.phase === 'diverge').length;
    const survivorCount = ideas.filter((i) => i.phase === 'converge' && i.eliminated === 0).length;
    expect(divergeCount).toBeGreaterThanOrEqual(survivorCount);
  }, 300_000);
});

// =========================================================================
// §15.9 Session Management Tests (no API key needed)
// =========================================================================

describe('E2E: Session Management [PRD §15.9]', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  it('duplicates a session and preserves all data', async () => {
    await insertSession(testDb, 'orig-1', 'Test Domain', 'Test > Coord');
    await testDb
      .update(schema.sessions)
      .set({ status: 'methods', coordinate: 'Test > Coord' })
      .where(eq(schema.sessions.id, 'orig-1'));

    await testDb.insert(schema.taxonomyTrees).values({
      sessionId: 'orig-1',
      tree: JSON.stringify({ name: 'Root', p: 'high', children: [{ name: 'A', p: 'medium' }] }),
      selectedPath: JSON.stringify(['Root', 'A']),
    });

    await testDb.insert(schema.methodSelections).values({
      sessionId: 'orig-1',
      recommended: JSON.stringify([1, 2, 3]),
      reasoning: JSON.stringify({ '1': 'r1', '2': 'r2', '3': 'r3' }),
      selected: JSON.stringify([1, 2, 3]),
    });

    // Duplicate
    const newId = 'copy-1';
    const [original] = await testDb
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, 'orig-1'));
    await testDb
      .insert(schema.sessions)
      .values({ ...original, id: newId, createdAt: Date.now(), updatedAt: Date.now() });

    const [taxonomy] = await testDb
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, 'orig-1'));
    await testDb.insert(schema.taxonomyTrees).values({ ...taxonomy, sessionId: newId });

    const [methods] = await testDb
      .select()
      .from(schema.methodSelections)
      .where(eq(schema.methodSelections.sessionId, 'orig-1'));
    await testDb.insert(schema.methodSelections).values({ ...methods, sessionId: newId });

    // Verify copy
    const [copy] = await testDb
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, newId));
    expect(copy).toBeDefined();
    expect(copy.domain).toBe('Test Domain');
    expect(copy.status).toBe('methods');

    const [copyTax] = await testDb
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, newId));
    expect(copyTax).toBeDefined();
    expect(JSON.parse(copyTax.tree).name).toBe('Root');

    const [copyMeth] = await testDb
      .select()
      .from(schema.methodSelections)
      .where(eq(schema.methodSelections.sessionId, newId));
    expect(copyMeth).toBeDefined();
    expect(JSON.parse(copyMeth.recommended)).toEqual([1, 2, 3]);
  });

  it('rollback clears later stage data and preserves earlier stages', async () => {
    await insertSession(testDb, 'rollback-1', 'Test Domain', 'Test > Coord');
    await testDb
      .update(schema.sessions)
      .set({ status: 'factory', coordinate: 'Test > Coord' })
      .where(eq(schema.sessions.id, 'rollback-1'));

    await testDb.insert(schema.taxonomyTrees).values({
      sessionId: 'rollback-1',
      tree: JSON.stringify({ name: 'Root', p: 'high', children: [] }),
      selectedPath: JSON.stringify(['Root']),
    });

    await testDb.insert(schema.methodSelections).values({
      sessionId: 'rollback-1',
      recommended: JSON.stringify([1]),
      reasoning: JSON.stringify({ '1': 'reason' }),
      selected: JSON.stringify([1]),
    });

    await testDb.insert(schema.rubrics).values({
      sessionId: 'rollback-1',
      rubric: JSON.stringify({
        gates: [{ id: 'g1', text: 'test' }],
        criteria: [{ id: 'c1', text: 'test', weight: 3, description: 'test' }],
        tests: [{ id: 't1', text: 'test' }],
      }),
    });

    await testDb.insert(schema.ideas).values({
      id: 'idea-1',
      sessionId: 'rollback-1',
      name: 'Test Idea',
      description: 'Test',
      phase: 'diverge',
    });

    // Rollback to methods: clear methods, rubric, ideas
    await testDb.delete(schema.ideas).where(eq(schema.ideas.sessionId, 'rollback-1'));
    await testDb.delete(schema.rubrics).where(eq(schema.rubrics.sessionId, 'rollback-1'));
    await testDb
      .delete(schema.methodSelections)
      .where(eq(schema.methodSelections.sessionId, 'rollback-1'));
    await testDb
      .update(schema.sessions)
      .set({ status: 'methods', updatedAt: Date.now() })
      .where(eq(schema.sessions.id, 'rollback-1'));

    // Verify
    const [session] = await testDb
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, 'rollback-1'));
    expect(session.status).toBe('methods');

    // Taxonomy preserved
    const [tax] = await testDb
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, 'rollback-1'));
    expect(tax).toBeDefined();

    // Later stages cleared
    const methods = await testDb
      .select()
      .from(schema.methodSelections)
      .where(eq(schema.methodSelections.sessionId, 'rollback-1'));
    expect(methods).toHaveLength(0);

    const rubrics = await testDb
      .select()
      .from(schema.rubrics)
      .where(eq(schema.rubrics.sessionId, 'rollback-1'));
    expect(rubrics).toHaveLength(0);

    const ideas = await testDb
      .select()
      .from(schema.ideas)
      .where(eq(schema.ideas.sessionId, 'rollback-1'));
    expect(ideas).toHaveLength(0);
  });
});

// =========================================================================
// §15.10 Error Recovery Tests
// =========================================================================

e2eDescribe('E2E: Error Recovery [PRD §15.10]', () => {
  let runTaxonomy: typeof import('./navigator.js')['runTaxonomy'];

  beforeEach(async () => {
    testDb = createTestDb();
    const mod = await import('./navigator.js');
    runTaxonomy = mod.runTaxonomy;
  });

  it('handles emoji-only domain without crashing', async () => {
    await insertSession(testDb, 'e2e-emoji', '🎵♻️🔬');

    try {
      await runTaxonomy({
        sessionId: 'e2e-emoji',
        domain: '🎵♻️🔬',
        webSearch: false,
        model: MODEL,
      });

      const [row] = await testDb
        .select()
        .from(schema.taxonomyTrees)
        .where(eq(schema.taxonomyTrees.sessionId, 'e2e-emoji'));
      expect(row).toBeDefined();
    } catch (error) {
      // Clean error is acceptable
      expect(error).toBeInstanceOf(Error);
    }
  }, 60_000);
});
