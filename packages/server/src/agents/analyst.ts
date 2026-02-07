import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { OutputPackageSchema, VisualArtifactSchema } from '@ideafactory/shared';
import type { Method } from '@ideafactory/shared';
import { callLLMWithRetry } from './llm.js';
import { outputPackageJsonSchema, visualArtifactArrayJsonSchema } from './schemas.js';
import { sseManager } from '../sse/index.js';
import { getDb, schema } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTING_SKILL = fs.readFileSync(
  path.join(__dirname, '../skills/reporting/SKILL.md'),
  'utf-8',
);

interface RunOutputOptions {
  sessionId: string;
  domain: string;
  coordinate: string;
  methods: Method[];
  ideas: Array<{
    id: string;
    name: string;
    description: string;
    phase: string;
    score: number | null;
    eliminated: number | null;
    data: string | null;
  }>;
  model: string;
  signal?: AbortSignal;
}

export async function runOutput(options: RunOutputOptions): Promise<void> {
  const { sessionId, domain, coordinate, methods, ideas, model } = options;
  const db = getDb();

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: 'Packaging final output...', model },
  });

  // Gather data from ideas
  const divergeIdeas = ideas.filter((i) => i.phase === 'diverge');
  const evolvedIdeas = ideas.filter((i) => i.phase === 'evolve');
  const qaResults = ideas.filter((i) => i.phase === 'qa');

  const evolvedData = evolvedIdeas
    .map((i) => {
      const data = i.data ? JSON.parse(i.data) : {};
      return `[${data.id || i.id}] "${i.name}" (score: ${i.score}): ${i.description}`;
    })
    .join('\n\n');

  const qaData = qaResults
    .map((i) => {
      const data = i.data ? JSON.parse(i.data) : {};
      return `Concept ${data.conceptId}: verdict=${data.verdict}, feasibility=${data.feasibilityScore}, risks=${data.risks?.length || 0}`;
    })
    .join('\n');

  const methodNames = methods.map((m) => m.name);

  // Generate output package
  const outputPackage = await callLLMWithRetry(
    {
      model,
      system: REPORTING_SKILL,
      timeoutMs: 600_000,
      signal: options.signal,
      prompt: `Package the final output for this ideation session.

## Session Info
- Domain: "${domain}"
- Coordinate: "${coordinate}"
- Methods: ${methodNames.join(', ')}
- Methods used: ${methods.length}
- Total ideas generated: ${divergeIdeas.length}
- Total ideas survived to evolution: ${evolvedIdeas.length}

## Evolved Concepts
${evolvedData}

## QA Results
${qaData}

Produce the OutputPackage JSON with:
1. Ranked concept cards (best first) with pros, cons, open questions, next steps, QA verdict
2. Overall insights paragraph
3. Suggested next sprint actions
4. Session metadata

Return ONLY the JSON object matching the OutputPackage schema.`,
      outputSchema: outputPackageJsonSchema,
      sessionId,
      agentName: 'Analyst',
    },
    (jsonStr) => {
      const parsed = JSON.parse(jsonStr);
      return OutputPackageSchema.parse(parsed);
    },
  );

  // Generate visual artifacts
  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: 'Generating visual artifacts...', model },
  });

  const artifacts = await callLLMWithRetry(
    {
      model,
      system: REPORTING_SKILL,
      timeoutMs: 600_000,
      signal: options.signal,
      prompt: `Generate visual artifacts for the output package.

## Concepts
${outputPackage.concepts.map((c) => `${c.rank}. "${c.name}": ${c.description}`).join('\n')}

## Criteria (for radar chart axes)
${methods.map((m) => m.name).join(', ')}

Generate a JSON array of VisualArtifact objects:

1. A radar_chart (SVG): Multi-axis chart comparing concepts across criteria dimensions. Dark background #12121a, colored polygons per concept, axis labels, legend.

2. One concept_sketch (SVG) per concept: Simple schematic/diagram style. Boxes, arrows, labels. Dark background, light strokes. Abstract representation of the core idea.

3. A report_page (HTML): Self-contained single-file HTML with all concept cards, inline radar chart SVG, concept sketches, insights, metadata. Dark theme (#0a0a0f background). No external dependencies.

Each artifact: { type, format, content (raw SVG/HTML string), label }

Return ONLY the JSON array.`,
      outputSchema: visualArtifactArrayJsonSchema,
      sessionId,
      agentName: 'Analyst',
    },
    (jsonStr) => {
      const parsed = JSON.parse(jsonStr);
      return z.array(VisualArtifactSchema).parse(parsed);
    },
  );

  // Persist
  await db.insert(schema.outputPackages).values({
    sessionId,
    package: JSON.stringify(outputPackage),
    artifacts: JSON.stringify(artifacts),
  });

  // Emit to client
  sseManager.emit(sessionId, {
    type: 'data:output_package',
    data: outputPackage,
  });

  sseManager.emit(sessionId, {
    type: 'agent:thought',
    data: { agent: 'Analyst', text: 'Output packaging complete.', model },
  });
}
