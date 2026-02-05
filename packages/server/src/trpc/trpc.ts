import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import type { TRPCContext } from './context.js';

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
