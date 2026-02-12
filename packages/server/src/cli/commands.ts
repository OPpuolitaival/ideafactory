import { parseArgs } from 'node:util';
import { getDb, schema } from '../db/index.js';
import { loadConfig } from '../config/index.js';
import { runPipeline } from '../agents/pipeline.js';
import { sseManager } from '../sse/index.js';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import type { Stage, SSEEvent } from '@ideafactory/shared';
import { STAGE_ORDER } from '@ideafactory/shared';

export async function runCommand(command: string | undefined, args: string[]): Promise<void> {
  switch (command) {
    case 'run':
      return cmdRun(args);
    case 'sessions':
      return cmdSessions(args);
    case 'stage':
      return cmdStage(args);
    case 'export':
      return cmdExport(args);
    case 'config':
      return cmdConfig(args);
    case 'server':
      return cmdServer(args);
    case undefined:
    case '--help':
    case '-h':
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
ideafactory - AI-powered ideation pipeline

Commands:
  run                    Start a new interactive session
  sessions <subcommand>  Manage sessions (list, get, copy, delete)
  stage <name>           Run a single stage (for testing)
  export <session-id>    Export a completed session
  config <subcommand>    Manage configuration (show, set)
  server                 Start the web server

Run 'ideafactory <command> --help' for details.
`);
}

// ---- run ----

async function cmdRun(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      domain: { type: 'string' },
      coordinate: { type: 'string' },
      methods: { type: 'string' },
      output: { type: 'string', default: 'text' },
      'web-search': { type: 'boolean', default: false },
      'auto-accept-rubric': { type: 'boolean', default: false },
      'stop-at': { type: 'string' },
    },
    strict: false,
  });

  const config = loadConfig();

  const domain = values.domain as string;
  if (!domain) {
    console.error('--domain is required');
    process.exit(1);
  }

  const outputFormat = (values.output as string) ?? 'text';
  const isQuiet = outputFormat === 'quiet';
  const isJSON = outputFormat === 'json';

  const db = getDb();
  const sessionId = nanoid(12);
  const now = Date.now();

  const sessionConfig = {
    ideasPerWorker: config.defaults.ideasPerWorker,
    webSearch: values['web-search'] as boolean,
  };

  await db.insert(schema.sessions).values({
    id: sessionId,
    domain,
    status: 'taxonomy',
    createdAt: now,
    updatedAt: now,
    config: JSON.stringify(sessionConfig),
  });

  // Set up event listener for streaming output
  if (!isQuiet && !isJSON) {
    sseManager.subscribe(sessionId, (event: SSEEvent) => {
      if (event.type === 'agent:thought') {
        console.log(`[${event.data.agent}] ${event.data.text}`);
      } else if (event.type === 'status:error') {
        console.error(`ERROR [${event.data.stage}]: ${event.data.error}`);
      } else if (event.type === 'status:stage_complete') {
        console.log(`\n--- Stage ${event.data.stage} complete ---\n`);
      }
    });
  }

  // Stage 1: Taxonomy
  if (!isQuiet) console.log(`Starting session: ${sessionId}`);
  if (!isQuiet) console.log(`Domain: "${domain}"\n`);

  await runPipeline(sessionId, 'taxonomy');

  if (values['stop-at'] === 'taxonomy') {
    return printSessionOutput(sessionId, outputFormat);
  }

  // If coordinate is pre-set, advance automatically
  if (values.coordinate) {
    const selectedPath = (values.coordinate as string).split('>').map((s) => s.trim());
    const coordinate = selectedPath.join(' > ');

    await db.update(schema.taxonomyTrees)
      .set({ selectedPath: JSON.stringify(selectedPath) })
      .where(eq(schema.taxonomyTrees.sessionId, sessionId));
    await db.update(schema.sessions)
      .set({ coordinate, status: 'methods', updatedAt: Date.now() })
      .where(eq(schema.sessions.id, sessionId));

    // Stage 2: Methods
    await runPipeline(sessionId, 'methods');

    if (values['stop-at'] === 'methods') {
      return printSessionOutput(sessionId, outputFormat);
    }

    // If methods are pre-set, advance
    if (values.methods) {
      const selectedMethods = (values.methods as string).split(',').map((s) => parseInt(s.trim(), 10));

      await db.update(schema.methodSelections)
        .set({ selected: JSON.stringify(selectedMethods) })
        .where(eq(schema.methodSelections.sessionId, sessionId));
      await db.update(schema.sessions)
        .set({ status: 'rubric', updatedAt: Date.now() })
        .where(eq(schema.sessions.id, sessionId));

      // Stage 3: Rubric
      await runPipeline(sessionId, 'rubric');

      if (values['stop-at'] === 'rubric') {
        return printSessionOutput(sessionId, outputFormat);
      }

      if (values['auto-accept-rubric']) {
        await db.update(schema.sessions)
          .set({ status: 'factory', updatedAt: Date.now() })
          .where(eq(schema.sessions.id, sessionId));

        // Stage 4: Factory
        await runPipeline(sessionId, 'factory');

        if (!isQuiet) {
          console.log(`\nFactory complete. Session ${sessionId} is now in interactive mode.`);
          console.log(`Use the web UI to run QA, package ideas, and complete the session.`);
        }
      }
    }
  }

  return printSessionOutput(sessionId, outputFormat);
}

// ---- sessions ----

async function cmdSessions(args: string[]): Promise<void> {
  const subcommand = args[0];
  const db = getDb();

  switch (subcommand) {
    case 'list': {
      const sessions = await db.select().from(schema.sessions).orderBy(schema.sessions.updatedAt);
      if (args.includes('--output') && args[args.indexOf('--output') + 1] === 'json') {
        console.log(JSON.stringify(sessions, null, 2));
      } else {
        if (sessions.length === 0) {
          console.log('No sessions found.');
          return;
        }
        for (const s of sessions.reverse()) {
          console.log(`${s.id}  ${s.domain.padEnd(30)}  ${s.status.padEnd(12)}  ${new Date(s.createdAt).toLocaleDateString()}`);
        }
      }
      break;
    }

    case 'get': {
      const id = args[1];
      if (!id) { console.error('Usage: sessions get <id>'); process.exit(1); }
      const session = await getFullSession(id);
      const format = args.includes('--output') ? args[args.indexOf('--output') + 1] : 'json';
      if (format === 'json') {
        console.log(JSON.stringify(session, null, 2));
      } else {
        console.log(`Session: ${session.id}`);
        console.log(`Domain: ${session.domain}`);
        console.log(`Status: ${session.status}`);
        console.log(`Coordinate: ${session.coordinate ?? 'not set'}`);
      }
      break;
    }

    case 'copy': {
      const id = args[1];
      if (!id) { console.error('Usage: sessions copy <id>'); process.exit(1); }

      const [original] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
      if (!original) { console.error('Session not found'); process.exit(1); }

      const newId = nanoid(12);
      const now = Date.now();
      await db.insert(schema.sessions).values({ ...original, id: newId, createdAt: now, updatedAt: now });

      // Copy related data
      const [taxonomy] = await db.select().from(schema.taxonomyTrees).where(eq(schema.taxonomyTrees.sessionId, id));
      if (taxonomy) await db.insert(schema.taxonomyTrees).values({ ...taxonomy, sessionId: newId });

      const [methods] = await db.select().from(schema.methodSelections).where(eq(schema.methodSelections.sessionId, id));
      if (methods) await db.insert(schema.methodSelections).values({ ...methods, sessionId: newId });

      const [rubric] = await db.select().from(schema.rubrics).where(eq(schema.rubrics.sessionId, id));
      if (rubric) await db.insert(schema.rubrics).values({ ...rubric, sessionId: newId });

      const ideas = await db.select().from(schema.ideas).where(eq(schema.ideas.sessionId, id));
      for (const idea of ideas) {
        await db.insert(schema.ideas).values({ ...idea, id: nanoid(12), sessionId: newId });
      }

      const qaSheets = await db.select().from(schema.qaSheets).where(eq(schema.qaSheets.sessionId, id));
      for (const row of qaSheets) {
        await db.insert(schema.qaSheets).values({ ...row, id: nanoid(12), sessionId: newId });
      }

      const ideaPkgs = await db.select().from(schema.ideaPackages).where(eq(schema.ideaPackages.sessionId, id));
      for (const row of ideaPkgs) {
        await db.insert(schema.ideaPackages).values({ ...row, id: nanoid(12), sessionId: newId });
      }

      // Handle rollback
      const rollbackIdx = args.indexOf('--rollback-to');
      if (rollbackIdx !== -1) {
        const toStage = args[rollbackIdx + 1] as Stage;
        await rollbackSession(newId, toStage);
      }

      if (args.includes('--output') && args[args.indexOf('--output') + 1] === 'json') {
        console.log(JSON.stringify({ sessionId: newId }));
      } else {
        console.log(`Duplicated session: ${newId}`);
      }
      break;
    }

    case 'delete': {
      const id = args[1];
      if (!id) { console.error('Usage: sessions delete <id>'); process.exit(1); }
      await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
      console.log(`Deleted session: ${id}`);
      break;
    }

    case 'rollback': {
      const id = args[1];
      const toIdx = args.indexOf('--to');
      const toStage = toIdx !== -1 ? args[toIdx + 1] as Stage : undefined;
      if (!id || !toStage) { console.error('Usage: sessions rollback <id> --to <stage>'); process.exit(1); }
      await rollbackSession(id, toStage);
      console.log(`Rolled back session ${id} to ${toStage}`);
      break;
    }

    default:
      console.error('Usage: sessions [list|get|copy|delete|rollback]');
      process.exit(1);
  }
}

// ---- stage ----

async function cmdStage(args: string[]): Promise<void> {
  const stageName = args[0];
  const outputFormat = args.includes('--output') ? args[args.indexOf('--output') + 1] : 'json';

  const db = getDb();

  switch (stageName) {
    case 'taxonomy': {
      const domainIdx = args.indexOf('--domain');
      const domain = domainIdx !== -1 ? args[domainIdx + 1] : undefined;
      if (!domain) { console.error('--domain required'); process.exit(1); }

      const sessionId = nanoid(12);
      const now = Date.now();
      await db.insert(schema.sessions).values({
        id: sessionId,
        domain,
        status: 'taxonomy',
        createdAt: now,
        updatedAt: now,
        config: JSON.stringify({ ideasPerWorker: 15, webSearch: args.includes('--web-search') }),
      });

      await runPipeline(sessionId, 'taxonomy');

      const [taxonomy] = await db.select().from(schema.taxonomyTrees).where(eq(schema.taxonomyTrees.sessionId, sessionId));
      if (taxonomy) {
        console.log(outputFormat === 'json' ? taxonomy.tree : `Taxonomy for "${domain}" generated.`);
      }
      break;
    }

    default:
      console.error(`Stage "${stageName}" not yet implemented in CLI standalone mode.`);
      console.error('Use "ideafactory run" for full pipeline execution.');
      process.exit(1);
  }
}

// ---- export ----

async function cmdExport(args: string[]): Promise<void> {
  const sessionId = args[0];
  if (!sessionId) { console.error('Usage: export <session-id> --format [json]'); process.exit(1); }

  const formatIdx = args.indexOf('--format');
  const format = formatIdx !== -1 ? args[formatIdx + 1] : 'json';

  const session = await getFullSession(sessionId);

  switch (format) {
    case 'json':
      console.log(JSON.stringify(session, null, 2));
      break;

    default:
      console.error(`Unknown format: ${format}. Use json.`);
      process.exit(1);
  }
}

// ---- config ----

async function cmdConfig(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'show': {
      const config = loadConfig();
      console.log(JSON.stringify({
        defaults: config.defaults,
        models: config.models,
        server: config.server,
      }, null, 2));
      break;
    }

    case 'set': {
      const key = args[1];
      const value = args[2];
      if (!key || value === undefined) {
        console.error('Usage: config set <key> <value>');
        process.exit(1);
      }
      console.error(`Direct config key "${key}" editing not yet implemented. Edit ~/.ideafactory/config.yaml directly.`);
      break;
    }

    default:
      console.error('Usage: config [show|set]');
      process.exit(1);
  }
}

// ---- server ----

async function cmdServer(_args: string[]): Promise<void> {
  // Dynamic import to start the server
  await import('../index.js');
}

// ---- helpers ----

async function getFullSession(id: string) {
  const db = getDb();
  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
  if (!session) throw new Error('Session not found');

  const [taxonomy] = await db.select().from(schema.taxonomyTrees).where(eq(schema.taxonomyTrees.sessionId, id));
  const [methods] = await db.select().from(schema.methodSelections).where(eq(schema.methodSelections.sessionId, id));
  const [rubric] = await db.select().from(schema.rubrics).where(eq(schema.rubrics.sessionId, id));
  const ideas = await db.select().from(schema.ideas).where(eq(schema.ideas.sessionId, id));
  const qaSheets = await db.select().from(schema.qaSheets).where(eq(schema.qaSheets.sessionId, id));
  const ideaPackages = await db.select().from(schema.ideaPackages).where(eq(schema.ideaPackages.sessionId, id));

  return {
    ...session,
    taxonomy: taxonomy ?? null,
    methods: methods ?? null,
    rubric: rubric ?? null,
    ideas,
    qaSheets,
    ideaPackages,
  };
}

async function rollbackSession(id: string, toStage: Stage) {
  const db = getDb();
  const stageIdx = STAGE_ORDER.indexOf(toStage);

  if (stageIdx <= STAGE_ORDER.indexOf('taxonomy')) {
    await db.delete(schema.taxonomyTrees).where(eq(schema.taxonomyTrees.sessionId, id));
    await db.update(schema.sessions).set({ coordinate: null }).where(eq(schema.sessions.id, id));
  }
  if (stageIdx <= STAGE_ORDER.indexOf('methods')) {
    await db.delete(schema.methodSelections).where(eq(schema.methodSelections.sessionId, id));
  }
  if (stageIdx <= STAGE_ORDER.indexOf('rubric')) {
    await db.delete(schema.rubrics).where(eq(schema.rubrics.sessionId, id));
  }
  if (stageIdx <= STAGE_ORDER.indexOf('factory')) {
    await db.delete(schema.ideas).where(eq(schema.ideas.sessionId, id));
  }
  // Always clean QA sheets and packages on rollback
  await db.delete(schema.qaSheets).where(eq(schema.qaSheets.sessionId, id));
  await db.delete(schema.ideaPackages).where(eq(schema.ideaPackages.sessionId, id));

  await db.update(schema.sessions).set({ status: toStage, updatedAt: Date.now() }).where(eq(schema.sessions.id, id));
}

async function printSessionOutput(sessionId: string, format: string) {
  if (format === 'json') {
    const session = await getFullSession(sessionId);
    console.log(JSON.stringify(session, null, 2));
  }
}
