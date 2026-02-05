import { create } from 'zustand';
import { STAGE_ORDER, STAGES } from '@ideafactory/shared';
import type { Stage, SessionModels, TaxonomyNode, Rubric, RawIdea, ScoredIdea, QAResult, OutputPackage, SSEEvent } from '@ideafactory/shared';

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
  output: { package: OutputPackage; artifacts: any } | null;
  eventLog: { type: string; data: any }[];
}

interface SessionState {
  // Current session
  sessionId: string | null;
  domain: string;
  stage: Stage;
  isLoading: boolean;
  error: string | null;

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
  factoryPhase: 'idle' | 'diverge' | 'converge' | 'evolve' | 'qa' | 'complete';
  workerIdeas: Map<string, RawIdea[]>;
  scoredIdeas: ScoredIdea[];
  evolvedIdeas: ScoredIdea[];
  qaResults: QAResult[];

  // Output
  outputPackage: OutputPackage | null;

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
  setQAResults: (results: QAResult[]) => void;
  setOutputPackage: (pkg: OutputPackage) => void;
  addThought: (agent: string, text: string, model?: string) => void;
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
  taxonomy: null,
  selectedPath: [] as string[],
  recommendedMethods: [] as number[],
  methodReasoning: {} as Record<string, string>,
  selectedMethods: [] as number[],
  rubric: null,
  factoryPhase: 'idle' as const,
  workerIdeas: new Map<string, RawIdea[]>(),
  scoredIdeas: [] as ScoredIdea[],
  evolvedIdeas: [] as ScoredIdea[],
  qaResults: [] as QAResult[],
  outputPackage: null,
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
  setQAResults: (qaResults) => set({ qaResults }),
  setOutputPackage: (outputPackage) => set({ outputPackage }),

  addThought: (agent, text, model?) => {
    const entry: ThoughtEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agent,
      text,
      timestamp: Date.now(),
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
      updates.workerIdeas = new Map();
      updates.scoredIdeas = [];
      updates.evolvedIdeas = [];
      updates.qaResults = [];
    }
    if (stageIdx < STAGE_ORDER.indexOf('output')) {
      updates.outputPackage = null;
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

    if (data.output?.package) {
      updates.outputPackage = data.output.package;
    }

    set(updates);

    // Hydrate factory ideas by phase (needs sequential addWorkerIdea calls)
    const store = get();
    if (data.ideas && data.ideas.length > 0) {
      const divergeIdeas = data.ideas.filter((i) => i.phase === 'diverge');
      const convergeIdeas = data.ideas.filter((i) => i.phase === 'converge');
      const evolveIdeas = data.ideas.filter((i) => i.phase === 'evolve');
      const qaIdeas = data.ideas.filter((i) => i.phase === 'qa');

      for (const idea of divergeIdeas) {
        if (idea.workerId && idea.data) {
          store.addWorkerIdea(idea.workerId, idea.data);
        }
      }

      if (convergeIdeas.length > 0) {
        store.setScoredIdeas(convergeIdeas.filter((i) => i.data).map((i) => i.data));
      }

      if (evolveIdeas.length > 0) {
        store.setEvolvedIdeas(evolveIdeas.filter((i) => i.data).map((i) => i.data));
      }

      if (qaIdeas.length > 0) {
        store.setQAResults(qaIdeas.filter((i) => i.data).map((i) => i.data));
      }

      if (qaIdeas.length > 0) {
        store.setFactoryPhase('qa');
      } else if (evolveIdeas.length > 0) {
        store.setFactoryPhase('evolve');
      } else if (convergeIdeas.length > 0) {
        store.setFactoryPhase('converge');
      } else if (divergeIdeas.length > 0) {
        store.setFactoryPhase('diverge');
      }

      if (data.status === 'output' || data.status === 'completed') {
        store.setFactoryPhase('complete');
      }
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
          store.addThought(entry.data.agent, entry.data.text, entry.data.model);
          if (entry.data.model) lastModel = entry.data.model;
        } else if (entry.type === 'agent:tool_use') {
          store.addThought(entry.data.agent, `Using tool: ${entry.data.tool}`, entry.data.model);
          if (entry.data.model) lastModel = entry.data.model;
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
          scoredIdeas: [...event.data.survivors, ...event.data.eliminated],
        });
        break;
      case 'data:evolution_result':
        set({ factoryPhase: 'evolve', evolvedIdeas: event.data.evolved });
        break;
      case 'data:qa_result':
        set({ factoryPhase: 'qa', qaResults: event.data.reviewed });
        break;
      case 'data:output_package':
        set({ outputPackage: event.data });
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
      case 'status:error':
        set({ error: event.data.error, isLoading: false });
        break;
    }
  },

  reset: () => set({ ...initialState, thoughts: [], stageModels: {}, sessionModels: null }),
}));
