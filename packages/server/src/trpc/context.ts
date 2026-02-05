import type { AppDb } from '../db/index.js';
import { getDb } from '../db/index.js';

export interface TRPCContext {
  db: AppDb;
}

export function createContext(): TRPCContext {
  return {
    db: getDb(),
  };
}
