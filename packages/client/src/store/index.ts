import { create } from 'zustand';
import type { Stage, TaxonomyNode, Rubric, RawIdea, ScoredIdea, QAResult, OutputPackage, SSEEvent } from '@ideafactory/shared';

interface ThoughtEntry {
  id: string;
  agent: string;
  text: string;
  timestamp: number;
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
  addThought: (agent: string, text: string) => void;
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
  selectedPath: [],
  recommendedMethods: [],
  methodReasoning: {},
  selectedMethods: [],
  rubric: null,
  factoryPhase: 'idle' as const,
  workerIdeas: new Map<string, RawIdea[]>(),
  scoredIdeas: [],
  evolvedIdeas: [],
  qaResults: [],
  outputPackage: null,
  thoughts: [],
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

  addThought: (agent, text) => {
    const entry: ThoughtEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agent,
      text,
      timestamp: Date.now(),
    };
    set({ thoughts: [...get().thoughts, entry] });
  },

  handleSSEEvent: (event) => {
    const store = get();
    switch (event.type) {
      case 'agent:thought':
        store.addThought(event.data.agent, event.data.text);
        break;
      case 'agent:tool_use':
        store.addThought(event.data.agent, `Using tool: ${event.data.tool}`);
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
      case 'status:stage_complete':
        set({ factoryPhase: event.data.stage === 'factory' ? 'complete' : get().factoryPhase });
        break;
      case 'status:error':
        set({ error: event.data.error, isLoading: false });
        break;
    }
  },

  reset: () => set({ ...initialState, thoughts: [] }),
}));
