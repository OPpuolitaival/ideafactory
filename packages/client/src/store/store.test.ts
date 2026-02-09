import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSessionStore } from './index.js';
import type { SSEEvent } from '@ideafactory/shared';
import type { TaxonomyNode, Rubric, RawIdea, ScoredIdea, QAResult, IdeaPackage } from '@ideafactory/shared';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const taxonomyNode: TaxonomyNode = {
  name: 'Root',
  p: 'high',
  children: [{ name: 'Child', p: 'medium' }],
};

const rubric: Rubric = {
  gates: [{ id: 'g1', text: 'Gate 1' }],
  criteria: [{ id: 'c1', text: 'Criterion 1', weight: 3, description: 'desc' }],
  tests: [{ id: 't1', text: 'Test 1' }],
};

const rawIdea: RawIdea = {
  id: 'i1',
  workerId: 'w0',
  persona: 'Engineer',
  method: 'First Principles',
  name: 'Widget',
  description: 'A new widget',
  probability: 'high',
};

const rawIdea2: RawIdea = {
  id: 'i2',
  workerId: 'w0',
  persona: 'Engineer',
  method: 'TRIZ',
  name: 'Gadget',
  description: 'A new gadget',
  probability: 'medium',
};

const rawIdeaWorker1: RawIdea = {
  id: 'i3',
  workerId: 'w1',
  persona: 'Visionary',
  method: 'Inversion',
  name: 'Doohickey',
  description: 'Something radical',
  probability: 'low',
};

const scoredIdea: ScoredIdea = {
  id: 's1',
  sourceIds: ['i1'],
  name: 'Widget',
  description: 'A new widget',
  gateResults: [{ gateId: 'g1', pass: true, reason: 'OK' }],
  criteriaScores: [{ criterionId: 'c1', score: 4, reason: 'Good' }],
  totalScore: 4,
  eliminated: false,
};

const eliminatedIdea: ScoredIdea = {
  id: 's2',
  sourceIds: ['i2'],
  name: 'Gadget',
  description: 'A new gadget',
  gateResults: [{ gateId: 'g1', pass: false, reason: 'Fails gate' }],
  criteriaScores: [{ criterionId: 'c1', score: 1, reason: 'Poor' }],
  totalScore: 1,
  eliminated: true,
  eliminationReason: 'Did not pass gate',
};

const evolvedIdea: ScoredIdea = {
  ...scoredIdea,
  id: 'e1',
  totalScore: 5,
};

const qaResult: QAResult = {
  conceptId: 's1',
  feasibilityScore: 4,
  risks: [{ category: 'Tech', description: 'Risk', severity: 'medium' }],
  verdict: 'strong',
  summary: 'Solid concept.',
};

const ideaPackage: IdeaPackage = {
  ideaId: 's1',
  ideaName: 'Widget',
  htmlContent: '<html><body>Report</body></html>',
  deepResearchPrompt: '## Research\nInvestigate feasibility...',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  useSessionStore.setState({
    sessionId: null,
    domain: '',
    stage: 'taxonomy',
    isLoading: false,
    error: null,
    errorStage: null,
    sseStatus: 'disconnected',
    taxonomy: null,
    selectedPath: [],
    recommendedMethods: [],
    methodReasoning: {},
    selectedMethods: [],
    rubric: null,
    factoryPhase: 'idle',
    factoryProgress: null,
    factoryStartedAt: null,
    workerIdeas: new Map(),
    scoredIdeas: [],
    evolvedIdeas: [],
    combinedPool: [],
    qaSheets: [],
    ideaPackages: [],
    qaInProgress: false,
    packagingInProgress: false,
    thoughts: [],
    stageModels: {},
    sessionModels: null,
  });
});

// =========================================================================
// Basic setters
// =========================================================================

describe('Basic setters', () => {
  it('setSessionId sets sessionId', () => {
    useSessionStore.getState().setSessionId('abc-123');
    expect(useSessionStore.getState().sessionId).toBe('abc-123');
  });

  it('setSessionId can set null', () => {
    useSessionStore.getState().setSessionId('abc-123');
    useSessionStore.getState().setSessionId(null);
    expect(useSessionStore.getState().sessionId).toBeNull();
  });

  it('setDomain sets domain', () => {
    useSessionStore.getState().setDomain('Robotics');
    expect(useSessionStore.getState().domain).toBe('Robotics');
  });

  it('setStage sets stage', () => {
    useSessionStore.getState().setStage('methods');
    expect(useSessionStore.getState().stage).toBe('methods');
  });

  it('setLoading sets isLoading', () => {
    useSessionStore.getState().setLoading(true);
    expect(useSessionStore.getState().isLoading).toBe(true);
  });

  it('setError sets error', () => {
    useSessionStore.getState().setError('Something broke');
    expect(useSessionStore.getState().error).toBe('Something broke');
  });

  it('setError can clear error with null', () => {
    useSessionStore.getState().setError('oops');
    useSessionStore.getState().setError(null);
    expect(useSessionStore.getState().error).toBeNull();
  });

  it('setSseStatus sets sseStatus', () => {
    useSessionStore.getState().setSseStatus('connected');
    expect(useSessionStore.getState().sseStatus).toBe('connected');
  });

  it('setSseStatus transitions through states', () => {
    useSessionStore.getState().setSseStatus('connecting');
    expect(useSessionStore.getState().sseStatus).toBe('connecting');
    useSessionStore.getState().setSseStatus('connected');
    expect(useSessionStore.getState().sseStatus).toBe('connected');
    useSessionStore.getState().setSseStatus('reconnecting');
    expect(useSessionStore.getState().sseStatus).toBe('reconnecting');
    useSessionStore.getState().setSseStatus('disconnected');
    expect(useSessionStore.getState().sseStatus).toBe('disconnected');
  });
});

// =========================================================================
// Taxonomy
// =========================================================================

describe('Taxonomy', () => {
  it('setTaxonomy stores tree', () => {
    useSessionStore.getState().setTaxonomy(taxonomyNode);
    expect(useSessionStore.getState().taxonomy).toEqual(taxonomyNode);
  });

  it('setSelectedPath stores path array', () => {
    useSessionStore.getState().setSelectedPath(['Root', 'Child']);
    expect(useSessionStore.getState().selectedPath).toEqual(['Root', 'Child']);
  });
});

// =========================================================================
// Methods
// =========================================================================

describe('Methods', () => {
  it('setMethodRecommendations sets recommended, reasoning, and defaults selectedMethods', () => {
    const reasoning = { '1': 'Good for this', '3': 'Also good' };
    useSessionStore.getState().setMethodRecommendations([1, 3], reasoning);

    const state = useSessionStore.getState();
    expect(state.recommendedMethods).toEqual([1, 3]);
    expect(state.methodReasoning).toEqual(reasoning);
    expect(state.selectedMethods).toEqual([1, 3]);
  });

  it('setSelectedMethods overrides selected methods', () => {
    useSessionStore.getState().setMethodRecommendations([1, 3], {});
    useSessionStore.getState().setSelectedMethods([1, 5, 7]);
    expect(useSessionStore.getState().selectedMethods).toEqual([1, 5, 7]);
  });

  it('toggleMethod adds method when not present', () => {
    useSessionStore.getState().setSelectedMethods([1, 3]);
    useSessionStore.getState().toggleMethod(5);
    expect(useSessionStore.getState().selectedMethods).toEqual([1, 3, 5]);
  });

  it('toggleMethod removes method when present', () => {
    useSessionStore.getState().setSelectedMethods([1, 3, 5]);
    useSessionStore.getState().toggleMethod(3);
    expect(useSessionStore.getState().selectedMethods).toEqual([1, 5]);
  });

  it('toggleMethod on empty list adds the method', () => {
    useSessionStore.getState().toggleMethod(7);
    expect(useSessionStore.getState().selectedMethods).toEqual([7]);
  });
});

// =========================================================================
// Rubric
// =========================================================================

describe('Rubric', () => {
  it('setRubric stores rubric', () => {
    useSessionStore.getState().setRubric(rubric);
    expect(useSessionStore.getState().rubric).toEqual(rubric);
  });
});

// =========================================================================
// Factory
// =========================================================================

describe('Factory', () => {
  it('setFactoryPhase changes phase', () => {
    useSessionStore.getState().setFactoryPhase('diverge');
    expect(useSessionStore.getState().factoryPhase).toBe('diverge');
  });

  it('addWorkerIdea adds to map for new worker', () => {
    useSessionStore.getState().addWorkerIdea('w0', rawIdea);
    const ideas = useSessionStore.getState().workerIdeas.get('w0');
    expect(ideas).toHaveLength(1);
    expect(ideas![0]).toEqual(rawIdea);
  });

  it('addWorkerIdea appends to existing worker ideas', () => {
    useSessionStore.getState().addWorkerIdea('w0', rawIdea);
    useSessionStore.getState().addWorkerIdea('w0', rawIdea2);
    const ideas = useSessionStore.getState().workerIdeas.get('w0');
    expect(ideas).toHaveLength(2);
    expect(ideas![0]).toEqual(rawIdea);
    expect(ideas![1]).toEqual(rawIdea2);
  });

  it('addWorkerIdea handles multiple workers independently', () => {
    useSessionStore.getState().addWorkerIdea('w0', rawIdea);
    useSessionStore.getState().addWorkerIdea('w1', rawIdeaWorker1);
    const map = useSessionStore.getState().workerIdeas;
    expect(map.get('w0')).toHaveLength(1);
    expect(map.get('w1')).toHaveLength(1);
    expect(map.get('w0')![0].id).toBe('i1');
    expect(map.get('w1')![0].id).toBe('i3');
  });

  it('setScoredIdeas stores scored ideas', () => {
    useSessionStore.getState().setScoredIdeas([scoredIdea, eliminatedIdea]);
    expect(useSessionStore.getState().scoredIdeas).toEqual([scoredIdea, eliminatedIdea]);
  });

  it('setEvolvedIdeas stores evolved ideas', () => {
    useSessionStore.getState().setEvolvedIdeas([evolvedIdea]);
    expect(useSessionStore.getState().evolvedIdeas).toEqual([evolvedIdea]);
  });

  it('setCombinedPool stores combined pool', () => {
    useSessionStore.getState().setCombinedPool([scoredIdea, evolvedIdea]);
    expect(useSessionStore.getState().combinedPool).toEqual([scoredIdea, evolvedIdea]);
  });

  it('addQASheet appends to qaSheets', () => {
    useSessionStore.getState().addQASheet(qaResult);
    expect(useSessionStore.getState().qaSheets).toEqual([qaResult]);
  });

  it('addIdeaPackage appends to ideaPackages', () => {
    useSessionStore.getState().addIdeaPackage(ideaPackage);
    expect(useSessionStore.getState().ideaPackages).toEqual([ideaPackage]);
  });
});

// =========================================================================
// Thought feed
// =========================================================================

describe('Thought feed', () => {
  it('addThought appends entry with agent, text, timestamp, and id', () => {
    const before = Date.now();
    useSessionStore.getState().addThought('navigator', 'Exploring domain');
    const after = Date.now();

    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts).toHaveLength(1);

    const entry = thoughts[0];
    expect(entry.agent).toBe('navigator');
    expect(entry.text).toBe('Exploring domain');
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
    expect(entry.id).toBeDefined();
    expect(typeof entry.id).toBe('string');
    expect(entry.id.length).toBeGreaterThan(0);
  });

  it('addThought appends multiple entries in order', () => {
    useSessionStore.getState().addThought('navigator', 'First');
    useSessionStore.getState().addThought('strategist', 'Second');
    useSessionStore.getState().addThought('worker', 'Third');

    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts).toHaveLength(3);
    expect(thoughts[0].text).toBe('First');
    expect(thoughts[1].text).toBe('Second');
    expect(thoughts[2].text).toBe('Third');
  });

  it('addThought stores model when provided', () => {
    useSessionStore.getState().addThought('navigator', 'Thinking', 'claude-opus-4-6');
    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts[0].model).toBe('claude-opus-4-6');
  });

  it('addThought leaves model undefined when not provided', () => {
    useSessionStore.getState().addThought('navigator', 'Thinking');
    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts[0].model).toBeUndefined();
  });

  it('addThought uses provided timestamp when given', () => {
    const customTs = 1700000000000;
    useSessionStore.getState().addThought('navigator', 'Historic thought', undefined, customTs);
    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts[0].timestamp).toBe(customTs);
  });

  it('addThought uses Date.now() when timestamp not provided', () => {
    const before = Date.now();
    useSessionStore.getState().addThought('navigator', 'Now thought');
    const after = Date.now();
    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(thoughts[0].timestamp).toBeLessThanOrEqual(after);
  });
});

// =========================================================================
// handleSSEEvent
// =========================================================================

describe('handleSSEEvent', () => {
  it('agent:thought adds thought entry', () => {
    const event: SSEEvent = {
      type: 'agent:thought',
      data: { agent: 'navigator', text: 'Thinking about taxonomy' },
    };
    useSessionStore.getState().handleSSEEvent(event);

    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0].agent).toBe('navigator');
    expect(thoughts[0].text).toBe('Thinking about taxonomy');
  });

  it('agent:thought passes model to thought entry', () => {
    const event: SSEEvent = {
      type: 'agent:thought',
      data: { agent: 'navigator', text: 'Working', model: 'claude-opus-4-6' },
    };
    useSessionStore.getState().handleSSEEvent(event);
    expect(useSessionStore.getState().thoughts[0].model).toBe('claude-opus-4-6');
  });

  it('agent:tool_use adds thought with "Using tool: X"', () => {
    const event: SSEEvent = {
      type: 'agent:tool_use',
      data: { agent: 'strategist', tool: 'web_search' },
    };
    useSessionStore.getState().handleSSEEvent(event);

    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0].agent).toBe('strategist');
    expect(thoughts[0].text).toBe('Using tool: web_search');
  });

  it('data:taxonomy_update sets taxonomy and clears isLoading', () => {
    useSessionStore.setState({ isLoading: true });

    const event: SSEEvent = {
      type: 'data:taxonomy_update',
      data: taxonomyNode,
    };
    useSessionStore.getState().handleSSEEvent(event);

    const state = useSessionStore.getState();
    expect(state.taxonomy).toEqual(taxonomyNode);
    expect(state.isLoading).toBe(false);
  });

  it('data:methods_recommended sets recommendations and selectedMethods', () => {
    useSessionStore.setState({ isLoading: true });

    const event: SSEEvent = {
      type: 'data:methods_recommended',
      data: {
        recommended: [1, 3, 5],
        reasoning: { '1': 'Reason A', '3': 'Reason B', '5': 'Reason C' },
      },
    };
    useSessionStore.getState().handleSSEEvent(event);

    const state = useSessionStore.getState();
    expect(state.recommendedMethods).toEqual([1, 3, 5]);
    expect(state.methodReasoning).toEqual({ '1': 'Reason A', '3': 'Reason B', '5': 'Reason C' });
    expect(state.selectedMethods).toEqual([1, 3, 5]);
    expect(state.isLoading).toBe(false);
  });

  it('data:rubric_generated sets rubric and clears isLoading', () => {
    useSessionStore.setState({ isLoading: true });

    const event: SSEEvent = {
      type: 'data:rubric_generated',
      data: rubric,
    };
    useSessionStore.getState().handleSSEEvent(event);

    const state = useSessionStore.getState();
    expect(state.rubric).toEqual(rubric);
    expect(state.isLoading).toBe(false);
  });

  it('data:idea_stream sets factoryPhase to diverge and adds worker idea', () => {
    const event: SSEEvent = {
      type: 'data:idea_stream',
      data: { workerId: 'w0', persona: 'Engineer', idea: rawIdea },
    };
    useSessionStore.getState().handleSSEEvent(event);

    const state = useSessionStore.getState();
    expect(state.factoryPhase).toBe('diverge');
    expect(state.workerIdeas.get('w0')).toHaveLength(1);
    expect(state.workerIdeas.get('w0')![0]).toEqual(rawIdea);
  });

  it('data:idea_stream accumulates ideas across multiple events', () => {
    const event1: SSEEvent = {
      type: 'data:idea_stream',
      data: { workerId: 'w0', persona: 'Engineer', idea: rawIdea },
    };
    const event2: SSEEvent = {
      type: 'data:idea_stream',
      data: { workerId: 'w0', persona: 'Engineer', idea: rawIdea2 },
    };
    useSessionStore.getState().handleSSEEvent(event1);
    useSessionStore.getState().handleSSEEvent(event2);

    expect(useSessionStore.getState().workerIdeas.get('w0')).toHaveLength(2);
  });

  it('data:convergence_result sets factoryPhase to converge and stores all scored ideas', () => {
    const event: SSEEvent = {
      type: 'data:convergence_result',
      data: { survivors: [scoredIdea], eliminated: [eliminatedIdea] },
    };
    useSessionStore.getState().handleSSEEvent(event);

    const state = useSessionStore.getState();
    expect(state.factoryPhase).toBe('converge');
    expect(state.scoredIdeas).toHaveLength(2);
    expect(state.scoredIdeas).toEqual([scoredIdea, eliminatedIdea]);
  });

  it('data:evolution_result sets factoryPhase to evolve and stores evolved ideas', () => {
    const event: SSEEvent = {
      type: 'data:evolution_result',
      data: { evolved: [evolvedIdea] },
    };
    useSessionStore.getState().handleSSEEvent(event);

    const state = useSessionStore.getState();
    expect(state.factoryPhase).toBe('evolve');
    expect(state.evolvedIdeas).toEqual([evolvedIdea]);
  });

  it('factory:interactive sets factoryPhase to interactive and stores combinedPool', () => {
    const event: SSEEvent = {
      type: 'factory:interactive',
      data: { combinedPool: [scoredIdea, evolvedIdea] },
    };
    useSessionStore.getState().handleSSEEvent(event);

    const state = useSessionStore.getState();
    expect(state.factoryPhase).toBe('interactive');
    expect(state.combinedPool).toEqual([scoredIdea, evolvedIdea]);
  });

  it('data:qa_sheet appends to qaSheets', () => {
    const event: SSEEvent = {
      type: 'data:qa_sheet',
      data: qaResult,
    };
    useSessionStore.getState().handleSSEEvent(event);

    const state = useSessionStore.getState();
    expect(state.qaSheets).toEqual([qaResult]);
  });

  it('data:idea_package appends to ideaPackages', () => {
    const event: SSEEvent = {
      type: 'data:idea_package',
      data: ideaPackage,
    };
    useSessionStore.getState().handleSSEEvent(event);

    expect(useSessionStore.getState().ideaPackages).toEqual([ideaPackage]);
  });

  it('factory:progress sets factoryProgress', () => {
    const event: SSEEvent = {
      type: 'factory:progress',
      data: {
        phase: 'diverge',
        detail: '2/3 workers complete (30 ideas)',
        workersTotal: 3,
        workersDone: 2,
        workersFailed: 0,
      },
    };
    useSessionStore.getState().handleSSEEvent(event);

    const state = useSessionStore.getState();
    expect(state.factoryProgress).toEqual({
      phase: 'diverge',
      detail: '2/3 workers complete (30 ideas)',
      workersTotal: 3,
      workersDone: 2,
      workersFailed: 0,
    });
  });

  it('factory:progress is cleared on data:convergence_result', () => {
    // Set progress first
    useSessionStore.getState().handleSSEEvent({
      type: 'factory:progress',
      data: { phase: 'converge', detail: 'Scoring 45 ideas...' },
    } as SSEEvent);
    expect(useSessionStore.getState().factoryProgress).not.toBeNull();

    // Convergence result clears it
    useSessionStore.getState().handleSSEEvent({
      type: 'data:convergence_result',
      data: { survivors: [scoredIdea], eliminated: [eliminatedIdea] },
    } as SSEEvent);
    expect(useSessionStore.getState().factoryProgress).toBeNull();
  });

  it('status:stage_start with factory sets factoryStartedAt', () => {
    const before = Date.now();
    useSessionStore.getState().handleSSEEvent({
      type: 'status:stage_start',
      data: { stage: 'factory' },
    } as SSEEvent);
    const after = Date.now();

    const startedAt = useSessionStore.getState().factoryStartedAt;
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(after);
  });

  it('status:stage_start with non-factory does not set factoryStartedAt', () => {
    useSessionStore.getState().handleSSEEvent({
      type: 'status:stage_start',
      data: { stage: 'taxonomy' },
    } as SSEEvent);

    expect(useSessionStore.getState().factoryStartedAt).toBeNull();
  });

  it('status:stage_complete with factory stage sets factoryPhase to complete and adds checkpoint', () => {
    useSessionStore.setState({ factoryPhase: 'interactive' });

    const event: SSEEvent = {
      type: 'status:stage_complete',
      data: { stage: 'factory', next: 'completed' },
    };
    useSessionStore.getState().handleSSEEvent(event);

    expect(useSessionStore.getState().factoryPhase).toBe('complete');
    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0].stageCheckpoint).toBe('factory');
    expect(thoughts[0].text).toBe('Factory complete');
  });

  it('status:stage_complete populates stageModels from last thought model', () => {
    // Add a thought with model
    const thoughtEvent: SSEEvent = {
      type: 'agent:thought',
      data: { agent: 'navigator', text: 'Working', model: 'claude-haiku-4-5-20251001' },
    };
    useSessionStore.getState().handleSSEEvent(thoughtEvent);

    const stageEvent: SSEEvent = {
      type: 'status:stage_complete',
      data: { stage: 'taxonomy', next: 'methods' },
    };
    useSessionStore.getState().handleSSEEvent(stageEvent);

    expect(useSessionStore.getState().stageModels).toEqual({ taxonomy: 'claude-haiku-4-5-20251001' });
  });

  it('status:stage_complete with non-factory stage does not change factoryPhase but adds checkpoint', () => {
    useSessionStore.setState({ factoryPhase: 'idle' });

    const event: SSEEvent = {
      type: 'status:stage_complete',
      data: { stage: 'taxonomy', next: 'methods' },
    };
    useSessionStore.getState().handleSSEEvent(event);

    expect(useSessionStore.getState().factoryPhase).toBe('idle');
    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0].stageCheckpoint).toBe('taxonomy');
    expect(thoughts[0].text).toBe('Taxonomy complete');
  });

  it('status:error sets error, errorStage, and clears isLoading', () => {
    useSessionStore.setState({ isLoading: true });

    const event: SSEEvent = {
      type: 'status:error',
      data: { stage: 'taxonomy', error: 'LLM timeout' },
    };
    useSessionStore.getState().handleSSEEvent(event);

    const state = useSessionStore.getState();
    expect(state.error).toBe('LLM timeout');
    expect(state.errorStage).toBe('taxonomy');
    expect(state.isLoading).toBe(false);
  });

  it('status:error clears factoryProgress, factoryStartedAt, and factoryPhase', () => {
    useSessionStore.setState({
      isLoading: true,
      factoryPhase: 'converge',
      factoryProgress: { detail: 'Scoring 45 ideas...' },
      factoryStartedAt: Date.now(),
    });

    useSessionStore.getState().handleSSEEvent({
      type: 'status:error',
      data: { stage: 'factory', error: 'Worker timeout' },
    } as SSEEvent);

    const state = useSessionStore.getState();
    expect(state.factoryProgress).toBeNull();
    expect(state.factoryStartedAt).toBeNull();
    expect(state.factoryPhase).toBe('idle');
  });

  it('status:stage_start sets isLoading and clears error/errorStage', () => {
    useSessionStore.setState({ isLoading: false, error: 'old error', errorStage: 'taxonomy' });

    const event: SSEEvent = {
      type: 'status:stage_start',
      data: { stage: 'methods' },
    };
    useSessionStore.getState().handleSSEEvent(event);

    const state = useSessionStore.getState();
    expect(state.isLoading).toBe(true);
    expect(state.error).toBeNull();
    expect(state.errorStage).toBeNull();
    expect(state.thoughts).toHaveLength(1);
    expect(state.thoughts[0].agent).toBe('system');
    expect(state.thoughts[0].text).toBe('Starting methods stage...');
  });
});

// =========================================================================
// Reset
// =========================================================================

describe('reset', () => {
  it('clears all state back to initial values', () => {
    // Populate the store with non-default values
    useSessionStore.setState({
      sessionId: 'sess-1',
      domain: 'Robotics',
      stage: 'factory',
      isLoading: true,
      error: 'some error',
      errorStage: 'factory',
      sseStatus: 'connected',
      taxonomy: taxonomyNode,
      selectedPath: ['Root', 'Child'],
      recommendedMethods: [1, 3],
      methodReasoning: { '1': 'reason' },
      selectedMethods: [1, 3, 5],
      rubric: rubric,
      factoryPhase: 'converge',
      scoredIdeas: [scoredIdea],
      evolvedIdeas: [evolvedIdea],
      combinedPool: [scoredIdea],
      qaSheets: [qaResult],
      ideaPackages: [ideaPackage],
      qaInProgress: true,
      packagingInProgress: true,
    });
    useSessionStore.getState().addThought('test', 'Should be cleared');

    useSessionStore.getState().reset();

    const state = useSessionStore.getState();
    expect(state.sessionId).toBeNull();
    expect(state.domain).toBe('');
    expect(state.stage).toBe('taxonomy');
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.errorStage).toBeNull();
    expect(state.sseStatus).toBe('disconnected');
    expect(state.taxonomy).toBeNull();
    expect(state.selectedPath).toEqual([]);
    expect(state.recommendedMethods).toEqual([]);
    expect(state.methodReasoning).toEqual({});
    expect(state.selectedMethods).toEqual([]);
    expect(state.rubric).toBeNull();
    expect(state.factoryPhase).toBe('idle');
    expect(state.factoryProgress).toBeNull();
    expect(state.factoryStartedAt).toBeNull();
    expect(state.workerIdeas.size).toBe(0);
    expect(state.scoredIdeas).toEqual([]);
    expect(state.evolvedIdeas).toEqual([]);
    expect(state.combinedPool).toEqual([]);
    expect(state.qaSheets).toEqual([]);
    expect(state.ideaPackages).toEqual([]);
    expect(state.qaInProgress).toBe(false);
    expect(state.packagingInProgress).toBe(false);
    expect(state.thoughts).toEqual([]);
    expect(state.stageModels).toEqual({});
    expect(state.sessionModels).toBeNull();
  });

  it('clears thoughts to empty array', () => {
    useSessionStore.getState().addThought('agent', 'thought 1');
    useSessionStore.getState().addThought('agent', 'thought 2');
    expect(useSessionStore.getState().thoughts).toHaveLength(2);

    useSessionStore.getState().reset();
    expect(useSessionStore.getState().thoughts).toEqual([]);
  });

  it('preserves action functions after reset', () => {
    useSessionStore.getState().reset();
    const state = useSessionStore.getState();

    expect(typeof state.setSessionId).toBe('function');
    expect(typeof state.setDomain).toBe('function');
    expect(typeof state.setStage).toBe('function');
    expect(typeof state.setLoading).toBe('function');
    expect(typeof state.setError).toBe('function');
    expect(typeof state.setTaxonomy).toBe('function');
    expect(typeof state.setSelectedPath).toBe('function');
    expect(typeof state.setMethodRecommendations).toBe('function');
    expect(typeof state.setSelectedMethods).toBe('function');
    expect(typeof state.toggleMethod).toBe('function');
    expect(typeof state.setRubric).toBe('function');
    expect(typeof state.setFactoryPhase).toBe('function');
    expect(typeof state.addWorkerIdea).toBe('function');
    expect(typeof state.setScoredIdeas).toBe('function');
    expect(typeof state.setEvolvedIdeas).toBe('function');
    expect(typeof state.setCombinedPool).toBe('function');
    expect(typeof state.addQASheet).toBe('function');
    expect(typeof state.addIdeaPackage).toBe('function');
    expect(typeof state.addThought).toBe('function');
    expect(typeof state.addStageCheckpoint).toBe('function');
    expect(typeof state.clearDownstreamState).toBe('function');
    expect(typeof state.hydrateFromSession).toBe('function');
    expect(typeof state.handleSSEEvent).toBe('function');
    expect(typeof state.reset).toBe('function');
  });

  it('store is functional after reset', () => {
    useSessionStore.getState().reset();

    useSessionStore.getState().setSessionId('new-session');
    useSessionStore.getState().setDomain('AI');
    useSessionStore.getState().addThought('navigator', 'Post-reset thought');

    const state = useSessionStore.getState();
    expect(state.sessionId).toBe('new-session');
    expect(state.domain).toBe('AI');
    expect(state.thoughts).toHaveLength(1);
    expect(state.thoughts[0].text).toBe('Post-reset thought');
  });
});

// =========================================================================
// addStageCheckpoint
// =========================================================================

describe('addStageCheckpoint', () => {
  it('adds a thought entry with stageCheckpoint field', () => {
    useSessionStore.getState().addStageCheckpoint('taxonomy');
    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0].stageCheckpoint).toBe('taxonomy');
    expect(thoughts[0].agent).toBe('system');
    expect(thoughts[0].text).toBe('Taxonomy complete');
  });

  it('uses the stage label from STAGES', () => {
    useSessionStore.getState().addStageCheckpoint('factory');
    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts[0].text).toBe('Factory complete');
  });

  it('appends to existing thoughts', () => {
    useSessionStore.getState().addThought('navigator', 'thinking...');
    useSessionStore.getState().addStageCheckpoint('taxonomy');
    useSessionStore.getState().addThought('strategist', 'planning...');
    expect(useSessionStore.getState().thoughts).toHaveLength(3);
    expect(useSessionStore.getState().thoughts[1].stageCheckpoint).toBe('taxonomy');
  });
});

// =========================================================================
// clearDownstreamState
// =========================================================================

describe('clearDownstreamState', () => {
  beforeEach(() => {
    // Populate full state
    useSessionStore.setState({
      sessionId: 'sess-1',
      domain: 'Robotics',
      stage: 'completed',
      isLoading: true,
      error: 'some error',
      taxonomy: taxonomyNode,
      selectedPath: ['Root', 'Child'],
      recommendedMethods: [1, 3],
      methodReasoning: { '1': 'reason' },
      selectedMethods: [1, 3],
      rubric: rubric,
      factoryPhase: 'complete',
      scoredIdeas: [scoredIdea],
      evolvedIdeas: [evolvedIdea],
      combinedPool: [scoredIdea],
      qaSheets: [qaResult],
      ideaPackages: [ideaPackage],
      stageModels: {
        taxonomy: 'claude-haiku-4-5-20251001',
        methods: 'claude-sonnet-4-5-20250929',
        rubric: 'claude-sonnet-4-5-20250929',
        factory: 'claude-opus-4-6',
      },
    });
    useSessionStore.getState().addThought('test', 'thought');
  });

  it('rolling back to taxonomy clears selectedPath and all downstream', () => {
    useSessionStore.getState().clearDownstreamState('taxonomy');
    const s = useSessionStore.getState();
    expect(s.stage).toBe('taxonomy');
    expect(s.taxonomy).toEqual(taxonomyNode); // preserved
    expect(s.selectedPath).toEqual([]); // cleared
    expect(s.recommendedMethods).toEqual([]);
    expect(s.methodReasoning).toEqual({});
    expect(s.selectedMethods).toEqual([]);
    expect(s.rubric).toBeNull();
    expect(s.factoryPhase).toBe('idle');
    expect(s.workerIdeas.size).toBe(0);
    expect(s.scoredIdeas).toEqual([]);
    expect(s.evolvedIdeas).toEqual([]);
    expect(s.combinedPool).toEqual([]);
    expect(s.qaSheets).toEqual([]);
    expect(s.ideaPackages).toEqual([]);
    expect(s.thoughts).toEqual([]);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.errorStage).toBeNull();
    expect(s.stageModels).toEqual({});
  });

  it('rolling back to methods preserves taxonomy and methods, clears rubric+', () => {
    useSessionStore.getState().clearDownstreamState('methods');
    const s = useSessionStore.getState();
    expect(s.stage).toBe('methods');
    expect(s.taxonomy).toEqual(taxonomyNode);
    expect(s.selectedPath).toEqual(['Root', 'Child']); // NOT cleared (taxonomy special-case only)
    expect(s.recommendedMethods).toEqual([1, 3]); // preserved
    expect(s.selectedMethods).toEqual([1, 3]); // preserved
    expect(s.rubric).toBeNull();
    expect(s.factoryPhase).toBe('idle');
    expect(s.combinedPool).toEqual([]);
  });

  it('rolling back to rubric preserves taxonomy, methods, rubric, clears factory+', () => {
    useSessionStore.getState().clearDownstreamState('rubric');
    const s = useSessionStore.getState();
    expect(s.stage).toBe('rubric');
    expect(s.rubric).toEqual(rubric); // preserved
    expect(s.factoryPhase).toBe('idle');
    expect(s.scoredIdeas).toEqual([]);
    expect(s.combinedPool).toEqual([]);
    // stageModels: taxonomy and methods preserved (indices 0 and 1 are < rubric index 2)
    expect(s.stageModels).toEqual({
      taxonomy: 'claude-haiku-4-5-20251001',
      methods: 'claude-sonnet-4-5-20250929',
    });
  });

  it('rolling back to factory clears qaSheets and ideaPackages', () => {
    useSessionStore.getState().clearDownstreamState('factory');
    const s = useSessionStore.getState();
    expect(s.stage).toBe('factory');
    expect(s.rubric).toEqual(rubric);
    expect(s.scoredIdeas).toEqual([scoredIdea]); // preserved
    expect(s.qaSheets).toEqual([]);
    expect(s.ideaPackages).toEqual([]);
  });

  it('preserves sessionId and domain', () => {
    useSessionStore.getState().clearDownstreamState('taxonomy');
    const s = useSessionStore.getState();
    expect(s.sessionId).toBe('sess-1');
    expect(s.domain).toBe('Robotics');
  });

  it('taxonomy survives clearDownstreamState followed by hydrateFromSession with stale cache', () => {
    useSessionStore.getState().clearDownstreamState('taxonomy');

    // Verify taxonomy is preserved after clearDownstreamState
    const afterClear = useSessionStore.getState();
    expect(afterClear.stage).toBe('taxonomy');
    expect(afterClear.taxonomy).toEqual(taxonomyNode);
    expect(afterClear.selectedPath).toEqual([]);
  });
});

// =========================================================================
// hydrateFromSession
// =========================================================================

describe('hydrateFromSession', () => {
  it('hydrates basic session fields', () => {
    useSessionStore.getState().hydrateFromSession({
      id: 'hydrate-1',
      domain: 'Drones',
      status: 'methods',
      coordinate: 'A > B',
      taxonomy: null,
      methods: null,
      rubric: null,
      ideas: [],
      qaSheets: [],
      ideaPackages: [],
      eventLog: [],
    });

    const s = useSessionStore.getState();
    expect(s.sessionId).toBe('hydrate-1');
    expect(s.domain).toBe('Drones');
    expect(s.stage).toBe('methods');
  });

  it('hydrates taxonomy with selectedPath', () => {
    useSessionStore.getState().hydrateFromSession({
      id: 'hydrate-2',
      domain: 'Chairs',
      status: 'rubric',
      coordinate: 'Root > Child',
      taxonomy: { tree: taxonomyNode, selectedPath: ['Root', 'Child'] },
      methods: null,
      rubric: null,
      ideas: [],
      qaSheets: [],
      ideaPackages: [],
      eventLog: [],
    });

    const s = useSessionStore.getState();
    expect(s.taxonomy).toEqual(taxonomyNode);
    expect(s.selectedPath).toEqual(['Root', 'Child']);
  });

  it('hydrates methods', () => {
    useSessionStore.getState().hydrateFromSession({
      id: 'hydrate-3',
      domain: 'Chairs',
      status: 'rubric',
      coordinate: null,
      taxonomy: null,
      methods: {
        recommended: [1, 3],
        reasoning: { '1': 'Good', '3': 'Also good' },
        selected: [1],
      },
      rubric: null,
      ideas: [],
      qaSheets: [],
      ideaPackages: [],
      eventLog: [],
    });

    const s = useSessionStore.getState();
    expect(s.recommendedMethods).toEqual([1, 3]);
    expect(s.methodReasoning).toEqual({ '1': 'Good', '3': 'Also good' });
    expect(s.selectedMethods).toEqual([1]);
  });

  it('hydrates rubric', () => {
    useSessionStore.getState().hydrateFromSession({
      id: 'hydrate-4',
      domain: 'Chairs',
      status: 'factory',
      coordinate: null,
      taxonomy: null,
      methods: null,
      rubric: rubric,
      ideas: [],
      qaSheets: [],
      ideaPackages: [],
      eventLog: [],
    });

    expect(useSessionStore.getState().rubric).toEqual(rubric);
  });

  it('hydrates qaSheets and ideaPackages', () => {
    useSessionStore.getState().hydrateFromSession({
      id: 'hydrate-5',
      domain: 'Chairs',
      status: 'completed',
      coordinate: null,
      taxonomy: null,
      methods: null,
      rubric: null,
      ideas: [],
      qaSheets: [{ ideaId: 's1', feasibilityScore: 4, verdict: 'strong', summary: 'Good', risks: [] }],
      ideaPackages: [{ ideaId: 's1', ideaName: 'Widget', htmlContent: '<html/>', deepResearchPrompt: 'prompt' }],
      eventLog: [],
    });

    const s = useSessionStore.getState();
    expect(s.qaSheets).toHaveLength(1);
    expect(s.ideaPackages).toHaveLength(1);
  });

  it('hydrates diverge ideas grouped by worker', () => {
    useSessionStore.getState().hydrateFromSession({
      id: 'hydrate-6',
      domain: 'Chairs',
      status: 'factory',
      coordinate: null,
      taxonomy: null,
      methods: null,
      rubric: null,
      ideas: [
        { id: 'i1', phase: 'diverge', workerId: 'w0', data: rawIdea },
        { id: 'i2', phase: 'diverge', workerId: 'w0', data: rawIdea2 },
        { id: 'i3', phase: 'diverge', workerId: 'w1', data: rawIdeaWorker1 },
      ],
      qaSheets: [],
      ideaPackages: [],
      eventLog: [],
    });

    const s = useSessionStore.getState();
    expect(s.workerIdeas.get('w0')).toHaveLength(2);
    expect(s.workerIdeas.get('w1')).toHaveLength(1);
    expect(s.factoryPhase).toBe('diverge');
  });

  it('hydrates event log as thoughts', () => {
    useSessionStore.getState().hydrateFromSession({
      id: 'hydrate-7',
      domain: 'Chairs',
      status: 'taxonomy',
      coordinate: null,
      taxonomy: null,
      methods: null,
      rubric: null,
      ideas: [],
      qaSheets: [],
      ideaPackages: [],
      eventLog: [
        { type: 'agent:thought', data: { agent: 'navigator', text: 'Exploring...' } },
        { type: 'agent:tool_use', data: { agent: 'strategist', tool: 'web_search' } },
      ],
    });

    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts).toHaveLength(2);
    expect(thoughts[0].text).toBe('Exploring...');
    expect(thoughts[1].text).toBe('Using tool: web_search');
  });

  it('hydrates event log with createdAt timestamps preserved', () => {
    const ts1 = 1700000001000;
    const ts2 = 1700000002000;
    const ts3 = 1700000003000;
    useSessionStore.getState().hydrateFromSession({
      id: 'hydrate-ts',
      domain: 'Chairs',
      status: 'taxonomy',
      coordinate: null,
      taxonomy: null,
      methods: null,
      rubric: null,
      ideas: [],
      qaSheets: [],
      ideaPackages: [],
      eventLog: [
        { type: 'agent:thought', data: { agent: 'navigator', text: 'First' }, createdAt: ts1 },
        { type: 'agent:tool_use', data: { agent: 'strategist', tool: 'search' }, createdAt: ts2 },
        { type: 'status:stage_start', data: { stage: 'taxonomy' }, createdAt: ts3 },
      ],
    });

    const thoughts = useSessionStore.getState().thoughts;
    expect(thoughts).toHaveLength(3);
    expect(thoughts[0].timestamp).toBe(ts1);
    expect(thoughts[1].timestamp).toBe(ts2);
    expect(thoughts[2].timestamp).toBe(ts3);
  });

  it('hydrates event log with model data and reconstructs stageModels', () => {
    useSessionStore.getState().hydrateFromSession({
      id: 'hydrate-models',
      domain: 'Chairs',
      status: 'methods',
      coordinate: null,
      taxonomy: null,
      methods: null,
      rubric: null,
      ideas: [],
      qaSheets: [],
      ideaPackages: [],
      eventLog: [
        { type: 'agent:thought', data: { agent: 'navigator', text: 'Working', model: 'claude-haiku-4-5-20251001' } },
        { type: 'status:stage_complete', data: { stage: 'taxonomy', next: 'methods' } },
      ],
    });

    const s = useSessionStore.getState();
    expect(s.thoughts[0].model).toBe('claude-haiku-4-5-20251001');
    expect(s.stageModels).toEqual({ taxonomy: 'claude-haiku-4-5-20251001' });
  });

  it('hydrates sessionModels from config', () => {
    const models = {
      navigator: 'claude-haiku-4-5-20251001',
      strategist: 'claude-sonnet-4-5-20250929',
      worker: 'claude-opus-4-6',
      analyst: 'claude-opus-4-6',
    };
    useSessionStore.getState().hydrateFromSession({
      id: 'hydrate-sm',
      domain: 'Chairs',
      status: 'taxonomy',
      coordinate: null,
      config: { models },
      taxonomy: null,
      methods: null,
      rubric: null,
      ideas: [],
      qaSheets: [],
      ideaPackages: [],
      eventLog: [],
    });

    expect(useSessionStore.getState().sessionModels).toEqual(models);
  });

  it('sets factoryPhase to complete when status is completed', () => {
    useSessionStore.getState().hydrateFromSession({
      id: 'hydrate-8',
      domain: 'Chairs',
      status: 'completed',
      coordinate: null,
      taxonomy: null,
      methods: null,
      rubric: null,
      ideas: [
        { id: 'i1', phase: 'diverge', workerId: 'w0', data: rawIdea },
      ],
      qaSheets: [],
      ideaPackages: [],
      eventLog: [],
    });

    expect(useSessionStore.getState().factoryPhase).toBe('complete');
  });
});
