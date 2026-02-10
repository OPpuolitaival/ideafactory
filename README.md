# IdeaFactory

An AI-powered ideation pipeline that uses Claude to generate, evaluate, evolve, and package creative ideas. Built as a web application with a real-time streaming UI.

IdeaFactory runs a structured multi-stage pipeline — from domain exploration through taxonomy mapping, method selection, rubric design, and a multi-phase idea factory — producing scored, QA'd, and packaged idea artifacts you can act on.

## How It Works

IdeaFactory uses the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) (`@anthropic-ai/claude-agent-sdk`) to make LLM calls. The Agent SDK piggybacks on your existing **Claude Code subscription** for authentication — no separate API key needed. When you start the server from within a Claude Code session, it inherits the session credentials automatically.

### Pipeline Stages

| # | Stage | What happens |
|---|-------|-------------|
| 1 | **Taxonomy** | Explores your domain and builds a navigable taxonomy tree. You select a focus branch. |
| 2 | **Methods** | Recommends ideation methods (First Principles, Biomimicry, TRIZ, etc.) tailored to your domain. You pick which to use. |
| 3 | **Rubric** | Designs a scoring rubric with weighted criteria specific to your problem space. |
| 4 | **Factory** | Runs 3 automated sub-phases, then hands control to you: |
| | — Diverge | One worker per method generates ideas in parallel (default 15 ideas each) |
| | — Converge | Batched scoring against the rubric, gate filtering + top-N selection |
| | — Evolve | Cross-pollinates surviving ideas in pairs, re-scores evolved variants |
| | — Interactive | You select ideas from the combined pool for QA and packaging |
| 5 | **QA & Packaging** | Per-idea feasibility analysis, risk assessment, HTML artifact generation, and deep-research prompts |

Each stage streams real-time progress via SSE — you see agent thoughts, token counts, and results as they arrive.

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **pnpm** >= 9
- **Claude Code** — install from [claude.ai/code](https://claude.ai/code) if you don't have it

### Setup & Run

The easiest way to get started is to open this repo in Claude Code and ask it to set up and start the server:

```
claude
```

Then prompt:

```
Install dependencies and start the IdeaFactory dev server.
```

Claude Code will run `pnpm install && pnpm dev`, which starts:
- **Server** on `http://localhost:3000` (Hono + tRPC + SQLite)
- **Client** on `http://localhost:5173` (React + Vite, proxies API calls to the server)

Open `http://localhost:5173` in your browser to start a session.

### Manual Setup

```bash
pnpm install
pnpm dev
```

### Authentication

The Agent SDK authenticates through one of two methods:

1. **Claude Code session (recommended)** — When you run the server from within Claude Code (or from a terminal where Claude Code is active), authentication is handled automatically using your Claude Code subscription. No configuration needed.

2. **API key** — Set the `ANTHROPIC_API_KEY` environment variable, or add it to `~/.ideafactory/config.yaml`:
   ```yaml
   apiKey: sk-ant-...
   ```

### Using from Claude Code

Since IdeaFactory uses the Agent SDK, the recommended workflow is:

1. Open a terminal in Claude Code (or run `claude` in this repo)
2. Ask Claude Code to start the dev server
3. The server process inherits Claude Code's authentication
4. Open `http://localhost:5173` in your browser
5. Create a session by entering a domain (e.g., "sustainable packaging", "developer tools")

The server will make LLM calls through the Agent SDK, which routes through your Claude Code subscription. All models (Haiku, Sonnet, Opus) are available — you can switch models per stage in the UI.

## Architecture

pnpm monorepo with three packages:

```
@ideafactory/shared          ← Zod schemas, constants, types
    ↑             ↑
@ideafactory/server          @ideafactory/client
(Hono + tRPC + SQLite)       (React 19 + Vite + Tailwind 4)
```

**Server** handles the pipeline orchestration, LLM calls, database, and real-time event streaming. **Client** provides the interactive UI with stage-by-stage controls and live agent thought feeds. **Shared** defines the Zod schemas and TypeScript types used by both.

### Communication

- **tRPC** (`/trpc/*`) — Client-server RPC for mutations (start session, advance stage, run QA) and queries
- **SSE** (`/api/session/:id/stream`) — Server-to-client real-time events during pipeline execution

### Data Storage

SQLite via better-sqlite3 + drizzle-orm, stored at `~/.ideafactory/data.db`. Eight tables: sessions, taxonomy trees, method selections, rubrics, ideas, QA sheets, idea packages, and an event log for resume support.

## Configuration

Optional config file at `~/.ideafactory/config.yaml`:

```yaml
# Model selection per agent role
models:
  default: claude-opus-4-6      # Fallback for all roles
  navigator: claude-haiku-4-5-20251001    # Taxonomy exploration (fast)
  strategist: claude-sonnet-4-5-20250929  # Method selection & rubric design
  worker: claude-sonnet-4-5-20250929      # Idea generation workers
  analyst: claude-opus-4-6      # Convergence scoring & QA

# Pipeline defaults
defaults:
  ideasPerWorker: 15   # 5–30 ideas per worker (default: 15)
  webSearch: false      # Enable web search in agents

# Server
server:
  port: 3000
```

Available models: `claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`, `claude-opus-4-6`. You can also switch models per stage in the UI at runtime.

### Custom Ideation Methods

Drop YAML or JSON files in `~/.ideafactory/methods/` to add custom methods:

```yaml
# ~/.ideafactory/methods/design-thinking.yaml
name: Design Thinking
description: Empathize, define, ideate, prototype, test
goodFor: Human-centered products, service design
```

Custom methods appear alongside the 10 built-in methods (First Principles, Biomimicry, TRIZ, Inversion, Extreme Constraints, User Archetype Roleplay, Morphological Analysis, Material-led Exploration, Cultural Anthropology, Physics/Gameplay Simulation).

## CLI

The server also exposes a CLI for headless pipeline runs:

```bash
# Start an interactive pipeline run
pnpm run --filter server cli -- run --domain "sustainable packaging"

# With options
pnpm run --filter server cli -- run \
  --domain "developer tools" \
  --coordinate "AI-assisted code review" \
  --methods "First Principles,TRIZ,Inversion" \
  --auto-accept-rubric \
  --output json

# Session management
pnpm run --filter server cli -- sessions list
pnpm run --filter server cli -- sessions get <session-id>
pnpm run --filter server cli -- export <session-id>

# Configuration
pnpm run --filter server cli -- config show
```

## Development

```bash
pnpm dev          # Start server + client in parallel (watch mode)
pnpm build        # Build all packages
pnpm typecheck    # TypeScript type checking
pnpm lint         # ESLint
pnpm test         # Run all tests (vitest)
pnpm test:server  # Server tests only
pnpm test:client  # Client tests only
pnpm test:shared  # Shared tests only
```

### Project Structure

```
packages/
├── shared/src/
│   ├── constants.ts        # Built-in methods, stages, SSE events, model options
│   └── schemas/            # Zod schemas for all data types
├── server/src/
│   ├── index.ts            # Hono server, tRPC handler, SSE endpoint
│   ├── agents/
│   │   ├── llm.ts          # Agent SDK wrapper (callLLM, retry logic, JSON extraction)
│   │   ├── navigator.ts    # Taxonomy agent
│   │   ├── strategist.ts   # Method selection + rubric design agent
│   │   ├── factory.ts      # Factory orchestrator (diverge/converge/evolve/interactive)
│   │   ├── qa.ts           # Per-idea QA agent
│   │   ├── packaging.ts    # HTML artifact + research prompt generation
│   │   └── pipeline.ts     # Pipeline orchestrator
│   ├── skills/             # Markdown system prompts for each agent role
│   ├── trpc/               # tRPC router, context, procedures
│   ├── sse/                # SSE pub/sub manager with persistence
│   ├── db/                 # Drizzle ORM schema + SQLite setup
│   ├── config/             # YAML config loader, paths
│   └── cli/                # CLI commands (run, sessions, export, config, server)
└── client/src/
    ├── components/
    │   ├── App.tsx          # Main app with session routing
    │   ├── Dashboard.tsx    # Session list + create new
    │   └── stages/          # Stage-specific UI (Taxonomy, Methods, Rubric, Factory)
    ├── store/               # Zustand store (session state + SSE event dispatch)
    ├── hooks/               # useSSE hook for EventSource subscription
    └── trpc/                # tRPC client setup
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| LLM | Claude (via Agent SDK) — Haiku, Sonnet, Opus |
| Server | Hono, tRPC, better-sqlite3, drizzle-orm |
| Client | React 19, Vite 7, Tailwind CSS 4, Zustand, Radix UI |
| Shared | Zod 4, TypeScript 5.9 |
| Testing | Vitest |

## License

MIT
