import type { Stage } from '@ideafactory/shared';
import { sseManager } from '../sse/index.js';
import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { loadConfig, getAllMethods, getAllPersonas } from '../config/index.js';
import { runTaxonomy } from './navigator.js';
import { runMethodSelection, runRubricDesign } from './strategist.js';
import { runFactory } from './factory.js';
import { runOutput } from './analyst.js';

export async function runPipeline(sessionId: string, stage: Stage): Promise<void> {
  const db = getDb();
  const config = loadConfig();

  try {
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
        const workerCount = sessionConfig.workerCount ?? config.defaults.workerCount;
        const ideasPerWorker = sessionConfig.ideasPerWorker ?? config.defaults.ideasPerWorker;

        const personas = getAllPersonas();

        await runFactory({
          sessionId,
          domain: session.domain,
          coordinate: session.coordinate ?? '',
          methods: selectedMethods,
          rubric,
          workerCount,
          ideasPerWorker,
          personas,
          workerModel: sessionConfig.models?.worker ?? config.models.worker,
          analystModel: sessionConfig.models?.analyst ?? config.models.analyst,
        });

        sseManager.emit(sessionId, {
          type: 'status:stage_complete',
          data: { stage: 'factory', next: 'output' },
        });
        break;
      }

      case 'output': {
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

        const ideaRows = await db
          .select()
          .from(schema.ideas)
          .where(eq(schema.ideas.sessionId, sessionId));

        await runOutput({
          sessionId,
          domain: session.domain,
          coordinate: session.coordinate ?? '',
          methods: selectedMethods,
          workerCount: sessionConfig.workerCount ?? config.defaults.workerCount,
          ideas: ideaRows,
          model: sessionConfig.models?.analyst ?? config.models.analyst,
        });

        // Mark session completed
        await db
          .update(schema.sessions)
          .set({ status: 'completed', updatedAt: Date.now() })
          .where(eq(schema.sessions.id, sessionId));

        sseManager.emit(sessionId, {
          type: 'status:stage_complete',
          data: { stage: 'output', next: 'completed' },
        });
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Pipeline error [${stage}]:`, error);
    sseManager.emit(sessionId, {
      type: 'status:error',
      data: { stage, error: message },
    });
  }
}
