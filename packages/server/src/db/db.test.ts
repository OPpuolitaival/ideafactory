import { describe, it, expect, beforeEach } from 'vitest';
import { eq, and, sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../__tests__/setup.js';
import {
  sessions,
  taxonomyTrees,
  methodSelections,
  rubrics,
  ideas,
  qaSheets,
  ideaPackages,
  eventLog,
} from './schema.js';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

// ---------------------------------------------------------------------------
// Helper: insert a session and return it
// ---------------------------------------------------------------------------
function makeSession(overrides: Partial<typeof sessions.$inferInsert> = {}) {
  const now = Date.now();
  return {
    id: overrides.id ?? 'sess-1',
    domain: overrides.domain ?? 'software engineering',
    coordinate: overrides.coordinate ?? null,
    status: overrides.status ?? 'taxonomy',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    config: overrides.config ?? null,
  };
}

function insertSession(overrides: Partial<typeof sessions.$inferInsert> = {}) {
  const row = makeSession(overrides);
  db.insert(sessions).values(row).run();
  return row;
}

// ---------------------------------------------------------------------------
// 1. Session CRUD
// ---------------------------------------------------------------------------
describe('Session CRUD', () => {
  it('should create a session and read it by ID', () => {
    const session = insertSession();

    const rows = db
      .select()
      .from(sessions)
      .where(eq(sessions.id, 'sess-1'))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sess-1');
    expect(rows[0].domain).toBe('software engineering');
    expect(rows[0].status).toBe('taxonomy');
    expect(rows[0].createdAt).toBe(session.createdAt);
  });

  it('should update a session status', () => {
    insertSession();

    db.update(sessions)
      .set({ status: 'ideation', updatedAt: Date.now() })
      .where(eq(sessions.id, 'sess-1'))
      .run();

    const [row] = db
      .select()
      .from(sessions)
      .where(eq(sessions.id, 'sess-1'))
      .all();

    expect(row.status).toBe('ideation');
  });

  it('should delete a session', () => {
    insertSession();

    db.delete(sessions).where(eq(sessions.id, 'sess-1')).run();

    const rows = db
      .select()
      .from(sessions)
      .where(eq(sessions.id, 'sess-1'))
      .all();

    expect(rows).toHaveLength(0);
  });

  it('should apply default status when none is supplied', () => {
    const now = Date.now();
    db.insert(sessions)
      .values({
        id: 'sess-default',
        domain: 'testing',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const [row] = db
      .select()
      .from(sessions)
      .where(eq(sessions.id, 'sess-default'))
      .all();

    expect(row.status).toBe('taxonomy');
  });
});

// ---------------------------------------------------------------------------
// 2. Cascade delete
// ---------------------------------------------------------------------------
describe('Cascade delete', () => {
  beforeEach(() => {
    insertSession();

    db.insert(taxonomyTrees)
      .values({
        sessionId: 'sess-1',
        tree: JSON.stringify({ name: 'root', children: [] }),
        selectedPath: JSON.stringify(['root']),
      })
      .run();

    db.insert(methodSelections)
      .values({
        sessionId: 'sess-1',
        recommended: JSON.stringify([1, 2]),
        reasoning: JSON.stringify({ '1': 'good fit' }),
        selected: JSON.stringify([1]),
      })
      .run();

    db.insert(rubrics)
      .values({
        sessionId: 'sess-1',
        rubric: JSON.stringify({ criteria: [] }),
      })
      .run();

    db.insert(ideas)
      .values({
        id: 'idea-1',
        sessionId: 'sess-1',
        name: 'Test Idea',
        description: 'A test',
        phase: 'diverge',
      })
      .run();

    db.insert(qaSheets)
      .values({
        id: 'qa-1',
        sessionId: 'sess-1',
        ideaId: 'idea-1',
        feasibilityScore: 3.5,
        verdict: 'conditional',
        summary: 'Needs more research',
        risks: JSON.stringify([]),
        createdAt: Date.now(),
      })
      .run();

    db.insert(ideaPackages)
      .values({
        id: 'pkg-1',
        sessionId: 'sess-1',
        ideaId: 'idea-1',
        ideaName: 'Test Idea',
        htmlContent: '<html>report</html>',
        deepResearchPrompt: '## Research',
        createdAt: Date.now(),
      })
      .run();

    db.insert(eventLog)
      .values({
        sessionId: 'sess-1',
        type: 'agent:thought',
        data: JSON.stringify({ agent: 'navigator', text: 'Starting work...' }),
        createdAt: Date.now(),
      })
      .run();
  });

  it('should cascade-delete taxonomy_trees when session is deleted', () => {
    db.delete(sessions).where(eq(sessions.id, 'sess-1')).run();
    const rows = db.select().from(taxonomyTrees).all();
    expect(rows).toHaveLength(0);
  });

  it('should cascade-delete method_selections when session is deleted', () => {
    db.delete(sessions).where(eq(sessions.id, 'sess-1')).run();
    const rows = db.select().from(methodSelections).all();
    expect(rows).toHaveLength(0);
  });

  it('should cascade-delete rubrics when session is deleted', () => {
    db.delete(sessions).where(eq(sessions.id, 'sess-1')).run();
    const rows = db.select().from(rubrics).all();
    expect(rows).toHaveLength(0);
  });

  it('should cascade-delete ideas when session is deleted', () => {
    db.delete(sessions).where(eq(sessions.id, 'sess-1')).run();
    const rows = db.select().from(ideas).all();
    expect(rows).toHaveLength(0);
  });

  it('should cascade-delete qa_sheets when session is deleted', () => {
    db.delete(sessions).where(eq(sessions.id, 'sess-1')).run();
    const rows = db.select().from(qaSheets).all();
    expect(rows).toHaveLength(0);
  });

  it('should cascade-delete idea_packages when session is deleted', () => {
    db.delete(sessions).where(eq(sessions.id, 'sess-1')).run();
    const rows = db.select().from(ideaPackages).all();
    expect(rows).toHaveLength(0);
  });

  it('should cascade-delete event_log when session is deleted', () => {
    db.delete(sessions).where(eq(sessions.id, 'sess-1')).run();
    const rows = db.select().from(eventLog).all();
    expect(rows).toHaveLength(0);
  });

  it('should cascade-delete all child tables at once', () => {
    db.delete(sessions).where(eq(sessions.id, 'sess-1')).run();

    expect(db.select().from(taxonomyTrees).all()).toHaveLength(0);
    expect(db.select().from(methodSelections).all()).toHaveLength(0);
    expect(db.select().from(rubrics).all()).toHaveLength(0);
    expect(db.select().from(ideas).all()).toHaveLength(0);
    expect(db.select().from(qaSheets).all()).toHaveLength(0);
    expect(db.select().from(ideaPackages).all()).toHaveLength(0);
    expect(db.select().from(eventLog).all()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Taxonomy storage
// ---------------------------------------------------------------------------
describe('Taxonomy storage', () => {
  it('should store and retrieve a taxonomy tree JSON', () => {
    insertSession();

    const tree = {
      name: 'Software',
      children: [
        { name: 'Frontend', children: [] },
        { name: 'Backend', children: [{ name: 'APIs', children: [] }] },
      ],
    };

    db.insert(taxonomyTrees)
      .values({
        sessionId: 'sess-1',
        tree: JSON.stringify(tree),
        selectedPath: JSON.stringify(['Software', 'Backend', 'APIs']),
      })
      .run();

    const [row] = db
      .select()
      .from(taxonomyTrees)
      .where(eq(taxonomyTrees.sessionId, 'sess-1'))
      .all();

    expect(row).toBeDefined();
    const parsed = JSON.parse(row.tree);
    expect(parsed.name).toBe('Software');
    expect(parsed.children).toHaveLength(2);
    expect(parsed.children[1].children[0].name).toBe('APIs');

    const selectedPath = JSON.parse(row.selectedPath!);
    expect(selectedPath).toEqual(['Software', 'Backend', 'APIs']);
  });

  it('should allow null selectedPath', () => {
    insertSession();

    db.insert(taxonomyTrees)
      .values({
        sessionId: 'sess-1',
        tree: JSON.stringify({ name: 'root', children: [] }),
      })
      .run();

    const [row] = db
      .select()
      .from(taxonomyTrees)
      .where(eq(taxonomyTrees.sessionId, 'sess-1'))
      .all();

    expect(row.selectedPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Method selection storage
// ---------------------------------------------------------------------------
describe('Method selection storage', () => {
  it('should store and retrieve recommended, reasoning, and selected', () => {
    insertSession();

    const recommended = [1, 3, 5];
    const reasoning = {
      '1': 'Brainstorming: great for divergent thinking',
      '3': 'SCAMPER: structured creativity',
      '5': 'Mind mapping: visual approach',
    };
    const selected = [1, 5];

    db.insert(methodSelections)
      .values({
        sessionId: 'sess-1',
        recommended: JSON.stringify(recommended),
        reasoning: JSON.stringify(reasoning),
        selected: JSON.stringify(selected),
      })
      .run();

    const [row] = db
      .select()
      .from(methodSelections)
      .where(eq(methodSelections.sessionId, 'sess-1'))
      .all();

    expect(JSON.parse(row.recommended)).toEqual([1, 3, 5]);
    expect(JSON.parse(row.reasoning)).toEqual(reasoning);
    expect(JSON.parse(row.selected)).toEqual([1, 5]);
  });
});

// ---------------------------------------------------------------------------
// 5. Rubric storage
// ---------------------------------------------------------------------------
describe('Rubric storage', () => {
  it('should store and retrieve a rubric JSON', () => {
    insertSession();

    const rubric = {
      criteria: [
        { name: 'Novelty', weight: 0.3, description: 'How new is the idea' },
        { name: 'Feasibility', weight: 0.4, description: 'Can it be built' },
        { name: 'Impact', weight: 0.3, description: 'Potential impact' },
      ],
    };

    db.insert(rubrics)
      .values({
        sessionId: 'sess-1',
        rubric: JSON.stringify(rubric),
      })
      .run();

    const [row] = db
      .select()
      .from(rubrics)
      .where(eq(rubrics.sessionId, 'sess-1'))
      .all();

    const parsed = JSON.parse(row.rubric);
    expect(parsed.criteria).toHaveLength(3);
    expect(parsed.criteria[0].name).toBe('Novelty');
    expect(parsed.criteria[1].weight).toBe(0.4);
  });
});

// ---------------------------------------------------------------------------
// 6. Idea CRUD
// ---------------------------------------------------------------------------
describe('Idea CRUD', () => {
  beforeEach(() => {
    insertSession();

    const baseIdeas = [
      {
        id: 'idea-d1',
        sessionId: 'sess-1',
        name: 'Diverge Idea 1',
        description: 'First diverge',
        phase: 'diverge',
        score: null,
        eliminated: 0,
      },
      {
        id: 'idea-d2',
        sessionId: 'sess-1',
        name: 'Diverge Idea 2',
        description: 'Second diverge',
        phase: 'diverge',
        score: null,
        eliminated: 0,
      },
      {
        id: 'idea-c1',
        sessionId: 'sess-1',
        name: 'Converge Idea 1',
        description: 'First converge',
        phase: 'converge',
        score: 7.5,
        eliminated: 0,
      },
      {
        id: 'idea-e1',
        sessionId: 'sess-1',
        name: 'Evolve Idea 1',
        description: 'First evolve',
        phase: 'evolve',
        score: 9.1,
        eliminated: 0,
      },
    ];

    for (const idea of baseIdeas) {
      db.insert(ideas).values(idea).run();
    }
  });

  it('should read all ideas for a session', () => {
    const rows = db
      .select()
      .from(ideas)
      .where(eq(ideas.sessionId, 'sess-1'))
      .all();

    expect(rows).toHaveLength(4);
  });

  it('should filter ideas by phase', () => {
    const divergeIdeas = db
      .select()
      .from(ideas)
      .where(and(eq(ideas.sessionId, 'sess-1'), eq(ideas.phase, 'diverge')))
      .all();

    expect(divergeIdeas).toHaveLength(2);
    expect(divergeIdeas.every((i) => i.phase === 'diverge')).toBe(true);

    const convergeIdeas = db
      .select()
      .from(ideas)
      .where(and(eq(ideas.sessionId, 'sess-1'), eq(ideas.phase, 'converge')))
      .all();

    expect(convergeIdeas).toHaveLength(1);
    expect(convergeIdeas[0].name).toBe('Converge Idea 1');
  });

  it('should update an idea score', () => {
    db.update(ideas)
      .set({ score: 8.5 })
      .where(eq(ideas.id, 'idea-d1'))
      .run();

    const [row] = db
      .select()
      .from(ideas)
      .where(eq(ideas.id, 'idea-d1'))
      .all();

    expect(row.score).toBe(8.5);
  });

  it('should update an idea eliminated flag', () => {
    db.update(ideas)
      .set({ eliminated: 1 })
      .where(eq(ideas.id, 'idea-d2'))
      .run();

    const [row] = db
      .select()
      .from(ideas)
      .where(eq(ideas.id, 'idea-d2'))
      .all();

    expect(row.eliminated).toBe(1);
  });

  it('should create a new idea', () => {
    db.insert(ideas)
      .values({
        id: 'idea-new',
        sessionId: 'sess-1',
        workerId: 'worker-42',
        persona: 'Creative Thinker',
        method: 'brainstorming',
        name: 'Brand New Idea',
        description: 'Something innovative',
        probability: 'high',
        phase: 'qa',
        score: 6.0,
        eliminated: 0,
        data: JSON.stringify({ extra: 'info' }),
      })
      .run();

    const [row] = db
      .select()
      .from(ideas)
      .where(eq(ideas.id, 'idea-new'))
      .all();

    expect(row.name).toBe('Brand New Idea');
    expect(row.workerId).toBe('worker-42');
    expect(row.persona).toBe('Creative Thinker');
    expect(row.method).toBe('brainstorming');
    expect(row.probability).toBe('high');
    expect(row.phase).toBe('qa');
    expect(row.score).toBe(6.0);
    expect(JSON.parse(row.data!)).toEqual({ extra: 'info' });
  });

  it('should delete a specific idea', () => {
    db.delete(ideas).where(eq(ideas.id, 'idea-d1')).run();

    const rows = db
      .select()
      .from(ideas)
      .where(eq(ideas.sessionId, 'sess-1'))
      .all();

    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === 'idea-d1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. QA sheets storage
// ---------------------------------------------------------------------------
describe('QA sheets storage', () => {
  it('should store and retrieve QA sheets', () => {
    insertSession();
    db.insert(ideas)
      .values({ id: 'idea-1', sessionId: 'sess-1', name: 'Idea', description: 'Desc', phase: 'converge' })
      .run();

    const now = Date.now();
    db.insert(qaSheets)
      .values({
        id: 'qa-1',
        sessionId: 'sess-1',
        ideaId: 'idea-1',
        feasibilityScore: 3.5,
        verdict: 'conditional',
        summary: 'Needs research',
        risks: JSON.stringify([{ category: 'Technical', severity: 'high' }]),
        createdAt: now,
      })
      .run();

    const [row] = db.select().from(qaSheets).where(eq(qaSheets.sessionId, 'sess-1')).all();
    expect(row.ideaId).toBe('idea-1');
    expect(row.feasibilityScore).toBe(3.5);
    expect(row.verdict).toBe('conditional');
    expect(JSON.parse(row.risks)).toHaveLength(1);
  });

  it('should store multiple QA sheets per session', () => {
    insertSession();
    db.insert(ideas)
      .values({ id: 'idea-1', sessionId: 'sess-1', name: 'Idea 1', description: 'Desc', phase: 'converge' })
      .run();
    db.insert(ideas)
      .values({ id: 'idea-2', sessionId: 'sess-1', name: 'Idea 2', description: 'Desc', phase: 'converge' })
      .run();

    const now = Date.now();
    db.insert(qaSheets).values({
      id: 'qa-1', sessionId: 'sess-1', ideaId: 'idea-1',
      feasibilityScore: 4.0, verdict: 'strong', summary: 'Good', risks: '[]', createdAt: now,
    }).run();
    db.insert(qaSheets).values({
      id: 'qa-2', sessionId: 'sess-1', ideaId: 'idea-2',
      feasibilityScore: 2.0, verdict: 'weak', summary: 'Bad', risks: '[]', createdAt: now,
    }).run();

    const rows = db.select().from(qaSheets).where(eq(qaSheets.sessionId, 'sess-1')).all();
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 7b. Idea packages storage
// ---------------------------------------------------------------------------
describe('Idea packages storage', () => {
  it('should store and retrieve idea packages', () => {
    insertSession();
    db.insert(ideas)
      .values({ id: 'idea-1', sessionId: 'sess-1', name: 'Idea', description: 'Desc', phase: 'converge' })
      .run();

    const now = Date.now();
    db.insert(ideaPackages)
      .values({
        id: 'pkg-1',
        sessionId: 'sess-1',
        ideaId: 'idea-1',
        ideaName: 'Super Idea',
        htmlContent: '<html><body>Report</body></html>',
        deepResearchPrompt: '## Research\nInvestigate feasibility...',
        createdAt: now,
      })
      .run();

    const [row] = db.select().from(ideaPackages).where(eq(ideaPackages.sessionId, 'sess-1')).all();
    expect(row.ideaId).toBe('idea-1');
    expect(row.ideaName).toBe('Super Idea');
    expect(row.htmlContent).toContain('<html>');
    expect(row.deepResearchPrompt).toContain('## Research');
  });
});

// ---------------------------------------------------------------------------
// 8. Data integrity: foreign key constraints
// ---------------------------------------------------------------------------
describe('Data integrity', () => {
  it('should reject inserting an idea without a valid session (FK violation)', () => {
    expect(() => {
      db.insert(ideas)
        .values({
          id: 'orphan-idea',
          sessionId: 'nonexistent-session',
          name: 'Orphan',
          description: 'Should fail',
          phase: 'diverge',
        })
        .run();
    }).toThrow();
  });

  it('should reject inserting a taxonomy_tree without a valid session', () => {
    expect(() => {
      db.insert(taxonomyTrees)
        .values({
          sessionId: 'nonexistent-session',
          tree: JSON.stringify({ name: 'root', children: [] }),
        })
        .run();
    }).toThrow();
  });

  it('should reject inserting a method_selection without a valid session', () => {
    expect(() => {
      db.insert(methodSelections)
        .values({
          sessionId: 'nonexistent-session',
          recommended: JSON.stringify([]),
          reasoning: JSON.stringify({}),
          selected: JSON.stringify([]),
        })
        .run();
    }).toThrow();
  });

  it('should reject inserting a rubric without a valid session', () => {
    expect(() => {
      db.insert(rubrics)
        .values({
          sessionId: 'nonexistent-session',
          rubric: JSON.stringify({}),
        })
        .run();
    }).toThrow();
  });

  it('should reject inserting a qa_sheet without a valid session', () => {
    expect(() => {
      db.insert(qaSheets)
        .values({
          id: 'qa-orphan',
          sessionId: 'nonexistent-session',
          ideaId: 'idea-1',
          feasibilityScore: 3.0,
          verdict: 'conditional',
          summary: 'Test',
          risks: '[]',
          createdAt: Date.now(),
        })
        .run();
    }).toThrow();
  });

  it('should reject inserting an idea_package without a valid session', () => {
    expect(() => {
      db.insert(ideaPackages)
        .values({
          id: 'pkg-orphan',
          sessionId: 'nonexistent-session',
          ideaId: 'idea-1',
          ideaName: 'Orphan',
          htmlContent: '<html></html>',
          deepResearchPrompt: 'prompt',
          createdAt: Date.now(),
        })
        .run();
    }).toThrow();
  });

  it('should reject a duplicate session primary key', () => {
    insertSession({ id: 'dup' });

    expect(() => {
      insertSession({ id: 'dup' });
    }).toThrow();
  });

  it('should reject a duplicate idea primary key', () => {
    insertSession();

    db.insert(ideas)
      .values({
        id: 'idea-dup',
        sessionId: 'sess-1',
        name: 'First',
        description: 'Original',
        phase: 'diverge',
      })
      .run();

    expect(() => {
      db.insert(ideas)
        .values({
          id: 'idea-dup',
          sessionId: 'sess-1',
          name: 'Second',
          description: 'Duplicate',
          phase: 'diverge',
        })
        .run();
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 9. Multiple sessions: verify isolation
// ---------------------------------------------------------------------------
describe('Multiple sessions isolation', () => {
  beforeEach(() => {
    insertSession({ id: 'sess-A', domain: 'Healthcare' });
    insertSession({ id: 'sess-B', domain: 'Education' });

    // Ideas for session A
    db.insert(ideas)
      .values({
        id: 'idea-a1',
        sessionId: 'sess-A',
        name: 'Healthcare Idea',
        description: 'A healthcare innovation',
        phase: 'diverge',
      })
      .run();

    db.insert(ideas)
      .values({
        id: 'idea-a2',
        sessionId: 'sess-A',
        name: 'Healthcare Idea 2',
        description: 'Another healthcare innovation',
        phase: 'converge',
      })
      .run();

    // Ideas for session B
    db.insert(ideas)
      .values({
        id: 'idea-b1',
        sessionId: 'sess-B',
        name: 'Education Idea',
        description: 'An education innovation',
        phase: 'diverge',
      })
      .run();

    // Taxonomy for each
    db.insert(taxonomyTrees)
      .values({
        sessionId: 'sess-A',
        tree: JSON.stringify({ name: 'Healthcare' }),
      })
      .run();

    db.insert(taxonomyTrees)
      .values({
        sessionId: 'sess-B',
        tree: JSON.stringify({ name: 'Education' }),
      })
      .run();
  });

  it('should return only ideas belonging to session A', () => {
    const rows = db
      .select()
      .from(ideas)
      .where(eq(ideas.sessionId, 'sess-A'))
      .all();

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.sessionId === 'sess-A')).toBe(true);
  });

  it('should return only ideas belonging to session B', () => {
    const rows = db
      .select()
      .from(ideas)
      .where(eq(ideas.sessionId, 'sess-B'))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe('sess-B');
    expect(rows[0].name).toBe('Education Idea');
  });

  it('should cascade-delete only the targeted session and its children', () => {
    db.delete(sessions).where(eq(sessions.id, 'sess-A')).run();

    // Session A data is gone
    expect(
      db.select().from(ideas).where(eq(ideas.sessionId, 'sess-A')).all()
    ).toHaveLength(0);
    expect(
      db
        .select()
        .from(taxonomyTrees)
        .where(eq(taxonomyTrees.sessionId, 'sess-A'))
        .all()
    ).toHaveLength(0);

    // Session B data is untouched
    expect(
      db.select().from(ideas).where(eq(ideas.sessionId, 'sess-B')).all()
    ).toHaveLength(1);
    expect(
      db
        .select()
        .from(taxonomyTrees)
        .where(eq(taxonomyTrees.sessionId, 'sess-B'))
        .all()
    ).toHaveLength(1);

    // Session B itself is still present
    const [sessionB] = db
      .select()
      .from(sessions)
      .where(eq(sessions.id, 'sess-B'))
      .all();
    expect(sessionB).toBeDefined();
    expect(sessionB.domain).toBe('Education');
  });

  it('should independently store taxonomies per session', () => {
    const [treeA] = db
      .select()
      .from(taxonomyTrees)
      .where(eq(taxonomyTrees.sessionId, 'sess-A'))
      .all();

    const [treeB] = db
      .select()
      .from(taxonomyTrees)
      .where(eq(taxonomyTrees.sessionId, 'sess-B'))
      .all();

    expect(JSON.parse(treeA.tree).name).toBe('Healthcare');
    expect(JSON.parse(treeB.tree).name).toBe('Education');
  });
});

// ---------------------------------------------------------------------------
// 10. Index existence
// ---------------------------------------------------------------------------
describe('Index existence', () => {
  it('should have idx_ideas_session index', () => {
    const result = db
      .all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_ideas_session'`
      );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('idx_ideas_session');
  });

  it('should have idx_ideas_phase index', () => {
    const result = db
      .all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_ideas_phase'`
      );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('idx_ideas_phase');
  });

  it('should not have unexpected custom indexes', () => {
    const result = db
      .all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'`
      );

    const indexNames = result.map((r) => r.name);
    expect(indexNames).toContain('idx_ideas_session');
    expect(indexNames).toContain('idx_ideas_phase');
    expect(indexNames).toContain('idx_qa_sheets_session');
    expect(indexNames).toContain('idx_idea_packages_session');
    expect(indexNames).toContain('idx_event_log_session');
    expect(indexNames).toHaveLength(5);
  });
});
