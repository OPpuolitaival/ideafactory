import type { SSEEvent } from '@ideafactory/shared';
import type { AppDb } from '../db/index.js';
import { schema } from '../db/index.js';

type SSEListener = (event: SSEEvent) => void;

const PERSISTABLE_TYPES = new Set([
  'agent:thought',
  'agent:tool_use',
  'status:stage_start',
  'status:stage_complete',
  'status:error',
]);

class SSEManager {
  private listeners = new Map<string, Set<SSEListener>>();
  private db: AppDb | null = null;

  setDb(db: AppDb): void {
    this.db = db;
  }

  subscribe(sessionId: string, listener: SSEListener): () => void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(listener);

    return () => {
      const set = this.listeners.get(sessionId);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(sessionId);
        }
      }
    };
  }

  emit(sessionId: string, event: SSEEvent): void {
    // Persist to DB for resumable events
    if (this.db && PERSISTABLE_TYPES.has(event.type)) {
      try {
        this.db.insert(schema.eventLog).values({
          sessionId,
          type: event.type,
          data: JSON.stringify(event.data),
          createdAt: Date.now(),
        }).run();
      } catch (e) {
        console.error('Failed to persist SSE event:', e);
      }
    }

    const set = this.listeners.get(sessionId);
    if (set) {
      for (const listener of set) {
        try {
          listener(event);
        } catch (e) {
          console.error('SSE listener error:', e);
        }
      }
    }
  }

  hasListeners(sessionId: string): boolean {
    return (this.listeners.get(sessionId)?.size ?? 0) > 0;
  }
}

export const sseManager = new SSEManager();
