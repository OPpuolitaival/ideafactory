import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';
import { getDataDir } from '../config/paths.js';
import path from 'path';
import fs from 'fs';

let db: ReturnType<typeof createDb> | null = null;

function createDb() {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'data.db');
  const sqlite = new Database(dbPath);

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const drizzleDb = drizzle(sqlite, { schema });

  // Run migrations inline (simple approach for local-only tool)
  migrate(sqlite);

  return drizzleDb;
}

function migrate(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      domain        TEXT NOT NULL,
      coordinate    TEXT,
      status        TEXT NOT NULL DEFAULT 'taxonomy',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      config        TEXT
    );

    CREATE TABLE IF NOT EXISTS taxonomy_trees (
      session_id    TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      tree          TEXT NOT NULL,
      selected_path TEXT
    );

    CREATE TABLE IF NOT EXISTS method_selections (
      session_id    TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      recommended   TEXT NOT NULL,
      reasoning     TEXT NOT NULL,
      selected      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rubrics (
      session_id    TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      rubric        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      worker_id     TEXT,
      persona       TEXT,
      method        TEXT,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL,
      probability   TEXT,
      phase         TEXT NOT NULL,
      score         REAL,
      eliminated    INTEGER DEFAULT 0,
      data          TEXT
    );

    CREATE TABLE IF NOT EXISTS output_packages (
      session_id    TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      package       TEXT NOT NULL,
      artifacts     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ideas_session ON ideas(session_id);
    CREATE INDEX IF NOT EXISTS idx_ideas_phase ON ideas(session_id, phase);
  `);
}

export function getDb() {
  if (!db) {
    db = createDb();
  }
  return db;
}

export { schema };
export type AppDb = ReturnType<typeof createDb>;
