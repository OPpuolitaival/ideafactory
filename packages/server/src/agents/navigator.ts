import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TaxonomyNodeSchema } from '@ideafactory/shared';
import { callLLMWithRetry } from './llm.js';
import { taxonomyJsonSchema } from './schemas.js';
import { sseManager } from '../sse/index.js';
import { getDb, schema } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MD = fs.readFileSync(
  path.join(__dirname, '../skills/taxonomy/SKILL.md'),
  'utf-8',
);

interface RunTaxonomyOptions {
  sessionId: string;
  domain: string;
  webSearch: boolean;
  model: string;
  signal?: AbortSignal;
}

export async function runTaxonomy(options: RunTaxonomyOptions): Promise<void> {
  const { sessionId, domain, model } = options;

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Navigator', text: `Mapping the problem space for: "${domain}"`, model },
  });

  const taxonomy = await callLLMWithRetry(
    {
      model,
      system: SKILL_MD,
      timeoutMs: 120_000,
      signal: options.signal,
      prompt: `Generate a comprehensive MECE taxonomy tree for the domain: "${domain}"

Remember:
- 8-15 top-level categories
- 4-10 subcategories each
- At least 2 levels of depth
- All three probability levels (high, medium, low) represented
- Full-distribution sampling: include obvious, mainstream, AND niche/speculative categories

You MUST return a JSON object with this recursive structure:
{
  "name": "${domain}",
  "p": "high",
  "children": [
    {
      "name": "Category Name",
      "p": "high",
      "children": [
        { "name": "Subcategory", "p": "medium", "children": [] }
      ]
    }
  ]
}

Each node has: "name" (string), "p" ("high", "medium", or "low"), and optionally "children" (array of nodes).

Return ONLY the JSON object. No markdown, no code blocks, no extra text.`,
      outputSchema: taxonomyJsonSchema,
      sessionId,
      agentName: 'Navigator',
    },
    (jsonStr) => {
      const parsed = JSON.parse(jsonStr);
      return TaxonomyNodeSchema.parse(parsed);
    },
  );

  // Persist to database
  const db = getDb();
  await db.insert(schema.taxonomyTrees).values({
    sessionId,
    tree: JSON.stringify(taxonomy),
    selectedPath: null,
  });

  // Emit to client
  sseManager.emit(sessionId, {
    type: 'data:taxonomy_update',
    data: taxonomy,
  });

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Navigator', text: 'Taxonomy generation complete.', model },
  });
}
