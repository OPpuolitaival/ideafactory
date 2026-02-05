import type { SSEEvent } from '@ideafactory/shared';

type SSEListener = (event: SSEEvent) => void;

class SSEManager {
  private listeners = new Map<string, Set<SSEListener>>();

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
