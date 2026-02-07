import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import type { Method, Rubric, RawIdea, ScoredIdea, EvolvedConcept } from '@ideafactory/shared';
import { RawIdeaSchema, ScoredIdeaSchema, EvolvedConceptSchema } from '@ideafactory/shared';
import { z } from 'zod';
import { callLLMWithRetry } from './llm.js';
import {
  rawIdeaArrayJsonSchema,
  scoredIdeaArrayJsonSchema,
  evolvedConceptArrayJsonSchema,
  qaResultArrayJsonSchema,
} from './schemas.js';
import { eq } from 'drizzle-orm';
import { sseManager } from '../sse/index.js';
import { getDb, schema } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IDEATION_SKILL = fs.readFileSync(
  path.join(__dirname, '../skills/ideation/SKILL.md'),
  'utf-8',
);
const CRITIC_SKILL = fs.readFileSync(
  path.join(__dirname, '../skills/critic/SKILL.md'),
  'utf-8',
);

const BATCH_SIZE = 5;
const MAX_PARALLEL_SCORERS = 10;
const CONVERGENCE_TARGET_SURVIVORS = 10;
const EVOLUTION_WORKERS = 3;
const PAIRS_PER_WORKER = 5;
const RESCORE_TARGET_SURVIVORS = 6;

interface RunFactoryOptions {
  sessionId: string;
  domain: string;
  coordinate: string;
  methods: Method[];
  rubric: Rubric;
  ideasPerWorker: number;
  workerModel: string;
  analystModel: string;
  signal?: AbortSignal;
}

export async function runFactory(options: RunFactoryOptions): Promise<void> {
  const {
    sessionId,
    domain,
    coordinate,
    methods,
    rubric,
    ideasPerWorker,
    workerModel,
    analystModel,
    signal,
  } = options;

  // Clear any stale ideas from a previous partial run (e.g. after crash or retry)
  const db = getDb();
  await db.delete(schema.ideas).where(eq(schema.ideas.sessionId, sessionId));

  // Phase A: Divergence (Parallel — one worker per method)
  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Factory', text: `Starting divergence with ${methods.length} method workers...`, model: workerModel },
  });

  const allIdeas = await runDivergence({
    sessionId,
    domain,
    coordinate,
    methods,
    rubric,
    ideasPerWorker,
    model: workerModel,
    signal,
  });

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // Phase B: Convergence (batched scoring)
  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: `Converging ${allIdeas.length} ideas...`, model: analystModel },
  });
  sseManager.emit(sessionId, {
    type: 'factory:progress',
    data: { phase: 'converge', detail: `Scoring ${allIdeas.length} ideas...` },
  });

  const { survivors, eliminated } = await runConvergence({
    sessionId,
    ideas: allIdeas,
    rubric,
    model: analystModel,
    signal,
  });

  sseManager.emit(sessionId, {
    type: 'data:convergence_result',
    data: { survivors, eliminated },
  });

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // Phase C: Evolution (pair-based cross-pollination + re-score)
  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: `Evolving ${survivors.length} surviving concepts via cross-pollination...`, model: analystModel },
  });
  sseManager.emit(sessionId, {
    type: 'factory:progress',
    data: { phase: 'evolve', detail: `Evolving ${survivors.length} concepts...` },
  });

  const evolved = await runEvolution({
    sessionId,
    survivors,
    rubric,
    coordinate,
    model: analystModel,
    signal,
  });

  sseManager.emit(sessionId, {
    type: 'data:evolution_result',
    data: { evolved },
  });

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // Phase D: QA
  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: 'Running QA critique on evolved concepts...', model: analystModel },
  });
  sseManager.emit(sessionId, {
    type: 'factory:progress',
    data: { phase: 'qa', detail: `QA critique on ${evolved.length} concepts...` },
  });

  await runQA({
    sessionId,
    concepts: evolved,
    rubric,
    model: analystModel,
    signal,
  });
}

// ---- Helpers ----

function buildMethodPersona(method: Method): string {
  return `You are a specialist in ${method.name} thinking. Your approach: ${method.description}. You excel at ${method.goodFor}. Apply this methodology rigorously and creatively to generate novel ideas.`;
}

function generatePairs<T>(items: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      pairs.push([items[i], items[j]]);
    }
  }
  return pairs;
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ---- Batch Scoring ----

interface BatchScoreOptions {
  sessionId: string;
  ideas: { id: string; name: string; description: string; method?: string; persona?: string }[];
  rubric: Rubric;
  model: string;
  signal?: AbortSignal;
  phaseLabel: string;
}

async function batchScore(options: BatchScoreOptions): Promise<ScoredIdea[]> {
  const { sessionId, ideas, rubric, model, signal, phaseLabel } = options;

  // Split into batches
  const batches: typeof ideas[] = [];
  for (let i = 0; i < ideas.length; i += BATCH_SIZE) {
    batches.push(ideas.slice(i, i + BATCH_SIZE));
  }

  const rubricText = JSON.stringify(rubric, null, 2);
  let batchesDone = 0;
  let batchesFailed = 0;

  // Process batches with concurrency limit
  const allScored: ScoredIdea[] = [];
  for (let i = 0; i < batches.length; i += MAX_PARALLEL_SCORERS) {
    const chunk = batches.slice(i, i + MAX_PARALLEL_SCORERS);

    const settled = await Promise.allSettled(
      chunk.map(async (batch, batchIdx) => {
        const globalIdx = i + batchIdx;
        const ideaSummary = batch
          .map((idea) => `[${idea.id}] "${idea.name}"${idea.persona ? ` (${idea.persona})` : ''}: ${idea.description}`)
          .join('\n\n');

        const scored = await callLLMWithRetry(
          {
            model,
            system: `${CRITIC_SKILL}\n\nYou are in CONVERGENCE MODE. Score ideas independently.`,
            prompt: `Score these ${batch.length} ideas independently against the rubric. Return a JSON array.

## Rubric
${rubricText}

## Ideas
${ideaSummary}

Instructions:
1. Check each idea against ALL gates. If ANY gate fails, mark the idea as eliminated.
2. Score each idea on EVERY criterion (1-5 integer).
3. Do NOT merge or deduplicate — score each idea independently.
4. Calculate totalScore as weighted sum of criteriaScores.

Return a JSON array where each element has these exact fields:
- "id": unique string (e.g. "scored-${globalIdx}-0", "scored-${globalIdx}-1", etc.)
- "sourceIds": array containing the original idea ID
- "name": string
- "description": string
- "gateResults": array of {"gateId": string, "pass": boolean, "reason": string} — one per gate
- "criteriaScores": array of {"criterionId": string, "score": integer 1-5, "reason": string} — one per criterion
- "totalScore": number (weighted sum)
- "eliminated": false (we will handle elimination after scoring)

Return ONLY the JSON array, no other text.`,
            outputSchema: scoredIdeaArrayJsonSchema,
            sessionId,
            agentName: 'Analyst',
            timeoutMs: 120_000,
            signal,
          },
          (jsonStr) => {
            const parsed = JSON.parse(jsonStr);
            return z.array(ScoredIdeaSchema).parse(parsed);
          },
        );

        return scored;
      }),
    );

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        allScored.push(...result.value);
        batchesDone++;
      } else {
        batchesFailed++;
        console.error(`Batch scoring failed:`, result.reason);
      }
    }

    sseManager.emit(sessionId, {
      type: 'factory:progress',
      data: {
        phase: phaseLabel as 'converge' | 'rescore',
        detail: `Scored ${batchesDone}/${batches.length} batches (${allScored.length} ideas)`,
        workersTotal: batches.length,
        workersDone: batchesDone,
        workersFailed: batchesFailed,
      },
    });
  }

  if (allScored.length === 0 && ideas.length > 0) {
    throw new Error(`All ${batches.length} scoring batches failed`);
  }

  return allScored;
}

// ---- Phase A: Divergence ----

interface DivergenceOptions {
  sessionId: string;
  domain: string;
  coordinate: string;
  methods: Method[];
  rubric: Rubric;
  ideasPerWorker: number;
  model: string;
  signal?: AbortSignal;
}

async function runDivergence(options: DivergenceOptions): Promise<RawIdea[]> {
  const {
    sessionId,
    domain,
    coordinate,
    methods,
    rubric,
    ideasPerWorker,
    model,
    signal,
  } = options;

  const db = getDb();
  const rubricSummary = [
    'Hard Gates:',
    ...rubric.gates.map((g) => `  - ${g.text}`),
    'Scored Criteria:',
    ...rubric.criteria.map((c) => `  - ${c.text} (weight: ${c.weight})`),
  ].join('\n');

  // Shared mutable counters updated by each worker for real-time progress
  let workersDone = 0;
  let workersFailed = 0;
  let totalIdeaCount = 0;

  const emitDivergeProgress = () => {
    sseManager.emit(sessionId, {
      type: 'factory:progress',
      data: {
        phase: 'diverge',
        detail: `${workersDone + workersFailed}/${methods.length} workers complete (${totalIdeaCount} ideas)`,
        workersTotal: methods.length,
        workersDone,
        workersFailed,
      },
    });
  };

  const settled = await Promise.allSettled(
    methods.map(async (method, i) => {
      const workerId = `worker-${i}`;

      sseManager.emit(sessionId, {
        type: 'agent:thought',
        data: {
          agent: `Worker ${i + 1} (${method.name})`,
          text: `Generating ideas using ${method.name} methodology...`,
          model,
        },
      });

      let enriched: RawIdea[];
      try {
        const ideas = await callLLMWithRetry(
          {
            model,
            system: `${IDEATION_SKILL}\n\n## Your Methodology\n\n${buildMethodPersona(method)}`,
            prompt: `Generate ${ideasPerWorker} ideas using ONLY the "${method.name}" method.

Domain: "${domain}"
Coordinate: "${coordinate}"
Method: ${method.name} — ${method.description}
Best for: ${method.goodFor}

Rubric awareness (generate ideas aware of these criteria, but don't self-censor):
${rubricSummary}

Requirements:
- Generate exactly ${ideasPerWorker} ideas as a JSON array
- Each idea must have: id (any unique string), method (must be "${method.name}"), name, description, probability ("high", "medium", or "low")
- ALL ${ideasPerWorker} ideas must use the "${method.name}" method
- Be creative and bold — push the boundaries of what this method can generate
- Include a mix of probability levels (high, medium, low)

Return ONLY a JSON array of idea objects. No other text.`,
            outputSchema: rawIdeaArrayJsonSchema,
            sessionId,
            agentName: `Worker ${i + 1} (${method.name})`,
            timeoutMs: 180_000,
            signal,
          },
          (jsonStr) => {
            const parsed = JSON.parse(jsonStr);
            return z.array(RawIdeaSchema.omit({ workerId: true, persona: true })).parse(parsed);
          },
        );

        // Enrich with worker metadata — persona = method name
        enriched = ideas.map((idea, j) => {
          const stableId = `${workerId}-${j}`;
          return {
            ...idea,
            id: stableId,
            workerId,
            persona: method.name,
            method: method.name,
          };
        });
      } catch (error) {
        workersFailed++;
        sseManager.emit(sessionId, {
          type: 'agent:thought',
          data: {
            agent: `Worker ${i + 1} (${method.name})`,
            text: `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            model,
          },
        });
        emitDivergeProgress();
        throw error;
      }

      for (const idea of enriched) {
        const dbId = nanoid(12);
        await db.insert(schema.ideas).values({
          id: dbId,
          sessionId,
          workerId: idea.workerId,
          persona: idea.persona,
          method: idea.method,
          name: idea.name,
          description: idea.description,
          probability: idea.probability,
          phase: 'diverge',
          data: JSON.stringify(idea),
        });

        sseManager.emit(sessionId, {
          type: 'data:idea_stream',
          data: { workerId, persona: method.name, idea },
        });
      }

      // Track success in real-time
      workersDone++;
      totalIdeaCount += enriched.length;

      sseManager.emit(sessionId, {
        type: 'agent:thought',
        data: {
          agent: `Worker ${i + 1} (${method.name})`,
          text: `Generated ${enriched.length} ideas.`,
          model,
        },
      });
      emitDivergeProgress();

      return enriched;
    }),
  );

  // Collect results from settled promises
  const allIdeas: RawIdea[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      allIdeas.push(...result.value);
    }
  }

  if (allIdeas.length === 0) {
    throw new Error(`All ${methods.length} workers failed`);
  }

  if (workersFailed > 0) {
    sseManager.emit(sessionId, {
      type: 'agent:thought',
      data: {
        agent: 'Factory',
        text: `${workersDone}/${methods.length} workers succeeded (${allIdeas.length} ideas). Proceeding with partial results.`,
        model,
      },
    });
  }

  return allIdeas;
}

// ---- Phase B: Convergence ----

interface ConvergenceOptions {
  sessionId: string;
  ideas: RawIdea[];
  rubric: Rubric;
  model: string;
  signal?: AbortSignal;
}

async function runConvergence(
  options: ConvergenceOptions,
): Promise<{ survivors: ScoredIdea[]; eliminated: ScoredIdea[] }> {
  const { sessionId, ideas, rubric, model, signal } = options;
  const db = getDb();

  // Step 1: Score all ideas in batches
  const batchInput = ideas.map((idea) => ({
    id: idea.id,
    name: idea.name,
    description: idea.description,
    method: idea.method,
    persona: idea.persona,
  }));

  const allScored = await batchScore({
    sessionId,
    ideas: batchInput,
    rubric,
    model,
    signal,
    phaseLabel: 'converge',
  });

  // Step 2: Gate elimination (in code, not LLM)
  for (const scored of allScored) {
    const anyGateFailed = scored.gateResults.some((g) => !g.pass);
    if (anyGateFailed) {
      scored.eliminated = true;
      scored.eliminationReason = 'Failed one or more gates';
    }
  }

  // Step 3: Sort gate-passers by totalScore, select top N
  const gatePassed = allScored.filter((s) => !s.eliminated);
  const gateFailed = allScored.filter((s) => s.eliminated);

  gatePassed.sort((a, b) => b.totalScore - a.totalScore);

  const survivors = gatePassed.slice(0, CONVERGENCE_TARGET_SURVIVORS);
  const belowCutoff = gatePassed.slice(CONVERGENCE_TARGET_SURVIVORS).map((s) => ({
    ...s,
    eliminated: true,
    eliminationReason: 'Below score cutoff',
  }));

  const eliminated = [...gateFailed, ...belowCutoff];

  // Step 4: Persist all to DB
  for (const idea of [...survivors, ...eliminated]) {
    await db.insert(schema.ideas).values({
      id: nanoid(12),
      sessionId,
      name: idea.name,
      description: idea.description,
      phase: 'converge',
      score: idea.totalScore,
      eliminated: idea.eliminated ? 1 : 0,
      data: JSON.stringify(idea),
    });
  }

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: {
      agent: 'Analyst',
      text: `Convergence complete: ${survivors.length} survivors, ${eliminated.length} eliminated.`,
      model,
    },
  });

  return { survivors, eliminated };
}

// ---- Phase C: Evolution ----

interface EvolutionOptions {
  sessionId: string;
  survivors: ScoredIdea[];
  rubric: Rubric;
  coordinate: string;
  model: string;
  signal?: AbortSignal;
}

async function runEvolution(options: EvolutionOptions): Promise<ScoredIdea[]> {
  const { sessionId, survivors, rubric, coordinate, model, signal } = options;
  const db = getDb();

  // Step 1: Generate all C(n,2) pairs, shuffle, distribute to workers
  const allPairs = shuffle(generatePairs(survivors));

  // Distribute pairs to workers
  const workerPairs: [ScoredIdea, ScoredIdea][][] = Array.from({ length: EVOLUTION_WORKERS }, () => []);
  for (let i = 0; i < allPairs.length && i < EVOLUTION_WORKERS * PAIRS_PER_WORKER; i++) {
    workerPairs[i % EVOLUTION_WORKERS].push(allPairs[i]);
  }

  // Step 2: Parallel evolution workers
  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: {
      agent: 'Analyst',
      text: `Cross-pollinating with ${EVOLUTION_WORKERS} workers across ${Math.min(allPairs.length, EVOLUTION_WORKERS * PAIRS_PER_WORKER)} pairs...`,
      model,
    },
  });

  const rubricText = JSON.stringify(rubric, null, 2);
  let evolvedConcepts: EvolvedConcept[] = [];

  const settled = await Promise.allSettled(
    workerPairs.map(async (pairs, workerIdx) => {
      if (pairs.length === 0) return [];

      const pairsText = pairs
        .map(
          ([a, b], pairIdx) =>
            `Pair ${pairIdx + 1}:\n  A: [${a.id}] "${a.name}" (score: ${a.totalScore}): ${a.description}\n  B: [${b.id}] "${b.name}" (score: ${b.totalScore}): ${b.description}`,
        )
        .join('\n\n');

      const concepts = await callLLMWithRetry(
        {
          model,
          system: `You are an idea evolution specialist. Your job is to create novel concepts by cross-pollinating features, mechanisms, and insights from pairs of ideas. Each pair should inspire at least one new concept that combines the best of both.`,
          prompt: `Create new concepts by cross-pollinating these idea pairs for the coordinate "${coordinate}".

${pairsText}

Rubric (concepts should score well against this):
${rubricText}

For each pair, create 1 new concept that:
1. Combines distinctive features or mechanisms from BOTH ideas
2. Is genuinely novel — not just a merge but a synthesis
3. Addresses weaknesses of the source ideas
4. Would score well against the rubric

Return a JSON array of objects with:
- "name": string (the new concept name)
- "description": string (detailed description of the synthesis)
- "sourceIds": array of the two source idea IDs

Return ONLY the JSON array, no other text.`,
          outputSchema: evolvedConceptArrayJsonSchema,
          sessionId,
          agentName: `Evolution Worker ${workerIdx + 1}`,
          timeoutMs: 180_000,
          signal,
        },
        (jsonStr) => {
          const parsed = JSON.parse(jsonStr);
          return z.array(EvolvedConceptSchema).parse(parsed);
        },
      );

      return concepts;
    }),
  );

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      evolvedConcepts.push(...result.value);
    } else {
      console.error('Evolution worker failed:', result.reason);
    }
  }

  // Fallback: if all evolution workers failed, return original survivors
  if (evolvedConcepts.length === 0) {
    sseManager.emit(sessionId, {
      type: 'agent:thought',
      data: {
        agent: 'Analyst',
        text: 'Evolution workers failed. Falling back to original survivors.',
        model,
      },
    });
    return survivors;
  }

  // Step 3: Re-score evolved concepts through batchScore
  sseManager.emit(sessionId, {
    type: 'factory:progress',
    data: { phase: 'rescore', detail: `Re-scoring ${evolvedConcepts.length} evolved concepts...` },
  });

  const rescoreInput = evolvedConcepts.map((concept, idx) => ({
    id: `evolved-${idx}`,
    name: concept.name,
    description: concept.description,
  }));

  const rescored = await batchScore({
    sessionId,
    ideas: rescoreInput,
    rubric,
    model,
    signal,
    phaseLabel: 'rescore',
  });

  // Step 4: Gate filter + top-N selection
  for (const scored of rescored) {
    const anyGateFailed = scored.gateResults.some((g) => !g.pass);
    if (anyGateFailed) {
      scored.eliminated = true;
      scored.eliminationReason = 'Failed one or more gates';
    }
  }

  const gatePassedEvolved = rescored.filter((s) => !s.eliminated);
  gatePassedEvolved.sort((a, b) => b.totalScore - a.totalScore);
  const finalSurvivors = gatePassedEvolved.slice(0, RESCORE_TARGET_SURVIVORS);

  // Persist evolved ideas
  for (const idea of finalSurvivors) {
    await db.insert(schema.ideas).values({
      id: nanoid(12),
      sessionId,
      name: idea.name,
      description: idea.description,
      phase: 'evolve',
      score: idea.totalScore,
      eliminated: 0,
      data: JSON.stringify(idea),
    });
  }

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: `Evolution complete. ${finalSurvivors.length} concepts after cross-pollination and re-scoring.`, model },
  });

  // If re-scoring eliminated everything, fall back to original survivors
  if (finalSurvivors.length === 0) {
    sseManager.emit(sessionId, {
      type: 'agent:thought',
      data: { agent: 'Analyst', text: 'All evolved concepts eliminated. Falling back to original survivors.', model },
    });
    return survivors;
  }

  return finalSurvivors;
}

// ---- Phase D: QA ----

interface QAOptions {
  sessionId: string;
  concepts: ScoredIdea[];
  rubric: Rubric;
  model: string;
  signal?: AbortSignal;
}

async function runQA(options: QAOptions): Promise<void> {
  const { sessionId, concepts, rubric, model, signal } = options;
  const db = getDb();

  const conceptText = concepts
    .map((c) => `[${c.id}] "${c.name}" (score: ${c.totalScore}): ${c.description}`)
    .join('\n\n');

  const { QAResultSchema } = await import('@ideafactory/shared');

  const qaResults = await callLLMWithRetry(
    {
      model,
      system: `${CRITIC_SKILL}\n\nYou are in QA MODE. Reality-check evolved concepts.`,
      prompt: `Perform QA critique on these ${concepts.length} evolved concepts. Return a JSON array.

${conceptText}

Rubric: ${JSON.stringify(rubric, null, 2)}

For each concept, provide a thorough reality-check. NOT all concepts should get "strong" — be genuinely critical.

Return a JSON array where each element has these exact fields:
- "conceptId": string matching one of the concept IDs above (e.g. "${concepts[0]?.id ?? 'scored-1'}")
- "feasibilityScore": integer 1-5
- "risks": array of 3-6 objects, each with:
  - "category": string (e.g. "Technical", "Market", "Legal", "Financial")
  - "description": string
  - "severity": "low" | "medium" | "high"
  - "mitigation": string (optional)
- "verdict": exactly one of "strong", "conditional", or "weak"
- "summary": 1-2 sentence assessment

Return ONLY the JSON array, no other text.`,
      outputSchema: qaResultArrayJsonSchema,
      sessionId,
      agentName: 'Analyst',
      timeoutMs: 300_000,
      signal,
    },
    (jsonStr) => {
      const parsed = JSON.parse(jsonStr);
      return z.array(QAResultSchema).parse(parsed);
    },
  );

  // Persist QA results as idea phase data
  for (const qa of qaResults) {
    await db.insert(schema.ideas).values({
      id: nanoid(12),
      sessionId,
      name: qa.conceptId,
      description: qa.summary,
      phase: 'qa',
      score: qa.feasibilityScore,
      eliminated: qa.verdict === 'weak' ? 1 : 0,
      data: JSON.stringify(qa),
    });
  }

  sseManager.emit(sessionId, {
    type: 'data:qa_result',
    data: { reviewed: qaResults },
  });

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: 'QA critique complete.', model },
  });
}
