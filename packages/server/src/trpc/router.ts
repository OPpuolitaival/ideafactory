import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router, publicProcedure } from './trpc.js';
import { schema } from '../db/index.js';
import { RubricSchema, SessionConfigSchema, STAGE_ORDER } from '@ideafactory/shared';
import type { Stage } from '@ideafactory/shared';
import { getAllMethods, getAllPersonas, loadConfig, saveApiKey } from '../config/index.js';
import { runPipeline } from '../agents/pipeline.js';

const sessionRouter = router({
  start: publicProcedure
    .input(
      z.object({
        domain: z.string().min(1),
        config: SessionConfigSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = nanoid(12);
      const now = Date.now();
      const config = input.config ?? {
        workerCount: 3,
        ideasPerWorker: 15,
        webSearch: false,
      };

      await ctx.db.insert(schema.sessions).values({
        id,
        domain: input.domain,
        status: 'taxonomy',
        createdAt: now,
        updatedAt: now,
        config: JSON.stringify(config),
      });

      // Start taxonomy generation in background
      runPipeline(id, 'taxonomy').catch((err) => {
        console.error(`Pipeline error for session ${id}:`, err);
      });

      return { sessionId: id };
    }),

  advance: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        stage: z.string(),
        data: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, input.sessionId));

      if (!session) throw new Error('Session not found');

      const currentIdx = STAGE_ORDER.indexOf(session.status as Stage);
      const targetIdx = STAGE_ORDER.indexOf(input.stage as Stage);

      if (targetIdx !== currentIdx + 1) {
        throw new Error(`Cannot advance from ${session.status} to ${input.stage}`);
      }

      // Save stage-specific data
      if (input.data) {
        switch (session.status) {
          case 'taxonomy':
            if (input.data.selectedPath) {
              await ctx.db
                .update(schema.taxonomyTrees)
                .set({ selectedPath: JSON.stringify(input.data.selectedPath) })
                .where(eq(schema.taxonomyTrees.sessionId, input.sessionId));

              const coordinate = (input.data.selectedPath as string[]).join(' > ');
              await ctx.db
                .update(schema.sessions)
                .set({ coordinate })
                .where(eq(schema.sessions.id, input.sessionId));
            }
            break;
          case 'methods':
            if (input.data.selected) {
              await ctx.db
                .update(schema.methodSelections)
                .set({ selected: JSON.stringify(input.data.selected) })
                .where(eq(schema.methodSelections.sessionId, input.sessionId));
            }
            break;
          case 'rubric':
            if (input.data.rubric) {
              await ctx.db
                .update(schema.rubrics)
                .set({ rubric: JSON.stringify(input.data.rubric) })
                .where(eq(schema.rubrics.sessionId, input.sessionId));
            }
            break;
        }
      }

      // Update session status
      const now = Date.now();
      await ctx.db
        .update(schema.sessions)
        .set({ status: input.stage, updatedAt: now })
        .where(eq(schema.sessions.id, input.sessionId));

      // Run next stage pipeline
      runPipeline(input.sessionId, input.stage as Stage).catch((err) => {
        console.error(`Pipeline error for session ${input.sessionId}:`, err);
      });

      return { success: true };
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [session] = await ctx.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, input.id));

    if (!session) throw new Error('Session not found');

    const [taxonomy] = await ctx.db
      .select()
      .from(schema.taxonomyTrees)
      .where(eq(schema.taxonomyTrees.sessionId, input.id));

    const [methods] = await ctx.db
      .select()
      .from(schema.methodSelections)
      .where(eq(schema.methodSelections.sessionId, input.id));

    const [rubric] = await ctx.db
      .select()
      .from(schema.rubrics)
      .where(eq(schema.rubrics.sessionId, input.id));

    const ideaRows = await ctx.db
      .select()
      .from(schema.ideas)
      .where(eq(schema.ideas.sessionId, input.id));

    const [output] = await ctx.db
      .select()
      .from(schema.outputPackages)
      .where(eq(schema.outputPackages.sessionId, input.id));

    return {
      ...session,
      config: session.config ? JSON.parse(session.config) : null,
      taxonomy: taxonomy
        ? {
            tree: JSON.parse(taxonomy.tree),
            selectedPath: taxonomy.selectedPath ? JSON.parse(taxonomy.selectedPath) : null,
          }
        : null,
      methods: methods
        ? {
            recommended: JSON.parse(methods.recommended),
            reasoning: JSON.parse(methods.reasoning),
            selected: JSON.parse(methods.selected),
          }
        : null,
      rubric: rubric ? JSON.parse(rubric.rubric) : null,
      ideas: ideaRows.map((row) => ({
        ...row,
        data: row.data ? JSON.parse(row.data) : null,
      })),
      output: output
        ? {
            package: JSON.parse(output.package),
            artifacts: output.artifacts ? JSON.parse(output.artifacts) : null,
          }
        : null,
    };
  }),

  list: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: schema.sessions.id,
        domain: schema.sessions.domain,
        coordinate: schema.sessions.coordinate,
        status: schema.sessions.status,
        createdAt: schema.sessions.createdAt,
        updatedAt: schema.sessions.updatedAt,
      })
      .from(schema.sessions)
      .orderBy(schema.sessions.updatedAt);

    return rows.reverse();
  }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(schema.sessions).where(eq(schema.sessions.id, input.id));
      return { success: true };
    }),

  updateRubric: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        rubric: RubricSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(schema.rubrics)
        .where(eq(schema.rubrics.sessionId, input.sessionId));

      if (existing) {
        await ctx.db
          .update(schema.rubrics)
          .set({ rubric: JSON.stringify(input.rubric) })
          .where(eq(schema.rubrics.sessionId, input.sessionId));
      } else {
        await ctx.db.insert(schema.rubrics).values({
          sessionId: input.sessionId,
          rubric: JSON.stringify(input.rubric),
        });
      }

      return { success: true };
    }),

  duplicate: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, input.id));

      if (!session) throw new Error('Session not found');

      const newId = nanoid(12);
      const now = Date.now();

      // Copy session
      await ctx.db.insert(schema.sessions).values({
        ...session,
        id: newId,
        createdAt: now,
        updatedAt: now,
      });

      // Copy taxonomy
      const [taxonomy] = await ctx.db
        .select()
        .from(schema.taxonomyTrees)
        .where(eq(schema.taxonomyTrees.sessionId, input.id));
      if (taxonomy) {
        await ctx.db.insert(schema.taxonomyTrees).values({
          ...taxonomy,
          sessionId: newId,
        });
      }

      // Copy methods
      const [methods] = await ctx.db
        .select()
        .from(schema.methodSelections)
        .where(eq(schema.methodSelections.sessionId, input.id));
      if (methods) {
        await ctx.db.insert(schema.methodSelections).values({
          ...methods,
          sessionId: newId,
        });
      }

      // Copy rubric
      const [rubric] = await ctx.db
        .select()
        .from(schema.rubrics)
        .where(eq(schema.rubrics.sessionId, input.id));
      if (rubric) {
        await ctx.db.insert(schema.rubrics).values({
          ...rubric,
          sessionId: newId,
        });
      }

      // Copy ideas
      const ideaRows = await ctx.db
        .select()
        .from(schema.ideas)
        .where(eq(schema.ideas.sessionId, input.id));
      for (const idea of ideaRows) {
        await ctx.db.insert(schema.ideas).values({
          ...idea,
          id: nanoid(12),
          sessionId: newId,
        });
      }

      // Copy output
      const [output] = await ctx.db
        .select()
        .from(schema.outputPackages)
        .where(eq(schema.outputPackages.sessionId, input.id));
      if (output) {
        await ctx.db.insert(schema.outputPackages).values({
          ...output,
          sessionId: newId,
        });
      }

      return { sessionId: newId };
    }),

  rollback: publicProcedure
    .input(
      z.object({
        id: z.string(),
        toStage: z.enum(['taxonomy', 'methods', 'rubric', 'factory', 'output']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const stageIdx = STAGE_ORDER.indexOf(input.toStage);

      // Delete data from stages after the target
      if (stageIdx <= STAGE_ORDER.indexOf('taxonomy')) {
        await ctx.db
          .delete(schema.taxonomyTrees)
          .where(eq(schema.taxonomyTrees.sessionId, input.id));
        await ctx.db
          .update(schema.sessions)
          .set({ coordinate: null })
          .where(eq(schema.sessions.id, input.id));
      }

      if (stageIdx <= STAGE_ORDER.indexOf('methods')) {
        await ctx.db
          .delete(schema.methodSelections)
          .where(eq(schema.methodSelections.sessionId, input.id));
      }

      if (stageIdx <= STAGE_ORDER.indexOf('rubric')) {
        await ctx.db.delete(schema.rubrics).where(eq(schema.rubrics.sessionId, input.id));
      }

      if (stageIdx <= STAGE_ORDER.indexOf('factory')) {
        await ctx.db.delete(schema.ideas).where(eq(schema.ideas.sessionId, input.id));
      }

      if (stageIdx <= STAGE_ORDER.indexOf('output')) {
        await ctx.db
          .delete(schema.outputPackages)
          .where(eq(schema.outputPackages.sessionId, input.id));
      }

      // Update session status
      await ctx.db
        .update(schema.sessions)
        .set({ status: input.toStage, updatedAt: Date.now() })
        .where(eq(schema.sessions.id, input.id));

      return { success: true };
    }),
});

const configRouter = router({
  getMethods: publicProcedure.query(() => {
    return getAllMethods();
  }),

  getPersonas: publicProcedure.query(() => {
    return getAllPersonas();
  }),

  getConfig: publicProcedure.query(() => {
    const config = loadConfig();
    return {
      hasApiKey: !!config.apiKey,
      defaults: config.defaults,
      models: config.models,
      server: config.server,
    };
  }),

  setApiKey: publicProcedure
    .input(z.object({ apiKey: z.string().min(1) }))
    .mutation(({ input }) => {
      saveApiKey(input.apiKey);
      return { success: true };
    }),
});

export const appRouter = router({
  session: sessionRouter,
  config: configRouter,
});

export type AppRouter = typeof appRouter;
