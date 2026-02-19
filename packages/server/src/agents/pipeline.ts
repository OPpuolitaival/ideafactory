import type { Stage } from '@ideafactory/shared';
import { sseManager } from '../sse/index.js';
import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { loadConfig, getAllMethods } from '../config/index.js';
import { runTaxonomy } from './navigator.js';
import { runMethodSelection, runRubricDesign } from './strategist.js';
import { runFactory } from './factory.js';
import { pipelineRegistry } from './registry.js';

interface PipelineOptions {
  resume?: boolean;
}

export async function runPipeline(sessionId: string, stage: Stage, options?: PipelineOptions): Promise<void> {
  const controller = pipelineRegistry.register(sessionId);
  const db = getDb();
  const config = loadConfig();

  try {
    sseManager.emit(sessionId, {
      type: 'status:stage_start',
      data: { stage },
    });

    // Check abort between setup and stage execution
    if (controller.signal.aborted) return;

    switch (stage) {
      case 'taxonomy': {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.id, sessionId));
        if (!session) throw new Error('Session not found');

        const sessionConfig = session.config ? JSON.parse(session.config) : {};

        await runTaxonomy({
          sessionId,
          domain: session.domain,
          webSearch: sessionConfig.webSearch ?? false,
          model: sessionConfig.models?.navigator ?? config.models.navigator,
          signal: controller.signal,
          locale: sessionConfig.locale,
        });

        sseManager.emit(sessionId, {
          type: 'status:stage_complete',
          data: { stage: 'taxonomy', next: 'methods' },
        });
        break;
      }

      case 'methods': {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.id, sessionId));
        if (!session) throw new Error('Session not found');

        const sessionConfig = session.config ? JSON.parse(session.config) : {};

        await runMethodSelection({
          sessionId,
          coordinate: session.coordinate ?? '',
          methods: getAllMethods(),
          model: sessionConfig.models?.strategist ?? config.models.strategist,
          signal: controller.signal,
          locale: sessionConfig.locale,
        });

        sseManager.emit(sessionId, {
          type: 'status:stage_complete',
          data: { stage: 'methods', next: 'rubric' },
        });
        break;
      }

      case 'rubric': {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.id, sessionId));
        if (!session) throw new Error('Session not found');

        const sessionConfig = session.config ? JSON.parse(session.config) : {};

        const [methodSelection] = await db
          .select()
          .from(schema.methodSelections)
          .where(eq(schema.methodSelections.sessionId, sessionId));

        const selectedMethodIds: number[] = methodSelection
          ? JSON.parse(methodSelection.selected)
          : [];
        const allMethods = getAllMethods();
        const selectedMethods = allMethods.filter((m) => selectedMethodIds.includes(m.id));

        await runRubricDesign({
          sessionId,
          coordinate: session.coordinate ?? '',
          domain: session.domain,
          methods: selectedMethods,
          model: sessionConfig.models?.strategist ?? config.models.strategist,
          signal: controller.signal,
          locale: sessionConfig.locale,
        });

        sseManager.emit(sessionId, {
          type: 'status:stage_complete',
          data: { stage: 'rubric', next: 'factory' },
        });
        break;
      }

      case 'factory': {
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.id, sessionId));
        if (!session) throw new Error('Session not found');

        const sessionConfig = session.config ? JSON.parse(session.config) : {};

        const [methodSelection] = await db
          .select()
          .from(schema.methodSelections)
          .where(eq(schema.methodSelections.sessionId, sessionId));

        const [rubricRow] = await db
          .select()
          .from(schema.rubrics)
          .where(eq(schema.rubrics.sessionId, sessionId));

        const selectedMethodIds: number[] = methodSelection
          ? JSON.parse(methodSelection.selected)
          : [];
        const allMethods = getAllMethods();
        const selectedMethods = allMethods.filter((m) => selectedMethodIds.includes(m.id));
        const rubric = rubricRow ? JSON.parse(rubricRow.rubric) : null;
        const ideasPerWorker = sessionConfig.ideasPerWorker ?? config.defaults.ideasPerWorker;

        await runFactory({
          sessionId,
          domain: session.domain,
          coordinate: session.coordinate ?? '',
          methods: selectedMethods,
          rubric,
          ideasPerWorker,
          workerModel: sessionConfig.models?.worker ?? config.models.worker,
          analystModel: sessionConfig.models?.analyst ?? config.models.analyst,
          signal: controller.signal,
          resume: options?.resume,
          locale: sessionConfig.locale,
        });

        // Do NOT emit stage_complete — factory stays in interactive mode.
        // Session completion is handled by the completeSession tRPC mutation.
        break;
      }
    }
  } catch (error) {
    // Silently ignore aborted pipelines (e.g. from retry replacing the old run)
    if (error instanceof Error && error.name === 'AbortError') return;

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Pipeline error [${stage}]:`, error);
    sseManager.emit(sessionId, {
      type: 'status:error',
      data: { stage, error: message },
    });
    // Update DB so session doesn't appear stuck on refresh
    try {
      await db
        .update(schema.sessions)
        .set({ updatedAt: Date.now() })
        .where(eq(schema.sessions.id, sessionId));
    } catch {
      // DB update is best-effort
    }
  } finally {
    pipelineRegistry.complete(sessionId);
  }
}
