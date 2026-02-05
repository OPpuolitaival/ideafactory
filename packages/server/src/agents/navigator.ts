import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TaxonomyNodeSchema } from '@ideafactory/shared';
import { callLLMWithRetry } from './llm.js';
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
  apiKey: string;
  model: string;
}

export async function runTaxonomy(options: RunTaxonomyOptions): Promise<void> {
  const { sessionId, domain, apiKey, model } = options;

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Navigator', text: `Mapping the problem space for: "${domain}"` },
  });

  const taxonomy = await callLLMWithRetry(
    {
      apiKey,
      model,
      system: SKILL_MD,
      prompt: `Generate a comprehensive MECE taxonomy tree for the domain: "${domain}"

Remember:
- 8-15 top-level categories
- 4-10 subcategories each
- At least 2 levels of depth
- All three probability levels (high, medium, low) represented
- Full-distribution sampling: include obvious, mainstream, AND niche/speculative categories

Return ONLY the JSON object. No additional text.`,
      temperature: 0.7,
      maxTokens: 16384,
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
    data: { agent: 'Navigator', text: 'Taxonomy generation complete.' },
  });
}
