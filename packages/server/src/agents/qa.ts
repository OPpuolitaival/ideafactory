import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { QAResultSchema } from '@ideafactory/shared';
import type { Rubric } from '@ideafactory/shared';
import { callLLMWithRetry } from './llm.js';
import { coerceAndParse } from './coerce.js';
import { qaResultJsonSchema } from './schemas.js';
import { sseManager } from '../sse/index.js';
import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRITIC_SKILL = fs.readFileSync(
  path.join(__dirname, '../skills/critic/SKILL.md'),
  'utf-8',
);

interface RunQAOptions {
  sessionId: string;
  ideaIds: string[];
  rubric: Rubric;
  model: string;
  signal?: AbortSignal;
}

export async function runQAForIdeas(options: RunQAOptions): Promise<void> {
  const { sessionId, ideaIds, rubric, model, signal } = options;
  const db = getDb();

  // Fetch selected ideas from DB
  const allIdeas = await db
    .select()
    .from(schema.ideas)
    .where(eq(schema.ideas.sessionId, sessionId));

  const selectedIdeas = allIdeas.filter((i) => ideaIds.includes(i.id));

  if (selectedIdeas.length === 0) {
    throw new Error('No matching ideas found');
  }

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: `Running QA on ${selectedIdeas.length} ideas...`, model },
  });

  sseManager.emit(sessionId, {
    type: 'factory:progress',
    data: { phase: 'qa', detail: `QA on ${selectedIdeas.length} ideas...`, workersTotal: selectedIdeas.length, workersDone: 0 },
  });

  const rubricText = JSON.stringify(rubric, null, 2);
  let done = 0;

  // Parallel QA — one LLM call per idea
  const settled = await Promise.allSettled(
    selectedIdeas.map(async (idea) => {
      const ideaData = idea.data ? JSON.parse(idea.data) : {};
      const description = ideaData.description || idea.description;

      const qaResult = await callLLMWithRetry(
        {
          model,
          system: `${CRITIC_SKILL}\n\nYou are in QA MODE. Reality-check a single concept.`,
          prompt: `Perform QA critique on this concept. Return a single JSON object.

Concept: "${idea.name}" (score: ${idea.score ?? 'N/A'})
Description: ${description}

Rubric: ${rubricText}

Provide a thorough reality-check. Be genuinely critical.

Return a JSON object with these exact fields:
- "conceptId": "${idea.id}"
- "feasibilityScore": integer 1-5
- "risks": array of 3-6 objects, each with:
  - "category": string (e.g. "Technical", "Market", "Legal", "Financial")
  - "description": string
  - "severity": "low" | "medium" | "high"
  - "mitigation": string (optional)
- "verdict": exactly one of "strong", "conditional", or "weak"
- "summary": 1-2 sentence assessment

Return ONLY the JSON object, no other text.`,
          outputSchema: qaResultJsonSchema,
          sessionId,
          agentName: 'Analyst',
          timeoutMs: 120_000,
          signal,
        },
        (jsonStr) => coerceAndParse(jsonStr, QAResultSchema),
      );

      // Persist to qa_sheets
      await db.insert(schema.qaSheets).values({
        id: nanoid(12),
        sessionId,
        ideaId: idea.id,
        feasibilityScore: qaResult.feasibilityScore,
        verdict: qaResult.verdict,
        summary: qaResult.summary,
        risks: JSON.stringify(qaResult.risks),
        createdAt: Date.now(),
      });

      // Emit per-idea QA sheet
      sseManager.emit(sessionId, {
        type: 'data:qa_sheet',
        data: qaResult,
      });

      done++;
      sseManager.emit(sessionId, {
        type: 'factory:progress',
        data: { phase: 'qa', detail: `QA complete for ${done}/${selectedIdeas.length} ideas`, workersTotal: selectedIdeas.length, workersDone: done },
      });

      return qaResult;
    }),
  );

  const successes = settled.filter((r) => r.status === 'fulfilled').length;
  const failures = settled.filter((r) => r.status === 'rejected').length;

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: {
      agent: 'Analyst',
      text: `QA complete. ${successes} succeeded, ${failures} failed.`,
      model,
    },
  });
}
