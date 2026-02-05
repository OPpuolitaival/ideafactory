import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { vi } from 'vitest';

/**
 * Creates a fresh in-memory SQLite database for testing.
 * Each call returns an isolated database instance.
 */
export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Run migrations
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

    CREATE TABLE IF NOT EXISTS event_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type          TEXT NOT NULL,
      data          TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_event_log_session ON event_log(session_id);
  `);

  return drizzle(sqlite, { schema });
}

/**
 * Mock the Claude Agent SDK to avoid real API calls during tests.
 * Returns a mock query function that can be configured per test.
 */
export function mockAgentSdk() {
  const mockQuery = vi.fn();
  return { mockQuery };
}

/**
 * Creates a mock async iterable result for the Agent SDK query function.
 */
export function queryResult(text: string, structured?: unknown) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield {
        type: 'result',
        result: text,
        structured_output: structured,
      };
    },
  };
}

export type TestDb = ReturnType<typeof createTestDb>;
