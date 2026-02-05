import type { Method, Persona, Stage } from './schemas/index.js';

export const BUILT_IN_METHODS: Method[] = [
  {
    id: 1,
    name: 'First Principles',
    description: 'Break into functions, rebuild from constraints',
    goodFor: 'Rethinking assumptions, radical simplification',
    builtIn: true,
  },
  {
    id: 2,
    name: 'Biomimicry',
    description: 'Steal mechanisms from nature',
    goodFor: 'Structural innovation, efficiency',
    builtIn: true,
  },
  {
    id: 3,
    name: 'TRIZ',
    description: 'Contradiction-solving patterns from engineering patents',
    goodFor: 'Resolving trade-offs, technical problems',
    builtIn: true,
  },
  {
    id: 4,
    name: 'Inversion',
    description: 'Flip assumptions',
    goodFor: 'Breaking fixation, surprising solutions',
    builtIn: true,
  },
  {
    id: 5,
    name: 'Extreme Constraints',
    description: 'Design under impossible limits',
    goodFor: 'Forced creativity, cost innovation',
    builtIn: true,
  },
  {
    id: 6,
    name: 'User Archetype Roleplay',
    description: 'Specific user contexts',
    goodFor: 'Empathy-driven design, accessibility',
    builtIn: true,
  },
  {
    id: 7,
    name: 'Morphological Analysis',
    description: 'Systematic combination across dimensions',
    goodFor: 'Exhaustive exploration, combinatorial novelty',
    builtIn: true,
  },
  {
    id: 8,
    name: 'Material-led Exploration',
    description: 'Start from material properties',
    goodFor: 'Sustainability, manufacturing innovation',
    builtIn: true,
  },
  {
    id: 9,
    name: 'Cultural Anthropology',
    description: 'Rituals, norms, symbolism of use',
    goodFor: 'Emotional design, cultural fit',
    builtIn: true,
  },
  {
    id: 10,
    name: 'Physics/Gameplay Simulation',
    description: 'Optimize through simulation',
    goodFor: 'Performance, sports, interactive products',
    builtIn: true,
  },
];

export const DEFAULT_PERSONAS: Persona[] = [
  {
    name: 'The Engineer',
    systemPrompt: `You are The Engineer. You prioritize feasibility, materials science, physics, manufacturing cost, and structural integrity. Your ideas are grounded in what can actually be built, shipped, and maintained. You think in terms of tolerances, load-bearing capacity, material fatigue, supply chain constraints, and production scale. You instinctively distrust ideas that hand-wave implementation details.`,
    defaultMethod: 'First Principles',
    builtIn: true,
  },
  {
    name: 'The Visionary',
    systemPrompt: `You are The Visionary. You prioritize novelty, "wow" factor, future constraints, and paradigm shifts. Your ideas push boundaries and imagine futures that don't yet exist. You think in terms of emerging technologies, cultural trends, and what becomes possible when current constraints are removed. You're comfortable with speculative ideas that require technology that doesn't exist yet, as long as the direction is sound.`,
    defaultMethod: 'Inversion',
    builtIn: true,
  },
  {
    name: 'The Anthropologist',
    systemPrompt: `You are The Anthropologist. You prioritize human rituals, emotions, culture, social dynamics, and empathy. Your ideas are rooted in how real humans actually behave, not how they should behave. You think in terms of daily routines, social signaling, identity expression, comfort, anxiety, and delight. You notice the things people do without thinking and design for the messy, emotional, irrational reality of human experience.`,
    defaultMethod: 'Cultural Anthropology',
    builtIn: true,
  },
];

export const STAGES: { id: Stage; label: string; number: number }[] = [
  { id: 'taxonomy', label: 'Taxonomy', number: 1 },
  { id: 'methods', label: 'Methods', number: 2 },
  { id: 'rubric', label: 'Rubric', number: 3 },
  { id: 'factory', label: 'Factory', number: 4 },
  { id: 'output', label: 'Output', number: 5 },
];

export const STAGE_ORDER: Stage[] = ['taxonomy', 'methods', 'rubric', 'factory', 'output', 'completed'];

export const SSE_EVENTS = {
  AGENT_THOUGHT: 'agent:thought',
  AGENT_TOOL_USE: 'agent:tool_use',
  TAXONOMY_UPDATE: 'data:taxonomy_update',
  METHODS_RECOMMENDED: 'data:methods_recommended',
  RUBRIC_GENERATED: 'data:rubric_generated',
  IDEA_STREAM: 'data:idea_stream',
  CONVERGENCE_RESULT: 'data:convergence_result',
  EVOLUTION_RESULT: 'data:evolution_result',
  QA_RESULT: 'data:qa_result',
  OUTPUT_PACKAGE: 'data:output_package',
  STAGE_COMPLETE: 'status:stage_complete',
  ERROR: 'status:error',
} as const;

export const MODEL_OPTIONS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku', color: '#30a46c' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet', color: '#3e63dd' },
  { id: 'claude-opus-4-6', label: 'Opus', color: '#f5a623' },
] as const;

export const DEFAULT_CONFIG = {
  workerCount: 3,
  ideasPerWorker: 15,
  webSearch: false,
  models: {
    default: 'claude-opus-4-6',
    navigator: 'claude-opus-4-6',
    strategist: 'claude-opus-4-6',
    worker: 'claude-opus-4-6',
    analyst: 'claude-opus-4-6',
  },
  server: {
    port: 3000,
  },
} as const;
