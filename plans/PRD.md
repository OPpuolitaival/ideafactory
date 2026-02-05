# Idea Factory v2 — Product Requirements Document

> **Product:** Idea Factory
> **Version:** 2.0
> **Date:** 2026-02-05
> **Status:** Draft

---

## 1. Overview

### 1.1 Vision

Idea Factory is a local-first "production line" for ideas where parallel AI agents serve as the workers, guided by a rigorous multi-stage pipeline. It replaces single-shot LLM prompting with an orchestrated system of specialized agents that explore, generate, evaluate, and package ideas systematically.

### 1.2 Problem Statement

Current AI-assisted ideation suffers from three failure modes:

1. **Novelty bias** — prompts implicitly ask for "creative" ideas, suppressing high-probability solutions that are often correct.
2. **No evaluation framework** — ideas are generated without pre-defined success criteria, making comparison subjective.
3. **Serial bottleneck** — a single LLM perspective produces a narrow distribution of ideas regardless of temperature.

Idea Factory v1 solved (1) and (2) with full-distribution sampling and rubric-first design. v2 solves (3) by introducing parallel agents with distinct personas, and addresses v1's architectural limitations (no persistence, fragile JSON parsing, DOM nuke rendering).

### 1.3 Target User

Technical power users — developers, researchers, product builders — who want a local tool they can run, customize, and extend. Users are comfortable with CLI tooling, API keys, config files, and TypeScript.

### 1.4 Deployment Model

**Local-only.** Runs entirely on the user's machine as a local web application (Node.js backend + React frontend). No cloud services, no user accounts, no managed infrastructure. Users provide their own Anthropic API key.

### 1.5 LLM Strategy

**Claude-only via the Anthropic Agent SDK** (`@anthropic-ai/claude-agent-sdk`). All agents, skills, and LLM calls are powered by Claude through the Agent SDK's orchestrator-subagent pattern.

---

## 2. Core Methodology (Unchanged from v1)

The 5-stage pipeline is the product's intellectual core. v2 changes the execution engine, not the philosophy.

### 2.1 The Pipeline

| # | Stage | Purpose | Principle |
|---|-------|---------|-----------|
| 1 | **Taxonomy** | Map the problem space | Choose a target before shooting |
| 2 | **Methods** | Select thinking tools | Choose your lens before looking |
| 3 | **Rubric** | Define success criteria | Define "good" before generating |
| 4 | **Factory** | Generate, filter, evolve, QA | Diverge wide, converge hard |
| 5 | **Output** | Package actionable artifacts | Ship concepts, not conversations |

The pipeline forces three decisions before any idea generation: **what target** (taxonomy coordinate), **which lenses** (methods), and **what scoring function** (rubric).

### 2.2 Full-Distribution Sampling

The core prompting philosophy: ask the model to sample from the **entire distribution** of possible responses, not filter for novelty. Every taxonomy node and idea is tagged with probability:

- **High**: obvious, conventional, already-proven approaches
- **Medium**: reasonable variations, combinations, incremental improvements
- **Low**: unusual, counterintuitive, speculative long-tail approaches

The boring, the obvious, and the weird all belong. Convergence handles quality selection.

---

## 3. Technology Stack

### 3.1 Frontend

| Concern | Technology | Rationale |
|---------|-----------|-----------|
| Framework | React 19 + Vite | Component model, fast HMR, ecosystem |
| Language | TypeScript (strict) | Type safety across client/server boundary |
| Styling | TailwindCSS | Utility-first, dark theme, rapid iteration |
| Primitives | Radix UI | Accessible, unstyled, composable |
| State management | Zustand + transition guards | Simple store with explicit stage transition logic, familiar React patterns |
| Server sync | TanStack Query + SSE | Cache management + real-time agent streaming |
| API client | tRPC (React) | Type-safe RPC, shared types with server |

### 3.2 Backend

| Concern | Technology | Rationale |
|---------|-----------|-----------|
| Runtime | Node.js | Required by Agent SDK |
| Framework | Hono | Lightweight, fast, good TypeScript support |
| API layer | tRPC | End-to-end type safety with React client, shared router |
| Agent runtime | `@anthropic-ai/claude-agent-sdk` | Orchestrator-subagent pattern, tool use, streaming |
| Validation | Zod | Shared schemas between agents, API, and UI |
| Storage | SQLite (via `better-sqlite3`) | Queryable persistence, single file, no server |
| Migrations | `drizzle-orm` | Type-safe schema, lightweight |

### 3.3 Shared

| Concern | Technology | Rationale |
|---------|-----------|-----------|
| Monorepo | pnpm workspaces | Shared types, no publish overhead |
| Contracts | Zod schemas in `packages/shared` | Single source of truth for all data shapes |

---

## 4. Architecture

### 4.1 Monorepo Structure

```
/idea-factory/
├── packages/
│   ├── shared/                 # Shared types, Zod schemas, constants
│   │   └── src/
│   │       ├── schemas/        # All Zod schemas (taxonomy, rubric, ideas, etc.)
│   │       ├── types.ts        # Inferred TypeScript types from schemas
│   │       └── constants.ts    # Method library, stage definitions
│   ├── client/                 # React 19 + Vite
│   │   └── src/
│   │       ├── components/     # UI components
│   │       ├── store/          # Zustand stores + transition guards
│   │       ├── hooks/          # React hooks (SSE, tRPC)
│   │       ├── trpc/           # tRPC client setup
│   │       └── styles/         # Tailwind config, global styles
│   └── server/                 # Node.js + Hono
│       └── src/
│           ├── agents/         # Agent SDK agent definitions
│           ├── skills/         # Skill bundles (SKILL.md + schema.ts)
│           ├── trpc/           # tRPC router definitions
│           ├── sse/            # SSE streaming endpoints
│           ├── db/             # SQLite schema, queries, migrations
│           └── config/         # User-facing config loading
├── config/                     # User-extensible config (methods, personas)
├── pnpm-workspace.yaml
└── package.json
```

### 4.2 Data Flow

```
User (Browser)
    │
    │  tRPC: session.start({ domain })
    ▼
Hono Server (tRPC router)
    │
    │  Initialize SessionAgent (Orchestrator)
    ▼
SessionAgent (Orchestrator)
    │
    ├── Spawns Navigator subagent     → taxonomy skill + web search
    ├── Spawns Strategist subagent    → method-selector + rubric-designer skills
    ├── Spawns N Worker subagents     → ideation skill + persona prompts (PARALLEL)
    └── Spawns Analyst subagent       → critic + reporting skills
    │
    │  SSE stream: /api/session/:id/stream
    │  Events: agent:thought, data:*, status:*
    ▼
React UI
    │
    │  tRPC hooks (queries/mutations) + SSE hook (streaming)
    ▼
User sees live progress, interacts at decision points
```

### 4.3 Client-Server Communication

**Protocol:** tRPC (over HTTP) + Server-Sent Events (SSE)

tRPC provides end-to-end type safety between client and server. SSE is used separately for real-time agent streaming (tRPC subscriptions are an alternative but SSE keeps the streaming path simple and framework-independent).

**tRPC Router Procedures:**

| Procedure | Type | Purpose |
|-----------|------|---------|
| `session.start` | mutation | Create session, begin taxonomy stage |
| `session.advance` | mutation | Advance to next stage with user decisions |
| `session.get` | query | Get session state by ID |
| `session.list` | query | List all sessions (workspace) |
| `session.delete` | mutation | Delete session |
| `session.updateRubric` | mutation | Save user-edited rubric |
| `session.duplicate` | mutation | Deep-copy a session, returns new session ID |
| `session.rollback` | mutation | Clear data from a given stage forward, reset status |
| `config.getMethods` | query | Get method library (built-in + user-defined) |
| `config.getPersonas` | query | Get worker personas (built-in + user-defined) |

**SSE Endpoint (separate from tRPC):**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/session/:id/stream` | SSE stream for real-time agent events |

**SSE Event Types:**

| Event | Payload | Purpose |
|-------|---------|---------|
| `agent:thought` | `{ agent: string, text: string }` | Agent thinking/reasoning (displayed in thought feed) |
| `agent:tool_use` | `{ agent: string, tool: string }` | Agent using a tool (e.g., web search) |
| `data:taxonomy_update` | `TaxonomyNode` (JSON) | Taxonomy tree generated/updated |
| `data:methods_recommended` | `{ recommended: number[], reasoning: Record<string, string> }` | Method recommendations ready |
| `data:rubric_generated` | `Rubric` (JSON) | Rubric proposal ready for user editing |
| `data:idea_stream` | `{ workerId: string, persona: string, idea: Idea }` | Individual idea from a parallel worker |
| `data:convergence_result` | `{ survivors: Idea[], eliminated: Idea[] }` | Convergence filtering complete |
| `data:evolution_result` | `{ evolved: Concept[] }` | Evolution polishing complete |
| `data:qa_result` | `{ reviewed: Concept[] }` | QA critique complete |
| `data:output_package` | `OutputPackage` (JSON) | Final packaged output |
| `status:stage_complete` | `{ stage: string, next: string }` | Stage finished, waiting for user |
| `status:error` | `{ stage: string, error: string }` | Agent error |

---

## 5. Stage Specifications

### 5.1 Stage 1: Taxonomy (The Map Maker)

**Goal:** Explore the problem space before choosing a target.

**User flow:**
1. User enters a domain (free text, e.g., "Future of Chairs")
2. System spawns the **Navigator** agent with the `taxonomy` skill
3. Agent generates a probability-weighted MECE tree, streamed to the UI
4. User browses and selects a coordinate (path through the tree)
5. User clicks "Lock & Continue"

**Agent:** Navigator
**Skills:** `taxonomy`, optionally `web-search` (off by default; user-enabled per session or via config)

**Data schema — TaxonomyNode:**

```typescript
const TaxonomyNodeSchema = z.object({
  name: z.string(),
  p: z.enum(['high', 'medium', 'low']),
  children: z.array(z.lazy(() => TaxonomyNodeSchema)).optional(),
});
```

**Prompting parameters:**
- Temperature: 0.7
- Max tokens: 16384
- Coverage: 8-15 top-level categories, 4-10 subcategories each
- Full-distribution sampling: standard + niche + edge-case categories

**UI requirements:**
- Text input + "Generate" button (Enter triggers generation)
- Skeleton loader during generation
- Collapsible tree with expand/collapse arrows
- Probability tags: green (high), amber (medium), dim (low)
- Click-to-select any node as coordinate
- Purple coordinate banner when selected
- "Lock & Continue" button advances to Methods
- Tree search/filter input for large taxonomies (new in v2)

**User decision point:** Selecting and locking the taxonomy coordinate.

---

### 5.2 Stage 2: Methods (The Tool Picker)

**Goal:** Select the right thinking tools before ideating.

**User flow:**
1. System spawns the **Strategist** agent with the `method-selector` skill
2. Agent analyzes the locked coordinate and recommends 3-5 methods with reasoning
3. User reviews the full method library, sees recommendations highlighted
4. User selects 3-5 methods (can override recommendations)
5. User clicks "Next: Rubric"

**Agent:** Strategist
**Skills:** `method-selector`

**Method Library:**

The method library ships with 10 built-in methods (carried over from v1) and supports **user-defined methods** loaded from config files.

**Built-in methods:**

| ID | Name | Description | Good For |
|----|------|-------------|----------|
| 1 | First Principles | Break into functions, rebuild from constraints | Rethinking assumptions, radical simplification |
| 2 | Biomimicry | Steal mechanisms from nature | Structural innovation, efficiency |
| 3 | TRIZ | Contradiction-solving patterns from engineering patents | Resolving trade-offs, technical problems |
| 4 | Inversion | Flip assumptions | Breaking fixation, surprising solutions |
| 5 | Extreme Constraints | Design under impossible limits | Forced creativity, cost innovation |
| 6 | User Archetype Roleplay | Specific user contexts | Empathy-driven design, accessibility |
| 7 | Morphological Analysis | Systematic combination across dimensions | Exhaustive exploration, combinatorial novelty |
| 8 | Material-led Exploration | Start from material properties | Sustainability, manufacturing innovation |
| 9 | Cultural Anthropology | Rituals, norms, symbolism of use | Emotional design, cultural fit |
| 10 | Physics/Gameplay Simulation | Optimize through simulation | Performance, sports, interactive products |

**User-defined methods:**

Users can add custom methods by placing YAML or JSON files in `~/.ideafactory/methods/`:

```yaml
# ~/.ideafactory/methods/systems-thinking.yaml
name: Systems Thinking
description: Analyze feedback loops, emergent properties, and second-order effects
goodFor: Complex adaptive systems, policy design, ecosystem-level innovation
```

Custom methods are loaded at server startup and merged with built-in methods. They receive IDs starting at 100.

**Data schema — MethodRecommendation:**

```typescript
const MethodRecommendationSchema = z.object({
  recommended: z.array(z.number()),
  reasoning: z.record(z.string(), z.string()),
});
```

**Prompting parameters:**
- Temperature: 0.6
- Max tokens: 4096

**UI requirements:**
- Card grid showing all methods (built-in + user-defined)
- "Recommended" badge (amber) on agent-suggested methods
- Click to toggle selection (purple highlight)
- Reasoning tooltip/expandable section per recommended method
- Counter: "N of 3-5 methods selected"
- "Next: Rubric" button disabled until >= 3 selected
- Visual distinction between built-in and user-defined methods

**User decision point:** Selecting which methods to use.

---

### 5.3 Stage 3: Rubric (The Judge)

**Goal:** Define "success" before generating ideas.

**User flow:**
1. System spawns the **Strategist** agent with the `rubric-designer` skill
2. Agent generates a rubric: gates (hard pass/fail), criteria (weighted 1-5), and tests
3. User reviews and edits the rubric inline
4. User clicks "Next: Run Factory"

**Agent:** Strategist
**Skills:** `rubric-designer`

**Data schema — Rubric:**

```typescript
const RubricSchema = z.object({
  gates: z.array(z.object({
    id: z.string(),
    text: z.string(),
  })),
  criteria: z.array(z.object({
    id: z.string(),
    text: z.string(),
    weight: z.number().min(1).max(5),
    description: z.string(),
  })),
  tests: z.array(z.object({
    id: z.string(),
    text: z.string(),
  })),
});
```

- **Gates (3-5):** Hard constraints. Idea fails if any gate fails.
- **Criteria (5-8):** Scored dimensions with weights 1-5.
- **Tests (3-5):** Verification methods to validate claims.

**Prompting parameters:**
- Temperature: 0.6
- Max tokens: 4096

**UI requirements:**
- Three sections: Hard Gates, Scored Criteria, Verification Tests
- Inline-editable text inputs for each item
- Delete button (X) on hover per item
- "+ Add" button at bottom of each section
- Weight slider (1-5) on criteria with numeric display
- Skeleton loader during generation
- "Regenerate" button to get a fresh rubric proposal

**User decision point:** Editing and confirming the rubric.

---

### 5.4 Stage 4: Factory (The Parallel Engine)

**Goal:** Generate, filter, evolve, and QA ideas using parallel agents.

This is the most significant change from v1. Instead of sequential single-LLM calls, v2 runs parallel agents with distinct personas.

#### 5.4.1 Phase A: Divergence (Parallel)

The backend spawns **N worker agents** (user-configurable, 1-5, default 3) running in parallel. Each uses the `ideation` skill with a specific persona injected.

**Default Personas (configurable):**

| Worker | Persona | Focus | Default Method Bias |
|--------|---------|-------|-------------------|
| 1 | The Engineer | Feasibility, materials, physics, cost | First Principles |
| 2 | The Visionary | Novelty, "wow" factor, future constraints | Inversion |
| 3 | The Anthropologist | Human rituals, emotion, culture, empathy | Cultural Anthropology |

**User-defined personas:**

Users can add custom personas in `~/.ideafactory/personas/`:

```yaml
# ~/.ideafactory/personas/the-economist.yaml
name: The Economist
systemPrompt: >
  You are a microeconomist. Prioritize incentive structures,
  market dynamics, pricing psychology, and scalable business models.
defaultMethod: First Principles
```

**Configurable settings (per session or global):**

| Setting | Default | Range | Location |
|---------|---------|-------|----------|
| Worker count | 3 | 1-5 | Session config or `~/.ideafactory/config.yaml` |
| Ideas per worker | 15 | 5-30 | Session config |
| Persona assignments | Auto (rotate through available) | User picks from library | Session config |

**Prompting parameters:**
- Temperature: 0.9
- Max tokens: 16384 per worker
- Full-distribution sampling: at least N ideas per method, probability-tagged

**Output:** Each worker streams ideas individually to the UI. Ideas appear in real-time in per-worker columns.

**Data schema — RawIdea:**

```typescript
const RawIdeaSchema = z.object({
  id: z.string(),
  workerId: z.string(),
  persona: z.string(),
  method: z.string(),
  name: z.string(),
  description: z.string(),
  probability: z.enum(['high', 'medium', 'low']),
});
```

#### 5.4.2 Phase B: Convergence (The Filter)

A single **Analyst** agent takes the full idea pool + the rubric.

**Actions:**
1. Filter out gate failures (hard elimination)
2. Score remaining ideas against weighted criteria
3. Merge duplicates and near-duplicates across workers
4. Select top 4-6 survivors

**Prompting parameters:**
- Temperature: 0.5
- Max tokens: 8192

**Data schema — ScoredIdea:**

```typescript
const ScoredIdeaSchema = z.object({
  id: z.string(),
  sourceIds: z.array(z.string()),  // original idea IDs (for merged ideas)
  name: z.string(),
  description: z.string(),
  gateResults: z.array(z.object({
    gateId: z.string(),
    pass: z.boolean(),
    reason: z.string(),
  })),
  criteriaScores: z.array(z.object({
    criterionId: z.string(),
    score: z.number().min(1).max(5),
    reason: z.string(),
  })),
  totalScore: z.number(),
  eliminated: z.boolean(),
  eliminationReason: z.string().optional(),
});
```

#### 5.4.3 Phase C: Evolution (The Polisher)

The surviving ideas are passed to an **Evolution** agent to be improved.

**Actions:**
- Remove identified failure modes
- Reduce cost / complexity
- Increase delight / differentiation
- Merge strong features across candidates
- Strengthen weak criteria scores

**Prompting parameters:**
- Temperature: 0.7
- Max tokens: 8192

#### 5.4.4 Phase D: QA (The Critic)

The evolved concepts are passed to the **Analyst** agent with the `critic` skill.

**Actions:**
- Reality-check feasibility assumptions
- Identify user friction points
- Assess manufacturing/implementation complexity
- Flag safety risks
- Predict real-world failure modes
- Score maintenance burden

**Prompting parameters:**
- Temperature: 0.5
- Max tokens: 8192

**Data schema — QAResult:**

```typescript
const QAResultSchema = z.object({
  conceptId: z.string(),
  feasibilityScore: z.number().min(1).max(5),
  risks: z.array(z.object({
    category: z.string(),
    description: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    mitigation: z.string().optional(),
  })),
  verdict: z.enum(['strong', 'conditional', 'weak']),
  summary: z.string(),
});
```

**UI requirements (full Factory stage):**

- Pipeline visualization: 4 phases with connectors (Diverge → Converge → Evolve → QA)
- Active phase shows spinner/pulse, completed phases show green checkmark
- Progress bar based on current phase
- **Divergence view:** N columns (one per worker), ideas stream in real-time per column. Each idea card shows name, probability tag, and source persona/method.
- **Convergence view:** Ideas sorted by score, eliminated ones greyed out with reason
- **Evolution view:** Before/after comparison of evolved concepts
- **QA view:** Risk assessment cards with severity badges
- Drag-and-drop reordering of ideas (user override of AI ranking)
- "Next: Package Output" button disabled until all 4 phases complete

**User interaction during Factory:**
- Users can observe but not intervene during Diverge/Converge/Evolve/QA (the factory runs autonomously)
- After completion, users can reorder results before proceeding

---

### 5.5 Stage 5: Output (The Packager)

**Goal:** Produce actionable, exportable artifacts.

**User flow:**
1. System spawns the **Analyst** agent with the `reporting` skill
2. Agent packages the final concepts into a structured report
3. User reviews concept cards and exports

**Agent:** Analyst
**Skills:** `reporting`

**Data schema — OutputPackage:**

```typescript
const OutputPackageSchema = z.object({
  concepts: z.array(z.object({
    rank: z.number(),
    name: z.string(),
    description: z.string(),
    pros: z.array(z.string()),
    cons: z.array(z.string()),
    openQuestions: z.array(z.string()),
    nextSteps: z.array(z.string()),
    qaVerdict: z.enum(['strong', 'conditional', 'weak']),
  })),
  overallInsights: z.string(),
  suggestedNextSprint: z.array(z.string()),
  sessionMetadata: z.object({
    domain: z.string(),
    coordinate: z.string(),
    methods: z.array(z.string()),
    workerCount: z.number(),
    totalIdeasGenerated: z.number(),
    totalIdeasSurvived: z.number(),
    duration: z.number(), // ms
  }),
});
```

**Prompting parameters:**
- Temperature: 0.4
- Max tokens: 8192

**Visual Artifacts:**

The reporting skill also generates visual artifacts alongside text:

1. **Comparison Radar Chart (SVG):** A multi-axis chart comparing the top concepts across rubric criteria. Each concept is a colored polygon overlay. Rendered as inline SVG in the UI, exportable as PNG.

2. **Concept Sketch (HTML/SVG):** For each top concept, generate a simple visual representation — a schematic diagram, wireframe, or annotated illustration rendered as HTML/SVG. These are not photorealistic; they're minimal line drawings that communicate the core idea visually.

3. **Exportable Report Page (HTML):** A self-contained single-file HTML page that includes all concept cards, the radar chart, concept sketches, insights, and metadata. Can be opened in any browser, shared as a file, or printed.

**Data schema — VisualArtifact:**

```typescript
const VisualArtifactSchema = z.object({
  type: z.enum(['radar_chart', 'concept_sketch', 'report_page']),
  format: z.enum(['svg', 'html']),
  content: z.string(),  // Raw SVG or HTML string
  label: z.string(),    // Display name
});
```

**UI requirements:**
- Ranked concept cards with: rank badge, name, description, pros/cons columns (green/red), open questions, next steps, QA verdict badge
- Concept sketch rendered inline below each concept card
- Radar comparison chart displayed prominently above concept cards
- Overall insights card
- Session metadata summary (domain, coordinate, methods used, idea counts, duration)
- **Export options:**
  - Copy as Markdown (clipboard)
  - Download as Markdown file (.md)
  - Download as JSON (structured data)
  - Download full HTML report (self-contained, includes all visuals)
  - Download radar chart as PNG
- "Start New Session" button resets to Stage 1

---

## 6. Agent Architecture

### 6.1 Orchestrator-Subagent Pattern

The **SessionAgent** (Orchestrator) holds session state and delegates work to specialized subagents.

```
SessionAgent (Orchestrator)
├── Navigator        [taxonomy, web-search]
├── Strategist       [method-selector, rubric-designer]
├── Worker 1..N      [ideation + persona]    ← parallel
└── Analyst          [critic, reporting]
```

**Orchestrator responsibilities:**
- Receive user intent ("start taxonomy", "advance to methods", etc.)
- Spawn appropriate subagent(s) for the current stage
- Manage session state persistence (write to SQLite)
- Stream events to the client via SSE
- Handle errors and retries

**Orchestrator tools:**
- `Task` — spawn subagents
- `updateState` — persist progress to database
- `emitEvent` — send SSE events to client

### 6.2 Skill Library

Each skill is a self-contained bundle in `/server/src/skills/`:

```
skills/
├── taxonomy/
│   ├── SKILL.md          # Instructions for generating MECE taxonomy trees
│   └── schema.ts         # Zod schema for TaxonomyNode
├── method-selector/
│   ├── SKILL.md          # Method library definitions + matching instructions
│   └── schema.ts         # Zod schema for MethodRecommendation
├── rubric-designer/
│   ├── SKILL.md          # Guide for creating unbiased, testable criteria
│   └── schema.ts         # Zod schema for Rubric
├── ideation/
│   ├── SKILL.md          # Full-distribution sampling instructions
│   └── schema.ts         # Zod schema for RawIdea
├── critic/
│   ├── SKILL.md          # Harsh reality-checker instructions
│   └── schema.ts         # Zod schema for QAResult
└── reporting/
    ├── SKILL.md          # Output packaging and formatting instructions
    └── schema.ts         # Zod schema for OutputPackage
```

Each `SKILL.md` contains the domain expertise and behavioral instructions loaded into the agent's context. Schemas enforce structured output.

### 6.3 Parallel Factory Implementation

```typescript
// Conceptual: server/src/agents/factory.ts

async function runDivergence(session: Session): Promise<RawIdea[]> {
  const workers = session.config.personas.slice(0, session.config.workerCount);

  const results = await Promise.all(
    workers.map((persona, i) =>
      startWorkerAgent({
        persona,
        domain: session.coordinate,
        methods: session.selectedMethods,
        rubric: session.rubric,
        onIdea: (idea) => emitSSE(session.id, 'data:idea_stream', {
          workerId: `worker-${i}`,
          persona: persona.name,
          idea,
        }),
      })
    )
  );

  return results.flat();
}
```

Each worker is an ephemeral Agent SDK session with:
- The `ideation` skill loaded
- A persona-specific system prompt injected
- Streaming callbacks for real-time idea delivery

---

## 7. Persistence & Data Model

### 7.1 Storage

**Engine:** SQLite via `better-sqlite3`
**Location:** `~/.ideafactory/data.db`
**ORM:** Drizzle ORM for type-safe schema and migrations

### 7.2 Database Schema

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  domain        TEXT NOT NULL,
  coordinate    TEXT,
  status        TEXT NOT NULL DEFAULT 'taxonomy',  -- current stage
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  config        TEXT  -- JSON: worker count, persona selections, etc.
);

CREATE TABLE taxonomy_trees (
  session_id    TEXT PRIMARY KEY REFERENCES sessions(id),
  tree          TEXT NOT NULL,  -- JSON: TaxonomyNode
  selected_path TEXT            -- JSON: string[]
);

CREATE TABLE method_selections (
  session_id    TEXT PRIMARY KEY REFERENCES sessions(id),
  recommended   TEXT NOT NULL,  -- JSON: number[]
  reasoning     TEXT NOT NULL,  -- JSON: Record<string, string>
  selected      TEXT NOT NULL   -- JSON: number[]
);

CREATE TABLE rubrics (
  session_id    TEXT PRIMARY KEY REFERENCES sessions(id),
  rubric        TEXT NOT NULL   -- JSON: Rubric
);

CREATE TABLE ideas (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  worker_id     TEXT,
  persona       TEXT,
  method        TEXT,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  probability   TEXT,
  phase         TEXT NOT NULL,  -- 'diverge', 'converge', 'evolve', 'qa'
  score         REAL,
  eliminated    INTEGER DEFAULT 0,
  data          TEXT            -- JSON: full structured data per phase
);

CREATE TABLE output_packages (
  session_id    TEXT PRIMARY KEY REFERENCES sessions(id),
  package       TEXT NOT NULL   -- JSON: OutputPackage
);
```

### 7.3 Data Lifecycle

1. **Session created** → row in `sessions` with status `taxonomy`
2. **Each stage completes** → stage data written to respective table, `sessions.status` updated
3. **User edits** (rubric, reordering) → update in place
4. **Session deleted** → cascade delete all related rows

---

## 8. Configuration System

All user configuration lives in `~/.ideafactory/`:

```
~/.ideafactory/
├── config.yaml           # Global settings
├── data.db               # SQLite database
├── methods/              # User-defined method YAML/JSON files
└── personas/             # User-defined persona YAML/JSON files
```

### 8.1 Global Config (`config.yaml`)

```yaml
# ~/.ideafactory/config.yaml

apiKey: sk-ant-...          # Anthropic API key (or set ANTHROPIC_API_KEY env var)

defaults:
  workerCount: 3            # 1-5 parallel workers in Factory stage
  ideasPerWorker: 15        # Target ideas per worker in Diverge phase
  webSearch: false           # Enable web search in taxonomy stage

models:
  default: claude-sonnet-4-20250514     # Fallback for any agent not specified below
  navigator: claude-haiku-4-20250414    # Fast taxonomy generation
  strategist: claude-sonnet-4-20250514  # Method selection + rubric design
  worker: claude-sonnet-4-20250514      # Ideation (parallel workers)
  analyst: claude-sonnet-4-20250514     # Convergence, QA, reporting

server:
  port: 3000                # Local server port
```

Each agent type can use a different Claude model. Users can optimize for cost (Haiku for simpler tasks) or quality (Opus for critical evaluation). The `default` key is the fallback if a specific agent's model is not configured.

### 8.2 API Key Resolution Order

1. `ANTHROPIC_API_KEY` environment variable
2. `apiKey` field in `~/.ideafactory/config.yaml`
3. Prompt in Settings UI (saved to config.yaml)

---

## 9. UI/UX Specifications

### 9.1 Visual Design

Carry forward v1's dark theme with refinements:

- **Theme:** Dark. Background layers: `#0a0a0f` → `#12121a` → `#1a1a26` → `#222233`
- **Accent:** Purple `#6e56cf` / `#8b78e6`
- **Semantic colors:** Green `#30a46c` (success/pros), Red `#e5484d` (danger/cons), Amber `#f5a623` (warnings/recommendations), Blue `#3e63dd` (info)
- **Typography:** Inter (or system sans-serif), monospace for code/data
- **Transitions:** 200ms ease on interactive elements
- **Loading states:** Skeleton shimmer for content, pulsing nodes for active agents

### 9.2 Layout

```
┌─────────────────────────────────────────────────┐
│ Topbar: [Logo] Idea Factory    [Sessions] [Settings] │
├─────────────────────────────────────────────────┤
│ Stage Bar: [1 Taxonomy] → [2 Methods] → [3 Rubric] → [4 Factory] → [5 Output] │
├───────────────────┬─────────────────────────────┤
│                   │                             │
│   Main Content    │    Thought Feed (sidebar)   │
│   (stage view)    │    - agent:thought events    │
│                   │    - agent:tool_use events   │
│                   │    - collapsible             │
│                   │                             │
├───────────────────┴─────────────────────────────┤
│ (optional) Node Graph: visual pipeline with pulsing active nodes │
└─────────────────────────────────────────────────┘
```

### 9.3 New UI Features (v2)

**Workspace Dashboard:**
- Landing page showing all past sessions
- Each session card: domain, coordinate, date, status (in-progress / completed)
- Click to resume or view results
- Delete sessions
- Search/filter sessions

**Live Thought Feed (sidebar):**
- Collapsible right sidebar
- Shows real-time `agent:thought` and `agent:tool_use` events
- Styled as a log/terminal with agent name badges
- User can see the agents "thinking" — builds trust and engagement
- Auto-scrolls, with scroll-lock on manual scroll-up

**Visual Pipeline (node graph):**
- The 5-stage pipeline rendered as connected nodes
- Active nodes pulse with accent color
- Completed nodes show checkmark
- In Factory stage, shows sub-nodes for Diverge/Converge/Evolve/QA
- Parallel worker nodes fan out during Diverge phase

**Factory Columns:**
- During Diverge, N columns (one per worker) show ideas streaming in
- Each column header shows the worker persona name and avatar/icon
- Ideas animate in as they arrive (slide-in from bottom)
- After Converge, eliminated ideas fade/grey out with strikethrough

### 9.4 Responsive Design

- Primary target: Desktop (1280px+)
- Tablet support (768px+): single column, sidebar collapses to toggle
- Mobile: not a priority (power user / local tool)

---

## 10. Error Handling & Resilience

### 10.1 Agent Errors

| Error | Handling |
|-------|----------|
| LLM returns malformed JSON | Retry up to 2 times with explicit "fix your JSON" prompt. On 3rd failure, surface error to user with raw output. |
| Agent timeout | 60s timeout per agent call. On timeout, surface error, allow retry. |
| Rate limit (429) | Exponential backoff with jitter. Surface wait time to user. |
| API key invalid | Immediate error, redirect to Settings. |
| Network failure | Retry with backoff. Surface error after 3 attempts. |

### 10.2 Session Recovery

- All stage outputs are persisted to SQLite immediately on completion
- If the server crashes mid-Factory, the session resumes from the last completed phase
- Partial Diverge results (some workers completed) are preserved

### 10.3 Validation

- All agent outputs validated against Zod schemas before persisting or sending to client
- Invalid outputs trigger retry with schema violation details in the retry prompt
- Client-side validation on user inputs (non-empty domain, 3-5 methods selected, etc.)

---

## 11. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Startup time (server + client) | < 3s |
| Taxonomy generation | < 30s |
| Full Factory run (3 workers) | < 120s |
| SSE latency (agent event → UI render) | < 200ms |
| SQLite database size | < 100MB for 1000 sessions |
| Memory footprint (server) | < 512MB during Factory parallel run |
| Concurrent sessions | 1 (local tool, single user) |

---

## 12. Security Considerations

- **API key storage:** Stored in `~/.ideafactory/config.yaml` (file permissions: 600). Never sent to any endpoint other than Anthropic's API.
- **No telemetry.** No data leaves the machine except LLM API calls.
- **Input sanitization:** User-provided domain text is sanitized before injection into prompts (prevent prompt injection attacks on agent behavior).
- **Config file loading:** User-defined methods and personas are validated against schemas before loading. Malformed files are logged and skipped.

---

## 13. CLI Companion

The CLI provides a headless interface that mirrors the web UI workflows. It enables scriptable usage and serves as the primary tool for testing agents during development.

### 13.1 CLI Commands

```bash
# Start a new interactive session (prompts at each decision point)
ideafactory run --domain "Future of Chairs"

# Start with pre-configured options (skip interactive prompts)
ideafactory run \
  --domain "Future of Chairs" \
  --coordinate "Chairs > Ergonomic > Standing" \
  --methods 1,3,6 \
  --workers 3 \
  --output json

# List all sessions
ideafactory sessions list

# View a session's current state
ideafactory sessions get <session-id>

# Duplicate a session and rollback to a stage
ideafactory sessions copy <session-id> --rollback-to methods

# Delete a session
ideafactory sessions delete <session-id>

# Run a single stage (for testing)
ideafactory stage taxonomy --domain "Future of Chairs" --output json
ideafactory stage diverge --session <id> --workers 3 --output json

# Export a completed session
ideafactory export <session-id> --format markdown
ideafactory export <session-id> --format json
ideafactory export <session-id> --format html

# Config management
ideafactory config show
ideafactory config set defaults.workerCount 5
ideafactory config set models.navigator claude-haiku-4-20250414
```

### 13.2 Interactive Mode

When running `ideafactory run` without pre-set options, the CLI prompts the user at each decision point:

1. **Taxonomy:** Displays the tree in the terminal, user selects a coordinate by number or path
2. **Methods:** Lists methods with recommendations marked, user selects by number
3. **Rubric:** Displays proposed rubric, user can edit via `$EDITOR` or accept
4. **Factory:** Streams agent thoughts and ideas to stdout in real-time
5. **Output:** Displays concept cards, offers export options

### 13.3 Output Formats

| Flag | Behavior |
|------|----------|
| `--output json` | Structured JSON to stdout (pipeable) |
| `--output markdown` | Formatted markdown to stdout |
| `--output quiet` | Minimal output, just final results |
| (default) | Human-readable formatted terminal output |

### 13.4 CLI Architecture

The CLI shares the same server-side code as the web UI. It calls the same tRPC procedures and connects to the same SSE stream. The only difference is the presentation layer:

```
Web UI  ──→ tRPC client (React) ──→ Hono Server ──→ Agent SDK
CLI     ──→ tRPC client (Node)  ──→ Hono Server ──→ Agent SDK
```

Both the CLI and web UI can run against the same server instance, or the CLI can start an embedded server for standalone use.

---

## 14. Session Management

### 14.1 Session Duplication & Rollback

Users can duplicate a session and roll it back to any completed stage. This allows exploring different paths (different methods, different rubrics, different factory configs) from the same starting point without full branching complexity.

**How it works:**
1. User duplicates session S1 → creates S2 (full copy of all data)
2. User rolls back S2 to stage "methods" → S2 retains taxonomy data, clears methods/rubric/factory/output
3. S2 is now an independent session starting from the Methods stage with S1's taxonomy
4. No link is maintained between S1 and S2 after duplication

**tRPC procedures:**

| Procedure | Type | Purpose |
|-----------|------|---------|
| `session.duplicate` | mutation | Deep-copy a session, returns new session ID |
| `session.rollback` | mutation | Clear all data from a given stage forward, reset status |

**Database behavior:**
- `session.duplicate`: INSERT new session + copy all related table rows with new session_id
- `session.rollback`: DELETE rows from later stage tables, UPDATE `sessions.status`

### 14.2 Web Search in Taxonomy

Web search is **off by default**. Users can enable it per session:

- **Web UI:** Toggle in the Taxonomy stage settings panel
- **CLI:** `ideafactory run --domain "chairs" --web-search`
- **Config:** `defaults.webSearch: true` in `config.yaml` to change the default

When enabled, the Navigator agent receives the `web-search` tool and uses it to discover niche categories, emerging trends, and domain-specific terminology the model may not know.

---

## 15. Agent Test Plans (CLI-based)

These test plans verify each agent's behavior using the CLI. They are designed for automated testing during development.

### 15.1 Test Infrastructure

```bash
# All tests use the CLI with JSON output for machine-parseable assertions
# Tests run against a local server instance

# Helper: assert JSON field exists and matches pattern
assert_json() {
  echo "$1" | jq -e "$2" > /dev/null 2>&1
}
```

### 15.2 Navigator Agent (Taxonomy)

**Test: Basic taxonomy generation**
```bash
# Run taxonomy stage only
OUTPUT=$(ideafactory stage taxonomy --domain "Future of Chairs" --output json)

# Assertions:
# 1. Output is valid JSON
echo "$OUTPUT" | jq . > /dev/null

# 2. Root has children (non-empty tree)
echo "$OUTPUT" | jq -e '.children | length > 0'

# 3. Each node has required fields: name, p
echo "$OUTPUT" | jq -e '[.. | objects | select(has("name"))] | all(has("name", "p"))'

# 4. Probability values are valid enums
echo "$OUTPUT" | jq -e '[.. | objects | select(has("p")) | .p] | all(. == "high" or . == "medium" or . == "low")'

# 5. Tree depth >= 2 (at least 2 levels of nesting)
echo "$OUTPUT" | jq -e '.children[0].children | length > 0'

# 6. Coverage: at least 8 top-level categories
echo "$OUTPUT" | jq -e '.children | length >= 8'

# 7. Distribution: all three probability levels present
echo "$OUTPUT" | jq -e '[.. | objects | select(has("p")) | .p] | unique | length == 3'
```

**Test: Taxonomy with web search enabled**
```bash
OUTPUT=$(ideafactory stage taxonomy --domain "Quantum Computing Applications" --web-search --output json)

# Same structural assertions as above, plus:
# 8. Check that web search was invoked (verify in agent logs)
ideafactory stage taxonomy --domain "Quantum Computing" --web-search --output json 2>&1 | grep -q "tool_use.*web"
```

**Test: Edge case — very broad domain**
```bash
OUTPUT=$(ideafactory stage taxonomy --domain "Everything" --output json)
# Should still produce valid tree, not error out
echo "$OUTPUT" | jq -e '.children | length > 0'
```

**Test: Edge case — very narrow domain**
```bash
OUTPUT=$(ideafactory stage taxonomy --domain "Left-handed ergonomic scissors for surgeons" --output json)
# Should still produce tree with reasonable depth
echo "$OUTPUT" | jq -e '.children | length >= 3'
```

### 15.3 Strategist Agent (Methods)

**Test: Method recommendation quality**
```bash
# Create a session and advance to methods stage
SESSION=$(ideafactory run --domain "Sustainable Packaging" \
  --coordinate "Packaging > Food > Takeaway" \
  --stop-at methods --output json)

SESSION_ID=$(echo "$SESSION" | jq -r '.sessionId')
METHODS=$(ideafactory sessions get "$SESSION_ID" --stage methods --output json)

# Assertions:
# 1. Returns 3-5 recommendations
echo "$METHODS" | jq -e '.recommended | length >= 3 and length <= 5'

# 2. All recommended IDs are valid method IDs (1-10 for built-in)
echo "$METHODS" | jq -e '.recommended | all(. >= 1 and . <= 10)'

# 3. Reasoning provided for each recommendation
echo "$METHODS" | jq -e '.reasoning | keys | length == (.recommended | length)'

# 4. No duplicate recommendations
echo "$METHODS" | jq -e '.recommended | unique | length == (.recommended | length)'
```

**Test: Method recommendations vary by domain**
```bash
# Two very different domains should get different recommendations
METHODS_A=$(ideafactory stage methods --coordinate "Chairs > Ergonomic > Standing" --output json)
METHODS_B=$(ideafactory stage methods --coordinate "Music > Instruments > Digital" --output json)

# At least one method should differ between the two
RECS_A=$(echo "$METHODS_A" | jq -c '.recommended | sort')
RECS_B=$(echo "$METHODS_B" | jq -c '.recommended | sort')
[ "$RECS_A" != "$RECS_B" ] && echo "PASS: Different recommendations" || echo "FAIL: Identical recommendations"
```

### 15.4 Strategist Agent (Rubric)

**Test: Rubric structure**
```bash
RUBRIC=$(ideafactory stage rubric \
  --coordinate "Chairs > Ergonomic > Standing" \
  --methods "First Principles,Biomimicry,TRIZ" \
  --output json)

# 1. Has all three sections
echo "$RUBRIC" | jq -e 'has("gates", "criteria", "tests")'

# 2. 3-5 gates
echo "$RUBRIC" | jq -e '.gates | length >= 3 and length <= 5'

# 3. 5-8 criteria
echo "$RUBRIC" | jq -e '.criteria | length >= 5 and length <= 8'

# 4. 3-5 tests
echo "$RUBRIC" | jq -e '.tests | length >= 3 and length <= 5'

# 5. Criteria weights are in range 1-5
echo "$RUBRIC" | jq -e '.criteria | all(.weight >= 1 and .weight <= 5)'

# 6. All items have non-empty text
echo "$RUBRIC" | jq -e '[.gates[], .criteria[], .tests[]] | all(.text | length > 0)'

# 7. All items have unique IDs
echo "$RUBRIC" | jq -e '[.gates[], .criteria[], .tests[]] | [.id] | unique | length == ([.gates[], .criteria[], .tests[]] | length)'
```

### 15.5 Worker Agents (Ideation / Diverge)

**Test: Single worker output**
```bash
IDEAS=$(ideafactory stage diverge \
  --session "$SESSION_ID" \
  --workers 1 \
  --output json)

# 1. At least 15 ideas generated
echo "$IDEAS" | jq -e 'length >= 15'

# 2. Each idea has required fields
echo "$IDEAS" | jq -e 'all(has("id", "name", "description", "probability", "method"))'

# 3. Probability distribution present (not all same tag)
echo "$IDEAS" | jq -e '[.[].probability] | unique | length >= 2'

# 4. Ideas reference valid methods from the session
echo "$IDEAS" | jq -e '[.[].method] | unique | length >= 1'
```

**Test: Parallel workers produce diverse ideas**
```bash
IDEAS=$(ideafactory stage diverge \
  --session "$SESSION_ID" \
  --workers 3 \
  --output json)

# 1. At least 45 ideas total (15 per worker × 3)
echo "$IDEAS" | jq -e 'length >= 30'  # Allow some variance

# 2. Multiple worker IDs present
echo "$IDEAS" | jq -e '[.[].workerId] | unique | length == 3'

# 3. Different personas represented
echo "$IDEAS" | jq -e '[.[].persona] | unique | length == 3'

# 4. Ideas from different workers are not identical
# (Check that idea names across workers have low overlap)
WORKER_0=$(echo "$IDEAS" | jq -c '[.[] | select(.workerId == "worker-0") | .name]')
WORKER_1=$(echo "$IDEAS" | jq -c '[.[] | select(.workerId == "worker-1") | .name]')
# Cross-worker name overlap should be < 20%
```

**Test: Worker respects persona**
```bash
# Run with only The Engineer persona
IDEAS=$(ideafactory stage diverge \
  --session "$SESSION_ID" \
  --workers 1 \
  --personas "The Engineer" \
  --output json)

# Spot-check: ideas should lean toward feasibility/engineering language
# (This is a soft assertion — log for manual review)
echo "$IDEAS" | jq '.[0:3]'
```

### 15.6 Analyst Agent (Convergence)

**Test: Gate filtering**
```bash
CONVERGED=$(ideafactory stage converge \
  --session "$SESSION_ID" \
  --output json)

# 1. Some ideas eliminated
echo "$CONVERGED" | jq -e '[.[] | select(.eliminated == true)] | length > 0'

# 2. Eliminated ideas have reasons
echo "$CONVERGED" | jq -e '[.[] | select(.eliminated == true)] | all(has("eliminationReason"))'

# 3. Survivors have gate results
echo "$CONVERGED" | jq -e '[.[] | select(.eliminated == false)] | all(.gateResults | length > 0)'

# 4. Survivors passed all gates
echo "$CONVERGED" | jq -e '[.[] | select(.eliminated == false)] | all(.gateResults | all(.pass == true))'

# 5. Survivors have criteria scores
echo "$CONVERGED" | jq -e '[.[] | select(.eliminated == false)] | all(.criteriaScores | length > 0)'

# 6. Total scores are calculated
echo "$CONVERGED" | jq -e '[.[] | select(.eliminated == false)] | all(.totalScore > 0)'

# 7. 4-6 survivors
echo "$CONVERGED" | jq -e '[.[] | select(.eliminated == false)] | length >= 4 and length <= 6'
```

### 15.7 Analyst Agent (QA)

**Test: QA critique quality**
```bash
QA=$(ideafactory stage qa --session "$SESSION_ID" --output json)

# 1. Each concept has a QA result
echo "$QA" | jq -e 'length >= 3'

# 2. Feasibility scores in range
echo "$QA" | jq -e 'all(.feasibilityScore >= 1 and .feasibilityScore <= 5)'

# 3. Risks identified for each concept
echo "$QA" | jq -e 'all(.risks | length > 0)'

# 4. Risk severity is valid enum
echo "$QA" | jq -e '[.[].risks[].severity] | all(. == "low" or . == "medium" or . == "high" or . == "critical")'

# 5. Verdict assigned
echo "$QA" | jq -e 'all(.verdict == "strong" or .verdict == "conditional" or .verdict == "weak")'

# 6. Not all concepts get the same verdict (agent is discriminating)
echo "$QA" | jq -e '[.[].verdict] | unique | length >= 2'
```

### 15.8 End-to-End Pipeline Test

**Test: Full session from domain to output**
```bash
# Run complete session with all defaults
OUTPUT=$(ideafactory run \
  --domain "Future of Urban Transportation" \
  --coordinate "Transportation > Urban > Micro-mobility" \
  --methods 1,2,4 \
  --workers 3 \
  --auto-accept-rubric \
  --output json)

# 1. Session completed successfully
echo "$OUTPUT" | jq -e '.status == "completed"'

# 2. Output package exists
echo "$OUTPUT" | jq -e '.outputPackage | has("concepts", "overallInsights", "suggestedNextSprint")'

# 3. At least 3 final concepts
echo "$OUTPUT" | jq -e '.outputPackage.concepts | length >= 3'

# 4. Concepts are ranked
echo "$OUTPUT" | jq -e '.outputPackage.concepts | [.[].rank] | sort == [range(1; length + 1)]'

# 5. Session metadata is complete
echo "$OUTPUT" | jq -e '.outputPackage.sessionMetadata | has("domain", "coordinate", "methods", "workerCount", "totalIdeasGenerated", "totalIdeasSurvived")'

# 6. More ideas generated than survived (filtering worked)
echo "$OUTPUT" | jq -e '.outputPackage.sessionMetadata.totalIdeasGenerated > .outputPackage.sessionMetadata.totalIdeasSurvived'

# 7. Visual artifacts generated
echo "$OUTPUT" | jq -e '.visualArtifacts | length >= 2'

# 8. Export formats work
ideafactory export $(echo "$OUTPUT" | jq -r '.sessionId') --format markdown > /dev/null
ideafactory export $(echo "$OUTPUT" | jq -r '.sessionId') --format html > /dev/null
```

### 15.9 Session Management Tests

**Test: Duplicate and rollback**
```bash
# Create a completed session
SESSION_ID=$(ideafactory run --domain "Chairs" --coordinate "Chairs > Office" \
  --methods 1,2,3 --workers 1 --auto-accept-rubric --output json | jq -r '.sessionId')

# Duplicate it
COPY_ID=$(ideafactory sessions copy "$SESSION_ID" --output json | jq -r '.sessionId')

# Verify copy has all data
COPY=$(ideafactory sessions get "$COPY_ID" --output json)
echo "$COPY" | jq -e '.status == "completed"'

# Rollback to methods stage
ideafactory sessions rollback "$COPY_ID" --to methods

# Verify rollback
ROLLED=$(ideafactory sessions get "$COPY_ID" --output json)
echo "$ROLLED" | jq -e '.status == "methods"'

# Taxonomy data preserved
echo "$ROLLED" | jq -e '.taxonomy != null'

# Factory/output data cleared
echo "$ROLLED" | jq -e '.factory == null'
echo "$ROLLED" | jq -e '.output == null'
```

### 15.10 Error Recovery Tests

**Test: Malformed JSON retry**
```bash
# This is tested internally, but we verify the system doesn't crash
# on edge-case domains that might produce unusual output
ideafactory stage taxonomy --domain "🎵♻️🔬" --output json 2>&1
# Should either succeed or return a clean error, not crash
```

**Test: Server restart mid-session**
```bash
# Start a session, stop server mid-factory, restart, resume
SESSION_ID=$(ideafactory run --domain "Test" --coordinate "Test > A" \
  --methods 1,2,3 --stop-at factory --output json | jq -r '.sessionId')

# Kill server, restart
ideafactory server restart

# Session should be recoverable
STATUS=$(ideafactory sessions get "$SESSION_ID" --output json | jq -r '.status')
echo "Session status after restart: $STATUS"
# Should be at last completed stage, not corrupted
```

---

## 16. Open Questions

These items need resolution during implementation:

1. **Concept sketch fidelity:** The reporting skill generates concept sketches as SVG/HTML. What level of fidelity is expected — abstract diagrams (boxes/arrows), annotated line drawings, or more detailed illustrations? This affects the prompting strategy for the reporting skill's SKILL.md.
