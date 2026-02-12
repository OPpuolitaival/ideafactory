import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MethodRecommendationSchema, RubricSchema } from '@ideafactory/shared';
import type { Method } from '@ideafactory/shared';
import { callLLMWithRetry } from './llm.js';
import { coerceAndParse } from './coerce.js';
import { methodRecommendationJsonSchema, rubricJsonSchema } from './schemas.js';
import { sseManager } from '../sse/index.js';
import { getDb, schema } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METHOD_SELECTOR_SKILL = fs.readFileSync(
  path.join(__dirname, '../skills/method-selector/SKILL.md'),
  'utf-8',
);
const RUBRIC_DESIGNER_SKILL = fs.readFileSync(
  path.join(__dirname, '../skills/rubric-designer/SKILL.md'),
  'utf-8',
);

interface RunMethodSelectionOptions {
  sessionId: string;
  coordinate: string;
  methods: Method[];
  model: string;
  signal?: AbortSignal;
}

export async function runMethodSelection(options: RunMethodSelectionOptions): Promise<void> {
  const { sessionId, coordinate, methods, model } = options;

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Strategist', text: `Analyzing coordinate "${coordinate}" for method selection...`, model },
  });

  const methodList = methods
    .map((m) => `- ID ${m.id}: **${m.name}** — ${m.description}. Good for: ${m.goodFor}`)
    .join('\n');

  const methodIds = methods.map((m) => m.id);

  const recommendation = await callLLMWithRetry(
    {
      model,
      system: METHOD_SELECTOR_SKILL,
      timeoutMs: 120_000,
      signal: options.signal,
      prompt: `The user has selected this coordinate in the taxonomy: "${coordinate}"

Available methods:
${methodList}

Recommend 3-5 methods and provide reasoning for each.

You MUST return a JSON object with exactly this structure:
{
  "recommended": [${methodIds.slice(0, 3).join(', ')}],
  "reasoning": {
    "${methodIds[0]}": "Why this method fits the coordinate...",
    "${methodIds[1]}": "Why this method fits the coordinate...",
    "${methodIds[2]}": "Why this method fits the coordinate..."
  }
}

Field descriptions:
- "recommended": an array of 3-5 method ID numbers (integers) from the list above
- "reasoning": an object where each key is a method ID (as a string) and the value is a 1-2 sentence explanation

Return ONLY the JSON object. No markdown, no code blocks, no extra text.`,
      outputSchema: methodRecommendationJsonSchema,
      sessionId,
      agentName: 'Strategist',
    },
    (jsonStr) => coerceAndParse(jsonStr, MethodRecommendationSchema),
  );

  // Persist to database
  const db = getDb();
  await db.insert(schema.methodSelections).values({
    sessionId,
    recommended: JSON.stringify(recommendation.recommended),
    reasoning: JSON.stringify(recommendation.reasoning),
    selected: JSON.stringify(recommendation.recommended), // default selection = recommended
  });

  // Emit to client
  sseManager.emit(sessionId, {
    type: 'data:methods_recommended',
    data: recommendation,
  });

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Strategist', text: 'Method recommendations ready.', model },
  });
}

interface RunRubricDesignOptions {
  sessionId: string;
  coordinate: string;
  domain: string;
  methods: Method[];
  model: string;
  signal?: AbortSignal;
}

export async function runRubricDesign(options: RunRubricDesignOptions): Promise<void> {
  const { sessionId, coordinate, domain, methods, model } = options;

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Strategist', text: `Designing rubric for "${coordinate}"...`, model },
  });

  const methodNames = methods.map((m) => m.name).join(', ');

  const rubric = await callLLMWithRetry(
    {
      model,
      system: RUBRIC_DESIGNER_SKILL,
      timeoutMs: 120_000,
      signal: options.signal,
      prompt: `Design an evaluation rubric for ideas in this problem space:

Domain: "${domain}"
Coordinate: "${coordinate}"
Selected Methods: ${methodNames}

The rubric must be domain-aware but idea-agnostic (you're defining success BEFORE ideas are generated).

You MUST return a JSON object with exactly this structure:
{
  "gates": [
    { "id": "g1", "text": "Must be physically possible" },
    { "id": "g2", "text": "Must not violate regulations" }
  ],
  "criteria": [
    { "id": "c1", "text": "Feasibility", "weight": 4, "description": "1=impossible; 5=trivial to build" },
    { "id": "c2", "text": "Novelty", "weight": 3, "description": "1=already exists; 5=never been done" }
  ],
  "tests": [
    { "id": "t1", "text": "Build a prototype and test with 5 users" }
  ]
}

Requirements:
- "gates": array of 3-5 objects, each with "id" (string like "g1") and "text" (string)
- "criteria": array of 5-8 objects, each with "id" (string like "c1"), "text" (string), "weight" (integer 1-5), and "description" (string explaining 1 vs 5)
- "tests": array of 3-5 objects, each with "id" (string like "t1") and "text" (string)

Return ONLY the JSON object. No markdown, no code blocks, no extra text.`,
      outputSchema: rubricJsonSchema,
      sessionId,
      agentName: 'Strategist',
    },
    (jsonStr) => coerceAndParse(jsonStr, RubricSchema),
  );

  // Persist to database
  const db = getDb();
  await db.insert(schema.rubrics).values({
    sessionId,
    rubric: JSON.stringify(rubric),
  });

  // Emit to client
  sseManager.emit(sessionId, {
    type: 'data:rubric_generated',
    data: rubric,
  });

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Strategist', text: 'Rubric design complete.', model },
  });
}
