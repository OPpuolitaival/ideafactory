import { useEffect, useRef } from 'react';
import { useSessionStore } from '../store/index.js';
import type { SSEEvent } from '@ideafactory/shared';

export function useSSE(sessionId: string | null) {
  const handleSSEEvent = useSessionStore((s) => s.handleSSEEvent);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const es = new EventSource(`/api/session/${sessionId}/stream`);
    eventSourceRef.current = es;

    const eventTypes = [
      'agent:thought',
      'agent:tool_use',
      'data:taxonomy_update',
      'data:methods_recommended',
      'data:rubric_generated',
      'data:idea_stream',
      'data:convergence_result',
      'data:evolution_result',
      'data:qa_result',
      'data:output_package',
      'status:stage_complete',
      'status:error',
    ];

    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          handleSSEEvent({ type: eventType, data } as SSEEvent);
        } catch (err) {
          console.error(`Failed to parse SSE event ${eventType}:`, err);
        }
      });
    }

    es.onerror = () => {
      // EventSource auto-reconnects, but log for debugging
      console.warn('SSE connection error, will auto-reconnect');
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [sessionId, handleSSEEvent]);
}
