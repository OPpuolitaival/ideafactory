import { useEffect, useRef } from 'react';
import { useSessionStore } from '../store/index.js';
import type { SSEEvent } from '@ideafactory/shared';

export function useSSE(sessionId: string | null) {
  const handleSSEEvent = useSessionStore((s) => s.handleSSEEvent);
  const setSseStatus = useSessionStore((s) => s.setSseStatus);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setSseStatus('disconnected');
      return;
    }

    setSseStatus('connecting');
    const es = new EventSource(`/api/session/${sessionId}/stream`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setSseStatus('connected');
    };

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
      'factory:progress',
      'status:stage_start',
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
      // EventSource auto-reconnects when readyState is CONNECTING
      if (es.readyState === EventSource.CONNECTING) {
        setSseStatus('reconnecting');
      } else {
        setSseStatus('disconnected');
      }
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setSseStatus('disconnected');
    };
  }, [sessionId, handleSSEEvent, setSseStatus]);
}
