import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TaxonomyNodeSchema } from '@ideafactory/shared';
import type { TaxonomyNode } from '@ideafactory/shared';
import { callLLMWithRetry } from './llm.js';
import { coerceAndParse } from './coerce.js';
import { taxonomyJsonSchema } from './schemas.js';
import { sseManager } from '../sse/index.js';
import { getDb, schema } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MD = fs.readFileSync(
  path.join(__dirname, '../skills/taxonomy/SKILL.md'),
  'utf-8',
);
const BRANCH_EXPANSION_MD = fs.readFileSync(
  path.join(__dirname, '../skills/taxonomy/BRANCH_EXPANSION.md'),
  'utf-8',
);

/** Max branches to expand in parallel */
const BRANCH_CONCURRENCY = 10;

interface RunTaxonomyOptions {
  sessionId: string;
  domain: string;
  webSearch: boolean;
  model: string;
  signal?: AbortSignal;
}

/**
 * Phase 1: Generate only the skeleton — root + top-level category names with empty children.
 */
async function generateSkeleton(
  domain: string,
  model: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<TaxonomyNode> {
  return callLLMWithRetry(
    {
      model,
      system: SKILL_MD,
      timeoutMs: 60_000,
      signal,
      prompt: `Generate ONLY the top-level skeleton for the domain: "${domain}"

You must return a JSON object with the root node and 8-15 top-level categories.
Each top-level category should have an EMPTY children array — do NOT generate subcategories yet.

Example structure:
{
  "name": "${domain}",
  "p": "high",
  "children": [
    { "name": "Category 1", "p": "high", "children": [] },
    { "name": "Category 2", "p": "medium", "children": [] },
    { "name": "Category 3", "p": "low", "children": [] }
  ]
}

Requirements:
- 8-15 top-level categories covering the full problem space
- All three probability levels (high, medium, low) represented
- Categories should be MECE (Mutually Exclusive, Collectively Exhaustive)
- Full-distribution sampling: include obvious, mainstream, AND niche/speculative categories
- Each category has EMPTY children array — subcategories will be generated separately

Return ONLY the JSON object. No markdown, no code blocks, no extra text.`,
      outputSchema: taxonomyJsonSchema,
      sessionId,
      agentName: 'Navigator',
    },
    (jsonStr) => coerceAndParse(jsonStr, TaxonomyNodeSchema),
  );
}

/**
 * Phase 2: Expand a single top-level category into its subcategory tree.
 */
async function expandBranch(
  domain: string,
  category: TaxonomyNode,
  siblingNames: string[],
  model: string,
  sessionId: string,
  index: number,
  total: number,
  signal?: AbortSignal,
): Promise<TaxonomyNode> {
  const siblingsStr = siblingNames
    .filter((n) => n !== category.name)
    .map((n) => `- ${n}`)
    .join('\n');

  const branchAgent = `Navigator ${index + 1}`;

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: {
      agent: branchAgent,
      text: `Expanding branch ${index + 1}/${total}: "${category.name}"`,
      model,
    },
  });

  return callLLMWithRetry(
    {
      model,
      system: BRANCH_EXPANSION_MD,
      timeoutMs: 90_000,
      signal,
      prompt: `Domain: "${domain}"
Category to expand: "${category.name}" (probability: ${category.p})

Sibling categories (for MECE awareness — do NOT overlap with these):
${siblingsStr}

Generate 4-10 subcategories for "${category.name}" with at least 2 levels of depth.

You MUST return a JSON object:
{
  "name": "${category.name}",
  "p": "${category.p}",
  "children": [
    {
      "name": "Subcategory Name",
      "p": "high",
      "children": [
        { "name": "Sub-subcategory", "p": "medium", "children": [] }
      ]
    }
  ]
}

Return ONLY the JSON object. No markdown, no code blocks, no extra text.`,
      outputSchema: taxonomyJsonSchema,
      sessionId,
      agentName: branchAgent,
    },
    (jsonStr) => coerceAndParse(jsonStr, TaxonomyNodeSchema),
  );
}

/**
 * Process an array of items in chunks of `concurrency`, running each chunk in parallel.
 * Calls `onChunkDone` after each chunk with the accumulated results so far.
 */
async function processInChunks<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onChunkDone?: (results: (R | null)[]) => void,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(
      chunk.map((item, j) => fn(item, i + j)),
    );
    for (let j = 0; j < chunkResults.length; j++) {
      const result = chunkResults[j];
      results[i + j] = result.status === 'fulfilled' ? result.value : null;
    }
    onChunkDone?.(results);
  }
  return results;
}

export async function runTaxonomy(options: RunTaxonomyOptions): Promise<void> {
  const { sessionId, domain, model } = options;

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Navigator', text: `Mapping the problem space for: "${domain}"`, model },
  });

  // ── Phase 1: Skeleton ──
  const skeleton = await generateSkeleton(domain, model, sessionId, options.signal);
  const topLevelCategories = skeleton.children ?? [];

  if (topLevelCategories.length === 0) {
    throw new Error('Taxonomy skeleton has no top-level categories');
  }

  // Emit skeleton immediately so the UI can show top-level categories
  sseManager.emit(sessionId, {
    type: 'data:taxonomy_update',
    data: skeleton,
  });

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: {
      agent: 'Navigator',
      text: `Skeleton generated with ${topLevelCategories.length} top-level categories. Expanding branches...`,
      model,
    },
  });

  // ── Phase 2: Branch expansion ──
  const siblingNames = topLevelCategories.map((c) => c.name);

  const expandedBranches = await processInChunks(
    topLevelCategories,
    BRANCH_CONCURRENCY,
    async (category, index) => {
      return expandBranch(
        domain,
        category,
        siblingNames,
        model,
        sessionId,
        index,
        topLevelCategories.length,
        options.signal,
      );
    },
    (partialResults) => {
      // Emit progressive tree after each chunk so the UI shows branches growing
      const partialChildren: TaxonomyNode[] = topLevelCategories.map((original, i) => {
        const expanded = partialResults[i];
        if (expanded && expanded.children && expanded.children.length > 0) {
          return { ...original, children: expanded.children };
        }
        return original;
      });
      sseManager.emit(sessionId, {
        type: 'data:taxonomy_update',
        data: { ...skeleton, children: partialChildren },
      });
    },
  );

  // Assemble final tree: merge expanded branches into skeleton
  const assembledChildren: TaxonomyNode[] = topLevelCategories.map((original, i) => {
    const expanded = expandedBranches[i];
    if (expanded && expanded.children && expanded.children.length > 0) {
      return { ...original, children: expanded.children };
    }
    // Failed branch stays as a leaf node
    return original;
  });

  const successCount = expandedBranches.filter((b) => b !== null).length;
  const failureCount = topLevelCategories.length - successCount;

  if (successCount < Math.ceil(topLevelCategories.length * 0.5)) {
    throw new Error(
      `Taxonomy branch expansion failed: only ${successCount}/${topLevelCategories.length} branches expanded successfully (need at least 50%)`,
    );
  }

  if (failureCount > 0) {
    sseManager.emit(sessionId, {
      type: 'agent:thought',
      data: {
        agent: 'Navigator',
        text: `${failureCount} branch(es) failed to expand and will remain as leaf nodes.`,
        model,
      },
    });
  }

  const taxonomy: TaxonomyNode = {
    ...skeleton,
    children: assembledChildren,
  };

  // Persist to database
  const db = getDb();
  await db.insert(schema.taxonomyTrees).values({
    sessionId,
    tree: JSON.stringify(taxonomy),
    selectedPath: null,
  });

  // Emit final assembled tree to client
  sseManager.emit(sessionId, {
    type: 'data:taxonomy_update',
    data: taxonomy,
  });

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Navigator', text: 'Taxonomy generation complete.', model },
  });
}
