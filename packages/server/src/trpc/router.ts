import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router, publicProcedure } from './trpc.js';
import { schema } from '../db/index.js';
import { RubricSchema, SessionConfigSchema, STAGE_ORDER } from '@ideafactory/shared';
import type { Stage } from '@ideafactory/shared';
import { getAllMethods, getModelOptions, loadConfig } from '../config/index.js';
import { runPipeline } from '../agents/pipeline.js';
import { detectFactoryProgress } from '../agents/factory.js';
import { runQAForIdeas } from '../agents/qa.js';
import { packageIdeas } from '../agents/packaging.js';
import { pipelineRegistry } from '../agents/registry.js';
import { sseManager } from '../sse/index.js';

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
        data: z.record(z.string(), z.unknown()).optional(),
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

    const qaSheetRows = await ctx.db
      .select()
      .from(schema.qaSheets)
      .where(eq(schema.qaSheets.sessionId, input.id));

    const ideaPackageRows = await ctx.db
      .select()
      .from(schema.ideaPackages)
      .where(eq(schema.ideaPackages.sessionId, input.id));

    const eventLogRows = await ctx.db
      .select()
      .from(schema.eventLog)
      .where(eq(schema.eventLog.sessionId, input.id))
      .orderBy(schema.eventLog.id);

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
      qaSheets: qaSheetRows.map((row) => ({
        ...row,
        risks: JSON.parse(row.risks),
      })),
      ideaPackages: ideaPackageRows,
      eventLog: eventLogRows.map((row) => ({
        ...row,
        data: JSON.parse(row.data),
      })),
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
        config: schema.sessions.config,
      })
      .from(schema.sessions)
      .orderBy(schema.sessions.updatedAt);

    return rows.reverse().map((row) => ({
      ...row,
      config: row.config ? JSON.parse(row.config) : null,
    }));
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

      // Copy QA sheets
      const qaRows = await ctx.db
        .select()
        .from(schema.qaSheets)
        .where(eq(schema.qaSheets.sessionId, input.id));
      for (const row of qaRows) {
        await ctx.db.insert(schema.qaSheets).values({
          ...row,
          id: nanoid(12),
          sessionId: newId,
        });
      }

      // Copy idea packages
      const pkgRows = await ctx.db
        .select()
        .from(schema.ideaPackages)
        .where(eq(schema.ideaPackages.sessionId, input.id));
      for (const row of pkgRows) {
        await ctx.db.insert(schema.ideaPackages).values({
          ...row,
          id: nanoid(12),
          sessionId: newId,
        });
      }

      // Copy event log
      const eventLogRows = await ctx.db
        .select()
        .from(schema.eventLog)
        .where(eq(schema.eventLog.sessionId, input.id));
      for (const row of eventLogRows) {
        await ctx.db.insert(schema.eventLog).values({
          sessionId: newId,
          type: row.type,
          data: row.data,
          createdAt: row.createdAt,
        });
      }

      return { sessionId: newId };
    }),

  rollback: publicProcedure
    .input(
      z.object({
        id: z.string(),
        toStage: z.enum(['taxonomy', 'methods', 'rubric', 'factory']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const stageIdx = STAGE_ORDER.indexOf(input.toStage);

      // Special: taxonomy rollback clears selectedPath (preserve tree for re-selection)
      if (input.toStage === 'taxonomy') {
        await ctx.db
          .update(schema.taxonomyTrees)
          .set({ selectedPath: null })
          .where(eq(schema.taxonomyTrees.sessionId, input.id));
        await ctx.db
          .update(schema.sessions)
          .set({ coordinate: null })
          .where(eq(schema.sessions.id, input.id));
      }

      // Delete data for stages AFTER the target (< instead of <=)
      if (stageIdx < STAGE_ORDER.indexOf('methods')) {
        await ctx.db
          .delete(schema.methodSelections)
          .where(eq(schema.methodSelections.sessionId, input.id));
      }

      if (stageIdx < STAGE_ORDER.indexOf('rubric')) {
        await ctx.db.delete(schema.rubrics).where(eq(schema.rubrics.sessionId, input.id));
      }

      if (stageIdx < STAGE_ORDER.indexOf('factory')) {
        await ctx.db.delete(schema.ideas).where(eq(schema.ideas.sessionId, input.id));
      }

      // Always clean QA sheets and idea packages on rollback
      await ctx.db.delete(schema.qaSheets).where(eq(schema.qaSheets.sessionId, input.id));
      await ctx.db.delete(schema.ideaPackages).where(eq(schema.ideaPackages.sessionId, input.id));

      // Always clear event log on rollback
      await ctx.db.delete(schema.eventLog).where(eq(schema.eventLog.sessionId, input.id));

      // Update session status
      await ctx.db
        .update(schema.sessions)
        .set({ status: input.toStage, updatedAt: Date.now() })
        .where(eq(schema.sessions.id, input.id));

      return { success: true };
    }),

  retry: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, input.id));

      if (!session) throw new Error('Session not found');

      const stage = session.status as Stage;
      if (stage === 'completed') throw new Error('Session already completed');

      // Abort any running pipeline for this session
      pipelineRegistry.abort(input.id);

      // Wait briefly to let the aborted pipeline's in-flight operations settle
      await new Promise((r) => setTimeout(r, 200));

      // Clean up data for the current stage before retrying.
      if (stage === 'taxonomy') {
        await ctx.db
          .delete(schema.taxonomyTrees)
          .where(eq(schema.taxonomyTrees.sessionId, input.id));
      } else if (stage === 'methods') {
        await ctx.db
          .delete(schema.methodSelections)
          .where(eq(schema.methodSelections.sessionId, input.id));
      } else if (stage === 'rubric') {
        await ctx.db
          .delete(schema.rubrics)
          .where(eq(schema.rubrics.sessionId, input.id));
      } else if (stage === 'factory') {
        await ctx.db
          .delete(schema.ideas)
          .where(eq(schema.ideas.sessionId, input.id));
        await ctx.db
          .delete(schema.qaSheets)
          .where(eq(schema.qaSheets.sessionId, input.id));
        await ctx.db
          .delete(schema.ideaPackages)
          .where(eq(schema.ideaPackages.sessionId, input.id));
      }

      // Clear event log for this stage (preserve prior stage events)
      const eventLogRows = await ctx.db
        .select()
        .from(schema.eventLog)
        .where(eq(schema.eventLog.sessionId, input.id))
        .orderBy(schema.eventLog.id);

      let cutoffId: number | null = null;
      for (const row of eventLogRows) {
        const data = JSON.parse(row.data);
        if (row.type === 'status:stage_start' && data.stage === stage) {
          cutoffId = row.id;
        }
      }

      if (cutoffId !== null) {
        await ctx.db.delete(schema.eventLog).where(
          eq(schema.eventLog.sessionId, input.id),
        );
        for (const row of eventLogRows) {
          if (row.id < cutoffId) {
            await ctx.db.insert(schema.eventLog).values({
              sessionId: row.sessionId,
              type: row.type,
              data: row.data,
              createdAt: row.createdAt,
            });
          }
        }
      } else {
        await ctx.db
          .delete(schema.eventLog)
          .where(eq(schema.eventLog.sessionId, input.id));
      }

      // Re-fire the pipeline
      runPipeline(input.id, stage).catch((err) => {
        console.error(`Pipeline retry error for session ${input.id}:`, err);
      });

      return { success: true };
    }),

  resume: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, input.id));

      if (!session) throw new Error('Session not found');

      const stage = session.status as Stage;
      if (stage !== 'factory') throw new Error('Resume is only supported for the factory stage');

      // Abort any running pipeline for this session
      pipelineRegistry.abort(input.id);

      // Wait briefly to let the aborted pipeline's in-flight operations settle
      await new Promise((r) => setTimeout(r, 200));

      // Do NOT delete ideas — that's the whole point of resume vs retry

      // Re-fire the pipeline with resume flag
      runPipeline(input.id, 'factory', { resume: true }).catch((err) => {
        console.error(`Pipeline resume error for session ${input.id}:`, err);
      });

      return { success: true };
    }),

  getFactoryProgress: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      return detectFactoryProgress(input.sessionId);
    }),

  runCriticalReview: publicProcedure
    .input(z.object({ sessionId: z.string(), ideaIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, input.sessionId));

      if (!session) throw new Error('Session not found');
      if (session.status !== 'factory') throw new Error('Session must be in factory stage');

      const [rubricRow] = await ctx.db
        .select()
        .from(schema.rubrics)
        .where(eq(schema.rubrics.sessionId, input.sessionId));

      const rubric = rubricRow ? JSON.parse(rubricRow.rubric) : null;
      if (!rubric) throw new Error('No rubric found');

      const sessionConfig = session.config ? JSON.parse(session.config) : {};
      const config = loadConfig();
      const model = sessionConfig.models?.analyst ?? config.models.analyst;

      const controller = pipelineRegistry.register(`${input.sessionId}:review`);

      const locale = sessionConfig.locale;

      // Fire-and-forget: QA then packaging sequentially
      (async () => {
        await runQAForIdeas({
          sessionId: input.sessionId,
          ideaIds: input.ideaIds,
          rubric,
          model,
          signal: controller.signal,
          locale,
        });
        await packageIdeas({
          sessionId: input.sessionId,
          ideaIds: input.ideaIds,
          domain: session.domain,
          coordinate: session.coordinate ?? '',
          model,
          signal: controller.signal,
          locale,
        });
        // Signal review completion to the client
        sseManager.emit(input.sessionId, {
          type: 'factory:progress',
          data: { phase: 'packaging', detail: 'Review complete' },
        });
      })().catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error(`Critical review error for session ${input.sessionId}:`, err);
        sseManager.emit(input.sessionId, {
          type: 'status:error',
          data: {
            stage: 'factory',
            error: err instanceof Error ? err.message : 'Critical review failed',
          },
        });
      }).finally(() => {
        pipelineRegistry.complete(`${input.sessionId}:review`);
      });

      return { success: true };
    }),

  completeSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, input.sessionId));

      if (!session) throw new Error('Session not found');

      await ctx.db
        .update(schema.sessions)
        .set({ status: 'completed', updatedAt: Date.now() })
        .where(eq(schema.sessions.id, input.sessionId));

      sseManager.emit(input.sessionId, {
        type: 'status:stage_complete',
        data: { stage: 'factory', next: 'completed' },
      });

      return { success: true };
    }),
});

const configRouter = router({
  getMethods: publicProcedure.query(() => {
    return getAllMethods();
  }),

  getConfig: publicProcedure.query(() => {
    const config = loadConfig();
    return {
      defaults: config.defaults,
      models: config.models,
      server: config.server,
    };
  }),

  getModelOptions: publicProcedure.query(() => {
    return getModelOptions();
  }),
});

export const appRouter = router({
  session: sessionRouter,
  config: configRouter,
});

export type AppRouter = typeof appRouter;
