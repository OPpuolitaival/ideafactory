import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  domain: text('domain').notNull(),
  coordinate: text('coordinate'),
  status: text('status').notNull().default('taxonomy'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  config: text('config'), // JSON: SessionConfig
});

export const taxonomyTrees = sqliteTable('taxonomy_trees', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  tree: text('tree').notNull(), // JSON: TaxonomyNode
  selectedPath: text('selected_path'), // JSON: string[]
});

export const methodSelections = sqliteTable('method_selections', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  recommended: text('recommended').notNull(), // JSON: number[]
  reasoning: text('reasoning').notNull(), // JSON: Record<string, string>
  selected: text('selected').notNull(), // JSON: number[]
});

export const rubrics = sqliteTable('rubrics', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  rubric: text('rubric').notNull(), // JSON: Rubric
});

export const ideas = sqliteTable('ideas', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  workerId: text('worker_id'),
  persona: text('persona'),
  method: text('method'),
  name: text('name').notNull(),
  description: text('description').notNull(),
  probability: text('probability'),
  phase: text('phase').notNull(), // 'diverge' | 'converge' | 'evolve' | 'qa'
  score: real('score'),
  eliminated: integer('eliminated').default(0),
  data: text('data'), // JSON: full structured data per phase
});

export const outputPackages = sqliteTable('output_packages', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  package: text('package').notNull(), // JSON: OutputPackage
  artifacts: text('artifacts'), // JSON: VisualArtifact[]
});
