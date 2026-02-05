import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MethodRecommendationSchema, RubricSchema } from '@ideafactory/shared';
import type { Method } from '@ideafactory/shared';
import { callLLMWithRetry } from './llm.js';
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
  apiKey: string;
  model: string;
}

export async function runMethodSelection(options: RunMethodSelectionOptions): Promise<void> {
  const { sessionId, coordinate, methods, apiKey, model } = options;

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Strategist', text: `Analyzing coordinate "${coordinate}" for method selection...` },
  });

  const methodList = methods
    .map((m) => `- ID ${m.id}: **${m.name}** — ${m.description}. Good for: ${m.goodFor}`)
    .join('\n');

  const recommendation = await callLLMWithRetry(
    {
      apiKey,
      model,
      system: METHOD_SELECTOR_SKILL,
      prompt: `The user has selected this coordinate in the taxonomy: "${coordinate}"

Available methods:
${methodList}

Recommend 3-5 methods and provide reasoning for each. Return ONLY the JSON object.`,
      temperature: 0.6,
      maxTokens: 4096,
      sessionId,
      agentName: 'Strategist',
    },
    (jsonStr) => {
      const parsed = JSON.parse(jsonStr);
      return MethodRecommendationSchema.parse(parsed);
    },
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
    data: { agent: 'Strategist', text: 'Method recommendations ready.' },
  });
}

interface RunRubricDesignOptions {
  sessionId: string;
  coordinate: string;
  domain: string;
  methods: Method[];
  apiKey: string;
  model: string;
}

export async function runRubricDesign(options: RunRubricDesignOptions): Promise<void> {
  const { sessionId, coordinate, domain, methods, apiKey, model } = options;

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Strategist', text: `Designing rubric for "${coordinate}"...` },
  });

  const methodNames = methods.map((m) => m.name).join(', ');

  const rubric = await callLLMWithRetry(
    {
      apiKey,
      model,
      system: RUBRIC_DESIGNER_SKILL,
      prompt: `Design an evaluation rubric for ideas in this problem space:

Domain: "${domain}"
Coordinate: "${coordinate}"
Selected Methods: ${methodNames}

The rubric must be domain-aware but idea-agnostic (you're defining success BEFORE ideas are generated).

Requirements:
- 3-5 hard gates (binary pass/fail)
- 5-8 scored criteria (weighted 1-5)
- 3-5 verification tests

Return ONLY the JSON object.`,
      temperature: 0.6,
      maxTokens: 4096,
      sessionId,
      agentName: 'Strategist',
    },
    (jsonStr) => {
      const parsed = JSON.parse(jsonStr);
      return RubricSchema.parse(parsed);
    },
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
    data: { agent: 'Strategist', text: 'Rubric design complete.' },
  });
}
