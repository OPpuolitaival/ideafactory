import { create } from 'zustand';
import { STAGE_ORDER, STAGES } from '@ideafactory/shared';
import type { Stage, SessionModels, TaxonomyNode, Rubric, RawIdea, ScoredIdea, QAResult, IdeaPackage, SSEEvent } from '@ideafactory/shared';

export interface ThoughtEntry {
  id: string;
  agent: string;
  text: string;
  timestamp: number;
  stageCheckpoint?: Stage;
  model?: string;
}

export interface SessionData {
  id: string;
  domain: string;
  status: string;
  coordinate: string | null;
  config?: { models?: SessionModels; [key: string]: unknown } | null;
  taxonomy: { tree: TaxonomyNode; selectedPath: string[] | null } | null;
  methods: { recommended: number[]; reasoning: Record<string, string>; selected: number[] } | null;
  rubric: Rubric | null;
  ideas: { id: string; phase: string; workerId: string | null; data: any }[];
  qaSheets: { ideaId: string; feasibilityScore: number; verdict: string; summary: string; risks: any[] }[];
  ideaPackages: { ideaId: string; ideaName: string; htmlContent: string; deepResearchPrompt: string }[];
  eventLog: { type: string; data: any; createdAt?: number }[];
}

interface SessionState {
  // Current session
  sessionId: string | null;
  domain: string;
  stage: Stage;
  isLoading: boolean;
  error: string | null;
  errorStage: string | null;
  sseStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

  // Taxonomy
  taxonomy: TaxonomyNode | null;
  selectedPath: string[];

  // Methods
  recommendedMethods: number[];
  methodReasoning: Record<string, string>;
  selectedMethods: number[];

  // Rubric
  rubric: Rubric | null;

  // Factory
  factoryPhase: 'idle' | 'diverge' | 'converge' | 'evolve' | 'interactive' | 'complete';
  factoryProgress: {
    detail: string;
    workersTotal?: number;
    workersDone?: number;
    workersFailed?: number;
  } | null;
  factoryStartedAt: number | null;
  workerIdeas: Map<string, RawIdea[]>;
  scoredIdeas: ScoredIdea[];
  evolvedIdeas: ScoredIdea[];
  combinedPool: ScoredIdea[];
  qaSheets: QAResult[];
  ideaPackages: IdeaPackage[];
  qaInProgress: boolean;
  packagingInProgress: boolean;

  // Thought feed
  thoughts: ThoughtEntry[];

  // Model tracking
  stageModels: Record<string, string>;
  sessionModels: SessionModels | null;

  // Actions
  setSessionId: (id: string | null) => void;
  setDomain: (domain: string) => void;
  setStage: (stage: Stage) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSseStatus: (status: SessionState['sseStatus']) => void;
  setTaxonomy: (tree: TaxonomyNode) => void;
  setSelectedPath: (path: string[]) => void;
  setMethodRecommendations: (recommended: number[], reasoning: Record<string, string>) => void;
  setSelectedMethods: (methods: number[]) => void;
  toggleMethod: (methodId: number) => void;
  setRubric: (rubric: Rubric) => void;
  setFactoryPhase: (phase: SessionState['factoryPhase']) => void;
  addWorkerIdea: (workerId: string, idea: RawIdea) => void;
  setScoredIdeas: (ideas: ScoredIdea[]) => void;
  setEvolvedIdeas: (ideas: ScoredIdea[]) => void;
  setCombinedPool: (ideas: ScoredIdea[]) => void;
  addQASheet: (sheet: QAResult) => void;
  addIdeaPackage: (pkg: IdeaPackage) => void;
  addThought: (agent: string, text: string, model?: string, timestamp?: number) => void;
  addStageCheckpoint: (stage: Stage) => void;
  clearDownstreamState: (targetStage: Stage) => void;
  hydrateFromSession: (data: SessionData) => void;
  handleSSEEvent: (event: SSEEvent) => void;
  reset: () => void;
}

const initialState = {
  sessionId: null,
  domain: '',
  stage: 'taxonomy' as Stage,
  isLoading: false,
  error: null,
  errorStage: null as string | null,
  sseStatus: 'disconnected' as const,
  taxonomy: null,
  selectedPath: [] as string[],
  recommendedMethods: [] as number[],
  methodReasoning: {} as Record<string, string>,
  selectedMethods: [] as number[],
  rubric: null,
  factoryPhase: 'idle' as const,
  factoryProgress: null as { detail: string; workersTotal?: number; workersDone?: number; workersFailed?: number } | null,
  factoryStartedAt: null as number | null,
  workerIdeas: new Map<string, RawIdea[]>(),
  scoredIdeas: [] as ScoredIdea[],
  evolvedIdeas: [] as ScoredIdea[],
  combinedPool: [] as ScoredIdea[],
  qaSheets: [] as QAResult[],
  ideaPackages: [] as IdeaPackage[],
  qaInProgress: false,
  packagingInProgress: false,
  thoughts: [] as ThoughtEntry[],
  stageModels: {} as Record<string, string>,
  sessionModels: null as SessionModels | null,
};

export const useSessionStore = create<SessionState>((set, get) => ({
  ...initialState,

  setSessionId: (id) => set({ sessionId: id }),
  setDomain: (domain) => set({ domain }),
  setStage: (stage) => set({ stage }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setSseStatus: (sseStatus) => set({ sseStatus }),
  setTaxonomy: (taxonomy) => set({ taxonomy }),
  setSelectedPath: (selectedPath) => set({ selectedPath }),

  setMethodRecommendations: (recommended, reasoning) =>
    set({
      recommendedMethods: recommended,
      methodReasoning: reasoning,
      selectedMethods: recommended,
    }),

  setSelectedMethods: (methods) => set({ selectedMethods: methods }),

  toggleMethod: (methodId) => {
    const current = get().selectedMethods;
    if (current.includes(methodId)) {
      set({ selectedMethods: current.filter((m) => m !== methodId) });
    } else {
      set({ selectedMethods: [...current, methodId] });
    }
  },

  setRubric: (rubric) => set({ rubric }),
  setFactoryPhase: (factoryPhase) => set({ factoryPhase }),

  addWorkerIdea: (workerId, idea) => {
    const map = new Map(get().workerIdeas);
    const existing = map.get(workerId) ?? [];
    map.set(workerId, [...existing, idea]);
    set({ workerIdeas: map });
  },

  setScoredIdeas: (scoredIdeas) => set({ scoredIdeas }),
  setEvolvedIdeas: (evolvedIdeas) => set({ evolvedIdeas }),
  setCombinedPool: (combinedPool) => set({ combinedPool }),

  addQASheet: (sheet) => {
    set({ qaSheets: [...get().qaSheets, sheet] });
  },

  addIdeaPackage: (pkg) => {
    set({ ideaPackages: [...get().ideaPackages, pkg] });
  },

  addThought: (agent, text, model?, timestamp?) => {
    const entry: ThoughtEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agent,
      text,
      timestamp: timestamp ?? Date.now(),
      model,
    };
    set({ thoughts: [...get().thoughts, entry] });
  },

  addStageCheckpoint: (stage) => {
    const stageInfo = STAGES.find((s) => s.id === stage);
    const entry: ThoughtEntry = {
      id: `checkpoint-${stage}-${Date.now()}`,
      agent: 'system',
      text: `${stageInfo?.label ?? stage} complete`,
      timestamp: Date.now(),
      stageCheckpoint: stage,
    };
    set({ thoughts: [...get().thoughts, entry] });
  },

  clearDownstreamState: (targetStage) => {
    const stageIdx = STAGE_ORDER.indexOf(targetStage);
    const updates: Partial<SessionState> = {
      stage: targetStage,
      isLoading: false,
      error: null,
      errorStage: null,
      thoughts: [],
    };

    // Special-case: taxonomy clears selectedPath but keeps tree
    if (targetStage === 'taxonomy') {
      updates.selectedPath = [];
    }

    // Clear data for stages AFTER the target (matching server < logic)
    if (stageIdx < STAGE_ORDER.indexOf('methods')) {
      updates.recommendedMethods = [];
      updates.methodReasoning = {};
      updates.selectedMethods = [];
    }
    if (stageIdx < STAGE_ORDER.indexOf('rubric')) {
      updates.rubric = null;
    }
    if (stageIdx < STAGE_ORDER.indexOf('factory')) {
      updates.factoryPhase = 'idle';
      updates.factoryProgress = null;
      updates.factoryStartedAt = null;
      updates.workerIdeas = new Map();
      updates.scoredIdeas = [];
      updates.evolvedIdeas = [];
      updates.combinedPool = [];
      updates.qaSheets = [];
      updates.ideaPackages = [];
      updates.qaInProgress = false;
      updates.packagingInProgress = false;
    }
    // Rolling back TO factory clears QA/packaging (interactive sub-operations)
    if (stageIdx <= STAGE_ORDER.indexOf('factory')) {
      updates.qaSheets = [];
      updates.ideaPackages = [];
      updates.qaInProgress = false;
      updates.packagingInProgress = false;
    }

    // Clear downstream stageModels
    const currentStageModels = get().stageModels;
    const cleanedStageModels: Record<string, string> = {};
    for (const [stage, model] of Object.entries(currentStageModels)) {
      const smIdx = STAGE_ORDER.indexOf(stage as Stage);
      if (smIdx < stageIdx) {
        cleanedStageModels[stage] = model;
      }
    }
    updates.stageModels = cleanedStageModels;

    set(updates);
  },

  hydrateFromSession: (data) => {
    const updates: Partial<SessionState> = {
      sessionId: data.id,
      domain: data.domain,
      stage: data.status as Stage,
    };

    if (data.taxonomy?.tree) {
      updates.taxonomy = data.taxonomy.tree;
      if (data.taxonomy.selectedPath) {
        updates.selectedPath = data.taxonomy.selectedPath;
      }
    }

    if (data.methods) {
      updates.recommendedMethods = data.methods.recommended;
      updates.methodReasoning = data.methods.reasoning;
      updates.selectedMethods = data.methods.selected;
    }

    if (data.rubric) {
      updates.rubric = data.rubric;
    }

    set(updates);

    // Hydrate factory ideas by phase (needs sequential addWorkerIdea calls)
    const store = get();
    if (data.ideas && data.ideas.length > 0) {
      const divergeIdeas = data.ideas.filter((i) => i.phase === 'diverge');
      const convergeIdeas = data.ideas.filter((i) => i.phase === 'converge');
      const evolveIdeas = data.ideas.filter((i) => i.phase === 'evolve');

      for (const idea of divergeIdeas) {
        if (idea.workerId && idea.data) {
          store.addWorkerIdea(idea.workerId, idea.data);
        }
      }

      if (convergeIdeas.length > 0) {
        store.setScoredIdeas(convergeIdeas.filter((i) => i.data).map((i) => ({ ...i.data, id: i.id })));
      }

      if (evolveIdeas.length > 0) {
        store.setEvolvedIdeas(evolveIdeas.filter((i) => i.data).map((i) => ({ ...i.data, id: i.id })));
      }

      // Reconstruct combined pool from non-eliminated converge + evolve ideas
      // Override data.id with DB row id so IDs match what QA/packaging expect
      const poolIdeas = [...convergeIdeas, ...evolveIdeas]
        .filter((i) => i.data && !i.data.eliminated)
        .map((i) => ({ ...i.data, id: i.id }));
      if (poolIdeas.length > 0) {
        store.setCombinedPool(poolIdeas);
      }

      if (evolveIdeas.length > 0 || convergeIdeas.length > 0) {
        store.setFactoryPhase('evolve');
      } else if (divergeIdeas.length > 0) {
        store.setFactoryPhase('diverge');
      }
    }

    // Hydrate QA sheets
    if (data.qaSheets && data.qaSheets.length > 0) {
      const qaResults: QAResult[] = data.qaSheets.map((s) => ({
        conceptId: s.ideaId,
        feasibilityScore: s.feasibilityScore,
        verdict: s.verdict as 'strong' | 'conditional' | 'weak',
        summary: s.summary,
        risks: s.risks,
      }));
      set({ qaSheets: qaResults, factoryPhase: 'interactive' });
    } else if (data.ideas?.some((i) => i.phase === 'evolve' || i.phase === 'converge')) {
      // If we have evolved/converged ideas but no QA, we're in interactive mode
      set({ factoryPhase: 'interactive' });
    }

    // Hydrate idea packages
    if (data.ideaPackages && data.ideaPackages.length > 0) {
      set({
        ideaPackages: data.ideaPackages.map((p) => ({
          ideaId: p.ideaId,
          ideaName: p.ideaName,
          htmlContent: p.htmlContent,
          deepResearchPrompt: p.deepResearchPrompt,
        })),
      });
    }

    if (data.status === 'completed') {
      set({ factoryPhase: 'complete' });
    }

    // Populate sessionModels from config
    if (data.config?.models) {
      set({ sessionModels: data.config.models });
    }

    // Hydrate thoughts from event log and reconstruct stageModels
    if (data.eventLog) {
      let lastModel: string | undefined;
      const hydratedStageModels: Record<string, string> = {};

      for (const entry of data.eventLog) {
        if (entry.type === 'agent:thought') {
          store.addThought(entry.data.agent, entry.data.text, entry.data.model, entry.createdAt);
          if (entry.data.model) lastModel = entry.data.model;
        } else if (entry.type === 'agent:tool_use') {
          store.addThought(entry.data.agent, `Using tool: ${entry.data.tool}`, entry.data.model, entry.createdAt);
          if (entry.data.model) lastModel = entry.data.model;
        } else if (entry.type === 'status:stage_start') {
          store.addThought('system', `Starting ${entry.data.stage} stage...`, undefined, entry.createdAt);
        } else if (entry.type === 'status:stage_complete') {
          if (lastModel) {
            hydratedStageModels[entry.data.stage] = lastModel;
          }
        }
      }

      if (Object.keys(hydratedStageModels).length > 0) {
        set({ stageModels: hydratedStageModels });
      }
    }
  },

  handleSSEEvent: (event) => {
    const store = get();
    switch (event.type) {
      case 'agent:thought':
        store.addThought(event.data.agent, event.data.text, event.data.model);
        break;
      case 'agent:tool_use':
        store.addThought(event.data.agent, `Using tool: ${event.data.tool}`, event.data.model);
        break;
      case 'data:taxonomy_update':
        set({ taxonomy: event.data, isLoading: false });
        break;
      case 'data:methods_recommended':
        store.setMethodRecommendations(event.data.recommended, event.data.reasoning);
        set({ isLoading: false });
        break;
      case 'data:rubric_generated':
        set({ rubric: event.data, isLoading: false });
        break;
      case 'data:idea_stream':
        set({ factoryPhase: 'diverge' });
        store.addWorkerIdea(event.data.workerId, event.data.idea);
        break;
      case 'data:convergence_result':
        set({
          factoryPhase: 'converge',
          factoryProgress: null,
          scoredIdeas: [...event.data.survivors, ...event.data.eliminated],
        });
        break;
      case 'data:evolution_result':
        set({ factoryPhase: 'evolve', factoryProgress: null, evolvedIdeas: event.data.evolved });
        break;
      case 'factory:interactive':
        set({
          factoryPhase: 'interactive',
          factoryProgress: null,
          combinedPool: event.data.combinedPool,
          factoryStartedAt: null,
        });
        break;
      case 'data:qa_sheet':
        store.addQASheet(event.data);
        break;
      case 'data:idea_package':
        store.addIdeaPackage(event.data);
        break;
      case 'factory:progress':
        set({ factoryProgress: event.data });
        break;
      case 'status:stage_complete': {
        set({ factoryPhase: event.data.stage === 'factory' ? 'complete' : get().factoryPhase });
        // Infer model from last thought with a model field
        const thoughts = get().thoughts;
        const lastModelThought = [...thoughts].reverse().find((t) => t.model);
        if (lastModelThought?.model) {
          set({ stageModels: { ...get().stageModels, [event.data.stage]: lastModelThought.model } });
        }
        store.addStageCheckpoint(event.data.stage as Stage);
        break;
      }
      case 'status:stage_start':
        set({
          isLoading: true,
          error: null,
          errorStage: null,
          ...(event.data.stage === 'factory' ? { factoryStartedAt: Date.now(), factoryProgress: null } : {}),
        });
        store.addThought('system', `Starting ${event.data.stage} stage...`);
        break;
      case 'status:error':
        set({ error: event.data.error, errorStage: event.data.stage, isLoading: false, factoryPhase: 'idle', factoryProgress: null, factoryStartedAt: null, qaInProgress: false, packagingInProgress: false });
        break;
    }
  },

  reset: () =>
    set({
      ...initialState,
      thoughts: [],
      stageModels: {},
      sessionModels: null,
      errorStage: null,
      sseStatus: 'disconnected',
      factoryProgress: null,
      factoryStartedAt: null,
    }),
}));
