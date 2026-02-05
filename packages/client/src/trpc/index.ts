import { createTRPCReact, type CreateTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@ideafactory/server';

export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTRPCClient(): any {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: '/trpc',
        transformer: superjson,
      }),
    ],
  });
}
