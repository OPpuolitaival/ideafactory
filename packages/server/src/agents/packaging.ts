import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { IdeaPackageSchema } from '@ideafactory/shared';
import { callLLMWithRetry } from './llm.js';
import { coerceAndParse } from './coerce.js';
import { ideaPackageJsonSchema } from './schemas.js';
import { sseManager } from '../sse/index.js';
import { getDb, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { getLocaleInstruction } from './locale.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGING_SKILL = fs.readFileSync(
  path.join(__dirname, '../skills/packaging/SKILL.md'),
  'utf-8',
);

interface PackageIdeasOptions {
  sessionId: string;
  ideaIds: string[];
  domain: string;
  coordinate: string;
  model: string;
  signal?: AbortSignal;
  locale?: string;
}

export async function packageIdeas(options: PackageIdeasOptions): Promise<void> {
  const { sessionId, ideaIds, domain, coordinate, model, signal, locale } = options;
  const db = getDb();
  const localeInstr = getLocaleInstruction(locale);

  // Fetch ideas
  const allIdeas = await db
    .select()
    .from(schema.ideas)
    .where(eq(schema.ideas.sessionId, sessionId));

  const selectedIdeas = allIdeas.filter((i) => ideaIds.includes(i.id));

  // Fetch QA sheets for these ideas
  const allQaSheets = await db
    .select()
    .from(schema.qaSheets)
    .where(eq(schema.qaSheets.sessionId, sessionId));

  if (selectedIdeas.length === 0) {
    throw new Error('No matching ideas found');
  }

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: `Packaging ${selectedIdeas.length} ideas...`, model },
  });

  sseManager.emit(sessionId, {
    type: 'factory:progress',
    data: { phase: 'packaging', detail: `Packaging ${selectedIdeas.length} ideas...`, workersTotal: selectedIdeas.length, workersDone: 0 },
  });

  let done = 0;

  const settled = await Promise.allSettled(
    selectedIdeas.map(async (idea) => {
      const ideaData = idea.data ? JSON.parse(idea.data) : {};
      const description = ideaData.description || idea.description;
      const qaSheet = allQaSheets.find((q) => q.ideaId === idea.id);

      const qaInfo = qaSheet
        ? `\n\nQA Results:\n- Feasibility: ${qaSheet.feasibilityScore}/5\n- Verdict: ${qaSheet.verdict}\n- Summary: ${qaSheet.summary}\n- Risks: ${qaSheet.risks}`
        : '\n\n(No QA data available for this idea)';

      const pkg = await callLLMWithRetry(
        {
          model,
          system: PACKAGING_SKILL + localeInstr,
          prompt: `Package this idea for delivery.

Domain: "${domain}"
Coordinate: "${coordinate}"
Idea ID: "${idea.id}"
Idea Name: "${idea.name}"
Score: ${idea.score ?? 'N/A'}
Description: ${description}${qaInfo}

Return a single JSON object with ideaId, ideaName, htmlContent, and deepResearchPrompt.`,
          outputSchema: ideaPackageJsonSchema,
          sessionId,
          agentName: 'Analyst',
          timeoutMs: 180_000,
          signal,
        },
        (jsonStr) => coerceAndParse(jsonStr, IdeaPackageSchema),
      );

      // Persist to idea_packages
      await db.insert(schema.ideaPackages).values({
        id: nanoid(12),
        sessionId,
        ideaId: idea.id,
        ideaName: pkg.ideaName,
        htmlContent: pkg.htmlContent,
        deepResearchPrompt: pkg.deepResearchPrompt,
        createdAt: Date.now(),
      });

      // Emit per-idea package
      sseManager.emit(sessionId, {
        type: 'data:idea_package',
        data: pkg,
      });

      done++;
      sseManager.emit(sessionId, {
        type: 'factory:progress',
        data: { phase: 'packaging', detail: `Packaged ${done}/${selectedIdeas.length} ideas`, workersTotal: selectedIdeas.length, workersDone: done },
      });

      return pkg;
    }),
  );

  const successes = settled.filter((r) => r.status === 'fulfilled').length;
  const failures = settled.filter((r) => r.status === 'rejected').length;

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: {
      agent: 'Analyst',
      text: `Packaging complete. ${successes} succeeded, ${failures} failed.`,
      model,
    },
  });
}
