import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { sseManager } from './sse/index.js';
import { loadConfig } from './config/index.js';
import { getDb } from './db/index.js';
import type { SSEEvent } from '@ideafactory/shared';

const app = new Hono();

// CORS for local development
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  }),
);

// tRPC handler
app.all('/trpc/*', (c) => {
  return fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

// SSE streaming endpoint
app.get('/api/session/:id/stream', (c) => {
  const sessionId = c.req.param('id');

  return streamSSE(c, async (stream) => {
    const unsubscribe = sseManager.subscribe(sessionId, (event: SSEEvent) => {
      stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event.data),
      });
    });

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
      stream.writeSSE({ event: 'heartbeat', data: '' });
    }, 15000);

    // Wait until the stream is closed
    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    // Keep stream open
    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });
  });
});

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }));

const config = loadConfig();
sseManager.setDb(getDb());
const port = config.server.port;

console.log(`Idea Factory server starting on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});

export { appRouter };
export type { AppRouter } from './trpc/router.js';
