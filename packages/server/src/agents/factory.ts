import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import type { Method, Persona, Rubric, RawIdea, ScoredIdea } from '@ideafactory/shared';
import { RawIdeaSchema, ScoredIdeaSchema } from '@ideafactory/shared';
import { z } from 'zod';
import { callLLMWithRetry } from './llm.js';
import { rawIdeaArrayJsonSchema, scoredIdeaArrayJsonSchema, qaResultArrayJsonSchema } from './schemas.js';
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

interface RunFactoryOptions {
  sessionId: string;
  domain: string;
  coordinate: string;
  methods: Method[];
  rubric: Rubric;
  workerCount: number;
  ideasPerWorker: number;
  personas: Persona[];
  workerModel: string;
  analystModel: string;
}

export async function runFactory(options: RunFactoryOptions): Promise<void> {
  const {
    sessionId,
    domain,
    coordinate,
    methods,
    rubric,
    workerCount,
    ideasPerWorker,
    personas,
    workerModel,
    analystModel,
  } = options;

  // Phase A: Divergence (Parallel)
  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Factory', text: `Starting divergence with ${workerCount} parallel workers...` },
  });

  const allIdeas = await runDivergence({
    sessionId,
    domain,
    coordinate,
    methods,
    rubric,
    workerCount,
    ideasPerWorker,
    personas,
    model: workerModel,
  });

  // Phase B: Convergence
  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: `Converging ${allIdeas.length} ideas...` },
  });

  const { survivors, eliminated } = await runConvergence({
    sessionId,
    ideas: allIdeas,
    rubric,
    model: analystModel,
  });

  sseManager.emit(sessionId, {
    type: 'data:convergence_result',
    data: { survivors, eliminated },
  });

  // Phase C: Evolution
  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: `Evolving ${survivors.length} surviving concepts...` },
  });

  const evolved = await runEvolution({
    sessionId,
    survivors,
    rubric,
    coordinate,
    model: analystModel,
  });

  sseManager.emit(sessionId, {
    type: 'data:evolution_result',
    data: { evolved },
  });

  // Phase D: QA
  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: 'Running QA critique on evolved concepts...' },
  });

  await runQA({
    sessionId,
    concepts: evolved,
    rubric,
    model: analystModel,
  });
}

// ---- Phase A: Divergence ----

interface DivergenceOptions {
  sessionId: string;
  domain: string;
  coordinate: string;
  methods: Method[];
  rubric: Rubric;
  workerCount: number;
  ideasPerWorker: number;
  personas: Persona[];
  model: string;
}

async function runDivergence(options: DivergenceOptions): Promise<RawIdea[]> {
  const {
    sessionId,
    domain,
    coordinate,
    methods,
    rubric,
    workerCount,
    ideasPerWorker,
    personas,
    model,
  } = options;

  const db = getDb();
  const workers = personas.slice(0, workerCount);
  const methodNames = methods.map((m) => `${m.name}: ${m.description}`).join('\n');
  const rubricSummary = [
    'Hard Gates:',
    ...rubric.gates.map((g) => `  - ${g.text}`),
    'Scored Criteria:',
    ...rubric.criteria.map((c) => `  - ${c.text} (weight: ${c.weight})`),
  ].join('\n');

  const results = await Promise.all(
    workers.map(async (persona, i) => {
      const workerId = `worker-${i}`;

      sseManager.emit(sessionId, {
        type: 'agent:thought',
        data: {
          agent: `Worker ${i + 1} (${persona.name})`,
          text: `Generating ideas with ${persona.name} perspective...`,
        },
      });

      const ideas = await callLLMWithRetry(
        {
          model,
          system: `${IDEATION_SKILL}\n\n## Your Persona\n\n${persona.systemPrompt}`,
          prompt: `Generate ${ideasPerWorker} ideas for:

Domain: "${domain}"
Coordinate: "${coordinate}"
Your Worker ID: ${workerId}

Methods to use:
${methodNames}

Rubric awareness (generate ideas aware of these criteria, but don't self-censor):
${rubricSummary}

Requirements:
- Generate exactly ${ideasPerWorker} ideas
- Use each method at least once
- Include all probability levels (high, medium, low)
- Use IDs like "idea-${i}-1", "idea-${i}-2", etc.
- Lean into your ${persona.name} perspective

Return ONLY a JSON array of idea objects.`,
          outputSchema: rawIdeaArrayJsonSchema,
          sessionId,
          agentName: `Worker ${i + 1} (${persona.name})`,
        },
        (jsonStr) => {
          const parsed = JSON.parse(jsonStr);
          return z.array(RawIdeaSchema.omit({ workerId: true, persona: true })).parse(parsed);
        },
      );

      // Enrich with worker metadata and persist
      const enriched: RawIdea[] = ideas.map((idea) => ({
        ...idea,
        workerId,
        persona: persona.name,
      }));

      for (const idea of enriched) {
        await db.insert(schema.ideas).values({
          id: idea.id,
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
          data: { workerId, persona: persona.name, idea },
        });
      }

      sseManager.emit(sessionId, {
        type: 'agent:thought',
        data: {
          agent: `Worker ${i + 1} (${persona.name})`,
          text: `Generated ${enriched.length} ideas.`,
        },
      });

      return enriched;
    }),
  );

  return results.flat();
}

// ---- Phase B: Convergence ----

interface ConvergenceOptions {
  sessionId: string;
  ideas: RawIdea[];
  rubric: Rubric;
  model: string;
}

async function runConvergence(
  options: ConvergenceOptions,
): Promise<{ survivors: ScoredIdea[]; eliminated: ScoredIdea[] }> {
  const { sessionId, ideas, rubric, model } = options;
  const db = getDb();

  const ideaSummary = ideas
    .map((idea) => `[${idea.id}] "${idea.name}" (${idea.persona}, ${idea.method}, p:${idea.probability}): ${idea.description}`)
    .join('\n\n');

  const rubricText = JSON.stringify(rubric, null, 2);

  const scored = await callLLMWithRetry(
    {
      model,
      system: `${CRITIC_SKILL}\n\nYou are in CONVERGENCE MODE. Filter and score ideas.`,
      prompt: `Evaluate these ${ideas.length} ideas against the rubric.

## Rubric
${rubricText}

## Ideas
${ideaSummary}

Instructions:
1. Check each idea against all gates. If ANY gate fails, eliminate the idea.
2. Score surviving ideas on each criterion (1-5).
3. Merge near-duplicates (note all source IDs).
4. Calculate weighted total scores.
5. Select the top 4-6 survivors.

Return a JSON array of ScoredIdea objects. Include ALL ideas (both survivors and eliminated).

Each object must have:
- id (string), sourceIds (string[]), name, description
- gateResults: [{gateId, pass: boolean, reason}]
- criteriaScores: [{criterionId, score: 1-5, reason}]
- totalScore (number)
- eliminated (boolean)
- eliminationReason (string, if eliminated)

Return ONLY the JSON array.`,
      outputSchema: scoredIdeaArrayJsonSchema,
      sessionId,
      agentName: 'Analyst',
    },
    (jsonStr) => {
      const parsed = JSON.parse(jsonStr);
      return z.array(ScoredIdeaSchema).parse(parsed);
    },
  );

  // Persist scored ideas
  for (const idea of scored) {
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

  const survivors = scored.filter((s) => !s.eliminated);
  const eliminated = scored.filter((s) => s.eliminated);

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: {
      agent: 'Analyst',
      text: `Convergence complete: ${survivors.length} survivors, ${eliminated.length} eliminated.`,
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
}

async function runEvolution(options: EvolutionOptions): Promise<ScoredIdea[]> {
  const { sessionId, survivors, rubric, coordinate, model } = options;
  const db = getDb();

  const survivorText = survivors
    .map(
      (s) =>
        `[${s.id}] "${s.name}" (score: ${s.totalScore}): ${s.description}\n  Weak scores: ${s.criteriaScores
          .filter((c) => c.score <= 2)
          .map((c) => `${c.criterionId}: ${c.score} (${c.reason})`)
          .join(', ')}`,
    )
    .join('\n\n');

  const evolved = await callLLMWithRetry(
    {
      model,
      system: `You are an idea evolution specialist. Your job is to improve surviving concepts by addressing weaknesses, reducing complexity, increasing delight, and merging strong features across candidates.`,
      prompt: `Evolve these ${survivors.length} concepts for the coordinate "${coordinate}":

${survivorText}

Rubric: ${JSON.stringify(rubric, null, 2)}

For each concept:
1. Address identified failure modes
2. Reduce cost/complexity where possible
3. Increase delight/differentiation
4. Strengthen weak criteria scores
5. Consider merging strong features from other candidates

Return the same ScoredIdea JSON array format with updated descriptions and re-scored criteria.
Each must retain the original id and sourceIds.

Return ONLY the JSON array.`,
      outputSchema: scoredIdeaArrayJsonSchema,
      sessionId,
      agentName: 'Analyst',
    },
    (jsonStr) => {
      const parsed = JSON.parse(jsonStr);
      return z.array(ScoredIdeaSchema).parse(parsed);
    },
  );

  // Persist evolved ideas
  for (const idea of evolved) {
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
    data: { agent: 'Analyst', text: `Evolution complete. ${evolved.length} concepts polished.` },
  });

  return evolved;
}

// ---- Phase D: QA ----

interface QAOptions {
  sessionId: string;
  concepts: ScoredIdea[];
  rubric: Rubric;
  model: string;
}

async function runQA(options: QAOptions): Promise<void> {
  const { sessionId, concepts, rubric, model } = options;
  const db = getDb();

  const conceptText = concepts
    .map((c) => `[${c.id}] "${c.name}" (score: ${c.totalScore}): ${c.description}`)
    .join('\n\n');

  const { QAResultSchema } = await import('@ideafactory/shared');

  const qaResults = await callLLMWithRetry(
    {
      model,
      system: `${CRITIC_SKILL}\n\nYou are in QA MODE. Reality-check evolved concepts.`,
      prompt: `Perform QA critique on these ${concepts.length} evolved concepts:

${conceptText}

Rubric: ${JSON.stringify(rubric, null, 2)}

For each concept, provide:
1. feasibilityScore (1-5)
2. risks (3-6 per concept, with category, description, severity, optional mitigation)
3. verdict: "strong", "conditional", or "weak"
4. summary: 1-2 sentence assessment

NOT all concepts should get "strong". Be genuinely critical and discriminating.

Return a JSON array of QAResult objects with conceptId matching the concept IDs above.
Return ONLY the JSON array.`,
      outputSchema: qaResultArrayJsonSchema,
      sessionId,
      agentName: 'Analyst',
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
    data: { agent: 'Analyst', text: 'QA critique complete.' },
  });
}
