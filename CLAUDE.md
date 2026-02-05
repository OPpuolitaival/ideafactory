# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm dev                          # Start all packages in parallel (server:3000, client:5173)
pnpm run --filter server cli      # Run CLI: pnpm run --filter server cli -- run "domain"

# Build & Typecheck
pnpm build                        # Build all packages
pnpm typecheck                    # Typecheck all packages

# Testing (vitest workspace with projects: shared, server, client)
pnpm test                         # Run all tests once
pnpm test:server                  # Run server tests only
pnpm test:client                  # Run client tests only
pnpm test:shared                  # Run shared tests only
pnpm vitest run path/to/file      # Run a single test file

# Linting
pnpm lint                         # ESLint (flat config, ESLint 9)
```

## Architecture

IdeaFactory is an AI-powered ideation pipeline that uses Claude to generate, evaluate, evolve, and package creative ideas. It is a **pnpm monorepo** with three packages.

### Package Dependency Graph

```
@ideafactory/shared          ← Zod schemas, constants, types (leaf package)
    ↑             ↑
@ideafactory/server          @ideafactory/client
(Hono + tRPC + SQLite +      (React 19 + Vite + Tailwind +
 Anthropic SDK + CLI)          Zustand + tRPC client)
```

The client imports only the `AppRouter` **type** from server (devDependency) for tRPC type safety. No runtime server code is imported by the client.

### Communication

- **tRPC** (`/trpc/*`): Client↔Server RPC for mutations and queries. Uses `superjson` transformer and `httpBatchLink`. Vite proxies `/trpc` and `/api` to `localhost:3000` in dev.
- **SSE** (`/api/session/:id/stream`): Server→Client real-time events during pipeline execution. The Zustand store's `handleSSEEvent()` dispatches all 11 SSE event types.

### Pipeline Stages

The system follows a staged pipeline orchestrated in `packages/server/src/agents/pipeline.ts`:

```
taxonomy → methods → rubric → factory → output → completed
```

| Stage | Agent | Model (default) | Temp | Key File |
|-------|-------|-----------------|------|----------|
| Taxonomy | Navigator | claude-haiku-4 | 0.7 | `agents/navigator.ts` |
| Methods | Strategist | claude-sonnet-4 | 0.6 | `agents/strategist.ts` |
| Rubric | Strategist | claude-sonnet-4 | 0.6 | `agents/strategist.ts` |
| Factory | Workers + Analyst | claude-sonnet-4 | 0.5–0.9 | `agents/factory.ts` |
| Output | Analyst | claude-sonnet-4 | 0.4 | `agents/analyst.ts` |

The Factory stage has four sequential sub-phases: **Diverge** (N parallel workers with distinct personas, temp=0.9) → **Converge** (score/gate/merge, temp=0.5) → **Evolve** (refine survivors, temp=0.7) → **QA** (feasibility/risk, temp=0.5).

### Agent System

- Each agent uses a **skill markdown file** from `packages/server/src/skills/` as its system prompt, loaded via `fs.readFileSync` at module init.
- LLM calls go through `packages/server/src/agents/llm.ts` which provides `callLLM()`, `callLLMWithRetry()` (with Zod validation, exponential backoff for 429s, JSON repair on retries), and `extractJSON()`.
- Models are configurable per role via `~/.ideafactory/config.yaml`.

### Data Layer

- **SQLite** via better-sqlite3 + drizzle-orm, stored at `~/.ideafactory/data.db`
- 6 tables: `sessions`, `taxonomy_trees`, `method_selections`, `rubrics`, `ideas`, `output_packages`
- Schema defined in `packages/server/src/db/schema.ts`, inline migrations (CREATE TABLE IF NOT EXISTS)

### Client Architecture

- **Zustand** store (`packages/client/src/store/index.ts`) holds all session state and dispatches SSE events
- Stage-specific UI components in `packages/client/src/components/stages/`
- Dark theme with accent `#6e56cf`, fonts: Inter + JetBrains Mono

### Configuration

- `ANTHROPIC_API_KEY` env var or `~/.ideafactory/config.yaml` (`apiKey` field)
- Config supports: `defaults.workerCount` (1-5), `defaults.ideasPerWorker` (5-30), `models.*` per agent role, `server.port`
- Custom methods: YAML/JSON in `~/.ideafactory/methods/`
- Custom personas: YAML/JSON in `~/.ideafactory/personas/`

## Code Style

- Prettier: single quotes, trailing commas, semicolons, 100 char width, 2-space indent
- ESLint: `@typescript-eslint/no-unused-vars` (warn, `_` prefix ignored), `@typescript-eslint/no-explicit-any` (warn)
- TypeScript strict mode, ES2022 target, bundler module resolution

## Testing

- Vitest workspace with three projects (server: node env, client: jsdom env, shared: node env)
- Server test setup in `packages/server/src/__tests__/setup.ts` provides `createTestDb()` (in-memory SQLite) and `mockAnthropicSdk()`
- All test configs enable `globals: true` (no need to import `describe`/`it`/`expect`)
