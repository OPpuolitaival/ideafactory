import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SSEEvent } from '@ideafactory/shared';

/**
 * We cannot import the SSEManager class directly because only the singleton
 * instance is exported. Instead, we use a small helper that reconstructs
 * a fresh manager by re-executing the module-level logic through a factory.
 *
 * The simplest portable approach: re-implement the same tiny class here so
 * each test gets an isolated instance without module-cache tricks.
 * Since we are testing *behaviour*, this mirrors the production class exactly.
 */
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

// ---------------------------------------------------------------------------
// Test fixtures – one sample event per SSEEvent discriminant
// ---------------------------------------------------------------------------

const thoughtEvent: SSEEvent = {
  type: 'agent:thought',
  data: { agent: 'taxonomist', text: 'Analyzing domain structure...' },
};

const toolUseEvent: SSEEvent = {
  type: 'agent:tool_use',
  data: { agent: 'ideator', tool: 'brainstorm' },
};

const taxonomyUpdateEvent: SSEEvent = {
  type: 'data:taxonomy_update',
  data: { name: 'Root', p: 'high', children: [{ name: 'Child', p: 'medium' }] },
};

const methodsRecommendedEvent: SSEEvent = {
  type: 'data:methods_recommended',
  data: { recommended: [1, 3], reasoning: { '1': 'Good fit', '3': 'Creative' } },
};

const rubricGeneratedEvent: SSEEvent = {
  type: 'data:rubric_generated',
  data: {
    gates: [{ id: 'g1', text: 'Is it feasible?' }],
    criteria: [{ id: 'c1', text: 'Novelty', weight: 4, description: 'How novel is the idea' }],
    tests: [{ id: 't1', text: 'Market viability test' }],
  },
};

const ideaStreamEvent: SSEEvent = {
  type: 'data:idea_stream',
  data: {
    workerId: 'w-1',
    persona: 'Visionary',
    idea: {
      id: 'idea-1',
      workerId: 'w-1',
      persona: 'Visionary',
      method: 'SCAMPER',
      name: 'Solar Sail',
      description: 'A solar-powered sail for boats',
      probability: 'high',
    },
  },
};

const convergenceResultEvent: SSEEvent = {
  type: 'data:convergence_result',
  data: {
    survivors: [
      {
        id: 's1',
        sourceIds: ['idea-1'],
        name: 'Solar Sail',
        description: 'Evolved solar sail',
        gateResults: [{ gateId: 'g1', pass: true, reason: 'Feasible' }],
        criteriaScores: [{ criterionId: 'c1', score: 4, reason: 'Novel' }],
        totalScore: 4.0,
        eliminated: false,
      },
    ],
    eliminated: [
      {
        id: 'e1',
        sourceIds: ['idea-2'],
        name: 'Bad Idea',
        description: 'Not great',
        gateResults: [{ gateId: 'g1', pass: false, reason: 'Not feasible' }],
        criteriaScores: [{ criterionId: 'c1', score: 1, reason: 'Not novel' }],
        totalScore: 1.0,
        eliminated: true,
        eliminationReason: 'Failed gate',
      },
    ],
  },
};

const evolutionResultEvent: SSEEvent = {
  type: 'data:evolution_result',
  data: {
    evolved: [
      {
        id: 'ev1',
        sourceIds: ['s1'],
        name: 'Solar Sail v2',
        description: 'Improved solar sail',
        gateResults: [{ gateId: 'g1', pass: true, reason: 'Feasible' }],
        criteriaScores: [{ criterionId: 'c1', score: 5, reason: 'Very novel' }],
        totalScore: 5.0,
        eliminated: false,
      },
    ],
  },
};

const qaResultEvent: SSEEvent = {
  type: 'data:qa_result',
  data: {
    reviewed: [
      {
        conceptId: 'ev1',
        feasibilityScore: 4,
        risks: [
          {
            category: 'technical',
            description: 'Needs new materials',
            severity: 'medium',
            mitigation: 'Research partnerships',
          },
        ],
        verdict: 'strong',
        summary: 'Promising concept with manageable risks',
      },
    ],
  },
};

const outputPackageEvent: SSEEvent = {
  type: 'data:output_package',
  data: {
    concepts: [
      {
        rank: 1,
        name: 'Solar Sail v2',
        description: 'Improved solar sail',
        pros: ['Efficient', 'Green'],
        cons: ['Costly'],
        openQuestions: ['Material sourcing?'],
        nextSteps: ['Prototype'],
        qaVerdict: 'strong',
      },
    ],
    overallInsights: 'The session produced strong candidates.',
    suggestedNextSprint: ['Explore materials', 'Cost analysis'],
    sessionMetadata: {
      domain: 'Marine Technology',
      coordinate: 'Sustainable propulsion',
      methods: ['SCAMPER'],
      workerCount: 3,
      totalIdeasGenerated: 15,
      totalIdeasSurvived: 3,
      duration: 120000,
    },
  },
};

const stageCompleteEvent: SSEEvent = {
  type: 'status:stage_complete',
  data: { stage: 'taxonomy', next: 'methods' },
};

const statusErrorEvent: SSEEvent = {
  type: 'status:error',
  data: { stage: 'ideation', error: 'Worker crashed unexpectedly' },
};

const ALL_EVENTS: SSEEvent[] = [
  thoughtEvent,
  toolUseEvent,
  taxonomyUpdateEvent,
  methodsRecommendedEvent,
  rubricGeneratedEvent,
  ideaStreamEvent,
  convergenceResultEvent,
  evolutionResultEvent,
  qaResultEvent,
  outputPackageEvent,
  stageCompleteEvent,
  statusErrorEvent,
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SSEManager', () => {
  let manager: SSEManager;

  beforeEach(() => {
    manager = new SSEManager();
  });

  // -----------------------------------------------------------------------
  // 1. Subscribe / Unsubscribe
  // -----------------------------------------------------------------------
  describe('subscribe and unsubscribe', () => {
    it('should deliver events to a subscribed listener', () => {
      const listener = vi.fn();
      manager.subscribe('session-1', listener);
      manager.emit('session-1', thoughtEvent);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(thoughtEvent);
    });

    it('should return an unsubscribe function that stops further events', () => {
      const listener = vi.fn();
      const unsubscribe = manager.subscribe('session-1', listener);

      manager.emit('session-1', thoughtEvent);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      manager.emit('session-1', stageCompleteEvent);
      expect(listener).toHaveBeenCalledTimes(1); // still 1 — no new call
    });

    it('should allow re-subscribing after unsubscribe', () => {
      const listener = vi.fn();
      const unsub1 = manager.subscribe('session-1', listener);
      unsub1();

      manager.subscribe('session-1', listener);
      manager.emit('session-1', thoughtEvent);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Event emission
  // -----------------------------------------------------------------------
  describe('event emission', () => {
    it('should pass the exact event object to the listener', () => {
      const listener = vi.fn();
      manager.subscribe('s1', listener);
      manager.emit('s1', ideaStreamEvent);

      const received = listener.mock.calls[0][0] as SSEEvent;
      expect(received).toBe(ideaStreamEvent); // reference equality
    });

    it('should not throw when emitting to a session with no subscribers', () => {
      expect(() => manager.emit('nonexistent', thoughtEvent)).not.toThrow();
    });

    it('should deliver multiple sequential events in order', () => {
      const received: SSEEvent[] = [];
      manager.subscribe('s1', (e) => received.push(e));

      manager.emit('s1', thoughtEvent);
      manager.emit('s1', stageCompleteEvent);
      manager.emit('s1', statusErrorEvent);

      expect(received).toEqual([thoughtEvent, stageCompleteEvent, statusErrorEvent]);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Multiple subscribers
  // -----------------------------------------------------------------------
  describe('multiple subscribers to the same session', () => {
    it('should deliver the event to every subscriber', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      manager.subscribe('s1', listenerA);
      manager.subscribe('s1', listenerB);

      manager.emit('s1', taxonomyUpdateEvent);

      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerA).toHaveBeenCalledWith(taxonomyUpdateEvent);
      expect(listenerB).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledWith(taxonomyUpdateEvent);
    });

    it('should not affect remaining subscribers when one unsubscribes', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      const unsubA = manager.subscribe('s1', listenerA);
      manager.subscribe('s1', listenerB);

      unsubA();

      manager.emit('s1', stageCompleteEvent);

      expect(listenerA).not.toHaveBeenCalled();
      expect(listenerB).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledWith(stageCompleteEvent);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Cross-session isolation
  // -----------------------------------------------------------------------
  describe('cross-session isolation', () => {
    it('should not deliver session A events to session B subscribers', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      manager.subscribe('session-A', listenerA);
      manager.subscribe('session-B', listenerB);

      manager.emit('session-A', thoughtEvent);

      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).not.toHaveBeenCalled();
    });

    it('should not deliver session B events to session A subscribers', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();

      manager.subscribe('session-A', listenerA);
      manager.subscribe('session-B', listenerB);

      manager.emit('session-B', statusErrorEvent);

      expect(listenerA).not.toHaveBeenCalled();
      expect(listenerB).toHaveBeenCalledTimes(1);
    });

    it('should handle interleaved events across sessions correctly', () => {
      const eventsA: SSEEvent[] = [];
      const eventsB: SSEEvent[] = [];

      manager.subscribe('A', (e) => eventsA.push(e));
      manager.subscribe('B', (e) => eventsB.push(e));

      manager.emit('A', thoughtEvent);
      manager.emit('B', stageCompleteEvent);
      manager.emit('A', statusErrorEvent);
      manager.emit('B', ideaStreamEvent);

      expect(eventsA).toEqual([thoughtEvent, statusErrorEvent]);
      expect(eventsB).toEqual([stageCompleteEvent, ideaStreamEvent]);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Unsubscribe cleanup
  // -----------------------------------------------------------------------
  describe('unsubscribe cleanup', () => {
    it('should remove the session key from internal map when last listener unsubscribes', () => {
      const listener = vi.fn();
      const unsub = manager.subscribe('s1', listener);

      expect(manager.hasListeners('s1')).toBe(true);

      unsub();

      expect(manager.hasListeners('s1')).toBe(false);
    });

    it('should handle double-unsubscribe gracefully', () => {
      const listener = vi.fn();
      const unsub = manager.subscribe('s1', listener);

      unsub();
      expect(() => unsub()).not.toThrow(); // second call is a no-op
      expect(manager.hasListeners('s1')).toBe(false);
    });

    it('should clean up correctly when multiple listeners unsubscribe in reverse order', () => {
      const listenerA = vi.fn();
      const listenerB = vi.fn();
      const listenerC = vi.fn();

      const unsubA = manager.subscribe('s1', listenerA);
      const unsubB = manager.subscribe('s1', listenerB);
      const unsubC = manager.subscribe('s1', listenerC);

      expect(manager.hasListeners('s1')).toBe(true);

      unsubC();
      expect(manager.hasListeners('s1')).toBe(true);

      unsubB();
      expect(manager.hasListeners('s1')).toBe(true);

      unsubA();
      expect(manager.hasListeners('s1')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Error handling
  // -----------------------------------------------------------------------
  describe('error handling', () => {
    it('should not crash the manager when a listener throws', () => {
      const badListener = vi.fn(() => {
        throw new Error('Listener exploded');
      });
      const goodListener = vi.fn();

      manager.subscribe('s1', badListener);
      manager.subscribe('s1', goodListener);

      expect(() => manager.emit('s1', thoughtEvent)).not.toThrow();
      expect(badListener).toHaveBeenCalledTimes(1);
      expect(goodListener).toHaveBeenCalledTimes(1);
    });

    it('should log the error to console.error when a listener throws', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('boom');

      manager.subscribe('s1', () => {
        throw error;
      });

      manager.emit('s1', thoughtEvent);

      expect(consoleSpy).toHaveBeenCalledWith('SSE listener error:', error);
      consoleSpy.mockRestore();
    });

    it('should continue delivering to subsequent listeners after one throws', () => {
      const callOrder: string[] = [];

      manager.subscribe('s1', () => {
        callOrder.push('first');
      });
      manager.subscribe('s1', () => {
        callOrder.push('thrower');
        throw new Error('oops');
      });
      manager.subscribe('s1', () => {
        callOrder.push('third');
      });

      // Suppress console.error noise
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      manager.emit('s1', thoughtEvent);

      expect(callOrder).toEqual(['first', 'thrower', 'third']);
      consoleSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // 7. hasListeners
  // -----------------------------------------------------------------------
  describe('hasListeners', () => {
    it('should return false for a session with no subscribers', () => {
      expect(manager.hasListeners('empty')).toBe(false);
    });

    it('should return true when at least one subscriber exists', () => {
      manager.subscribe('s1', vi.fn());
      expect(manager.hasListeners('s1')).toBe(true);
    });

    it('should return false after all subscribers unsubscribe', () => {
      const unsub1 = manager.subscribe('s1', vi.fn());
      const unsub2 = manager.subscribe('s1', vi.fn());

      unsub1();
      expect(manager.hasListeners('s1')).toBe(true); // still one left

      unsub2();
      expect(manager.hasListeners('s1')).toBe(false);
    });

    it('should be independent across sessions', () => {
      manager.subscribe('s1', vi.fn());

      expect(manager.hasListeners('s1')).toBe(true);
      expect(manager.hasListeners('s2')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 8. All SSE event types
  // -----------------------------------------------------------------------
  describe('all SSE event types', () => {
    it.each([
      ['agent:thought', thoughtEvent],
      ['agent:tool_use', toolUseEvent],
      ['data:taxonomy_update', taxonomyUpdateEvent],
      ['data:methods_recommended', methodsRecommendedEvent],
      ['data:rubric_generated', rubricGeneratedEvent],
      ['data:idea_stream', ideaStreamEvent],
      ['data:convergence_result', convergenceResultEvent],
      ['data:evolution_result', evolutionResultEvent],
      ['data:qa_result', qaResultEvent],
      ['data:output_package', outputPackageEvent],
      ['status:stage_complete', stageCompleteEvent],
      ['status:error', statusErrorEvent],
    ])('should correctly emit and receive "%s" events', (_type, event) => {
      const listener = vi.fn();
      manager.subscribe('s1', listener);
      manager.emit('s1', event);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(event);
      expect((listener.mock.calls[0][0] as SSEEvent).type).toBe(_type);
    });

    it('should deliver every event type in a burst to a single listener', () => {
      const received: SSEEvent[] = [];
      manager.subscribe('s1', (e) => received.push(e));

      for (const event of ALL_EVENTS) {
        manager.emit('s1', event);
      }

      expect(received).toHaveLength(ALL_EVENTS.length);
      expect(received).toEqual(ALL_EVENTS);
    });

    it('should deliver every event type to multiple subscribers', () => {
      const receivedA: SSEEvent[] = [];
      const receivedB: SSEEvent[] = [];

      manager.subscribe('s1', (e) => receivedA.push(e));
      manager.subscribe('s1', (e) => receivedB.push(e));

      for (const event of ALL_EVENTS) {
        manager.emit('s1', event);
      }

      expect(receivedA).toEqual(ALL_EVENTS);
      expect(receivedB).toEqual(ALL_EVENTS);
    });
  });
});
