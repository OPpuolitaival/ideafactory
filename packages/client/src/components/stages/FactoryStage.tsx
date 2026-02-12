import { useEffect, useMemo, useState } from 'react';
import { useSessionStore } from '../../store/index.js';
import { trpc } from '../../trpc/index.js';
import type { RawIdea, ScoredIdea, QAResult, IdeaPackage } from '@ideafactory/shared';

const PHASE_LABELS: Record<string, string> = {
  idle: 'Waiting...',
  diverge: 'Diverge — Generating Ideas',
  converge: 'Converge — Filtering & Scoring',
  evolve: 'Evolve — Polishing Concepts',
  interactive: 'Review — QA & Package',
  complete: 'Session Complete',
};

const PHASES = ['diverge', 'converge', 'evolve', 'interactive'] as const;

function formatElapsed(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function useElapsedTimer(startedAt: number | null): string | null {
  const [elapsed, setElapsed] = useState<string | null>(null);
  useEffect(() => {
    if (!startedAt) {
      setElapsed(null);
      return;
    }
    setElapsed(formatElapsed(Date.now() - startedAt));
    const interval = setInterval(() => {
      setElapsed(formatElapsed(Date.now() - startedAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return elapsed;
}

export function FactoryStage() {
  const {
    factoryPhase,
    factoryProgress,
    factoryStartedAt,
    workerIdeas,
    scoredIdeas,
    evolvedIdeas,
    combinedPool,
    qaSheets,
    ideaPackages,
    reviewInProgress,
    sessionId,
    stage,
    isLoading,
    error,
  } = useSessionStore();

  const isAutomating =
    factoryPhase !== 'idle' &&
    factoryPhase !== 'interactive' &&
    factoryPhase !== 'complete';
  const elapsed = useElapsedTimer(isAutomating ? factoryStartedAt : null);

  const currentPhaseIdx = PHASES.indexOf(factoryPhase as (typeof PHASES)[number]);

  // Detect stuck factory: page refreshed mid-run, no error stored, but partial data exists
  const isStuck =
    stage === 'factory' &&
    !isLoading &&
    !error &&
    factoryPhase !== 'interactive' &&
    factoryPhase !== 'complete' &&
    workerIdeas.size > 0;

  return (
    <div className="max-w-6xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">
        Stage 4: Factory
        {elapsed && (
          <span className="text-base font-normal text-gray-500 ml-3">
            ({elapsed} elapsed)
          </span>
        )}
      </h2>
      <p className="text-gray-400 mb-1">{PHASE_LABELS[factoryPhase]}</p>
      {factoryProgress && (
        <p className="text-sm text-accent-light mb-6">{factoryProgress.detail}</p>
      )}
      {!factoryProgress && <div className="mb-6" />}

      {/* Phase Pipeline */}
      <div className="flex items-center gap-2 mb-8">
        {PHASES.map((phase, i) => {
          const isActive = phase === factoryPhase;
          const isComplete = i < currentPhaseIdx || factoryPhase === 'complete';
          return (
            <div key={phase} className="flex items-center">
              {i > 0 && (
                <div
                  className={`w-12 h-px mx-2 ${isComplete ? 'bg-accent' : 'bg-bg-3'}`}
                />
              )}
              <div
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  isActive
                    ? 'bg-accent/20 text-accent-light border border-accent/30 animate-pulse'
                    : isComplete
                      ? 'bg-accent/10 text-accent'
                      : 'bg-bg-2 text-gray-500'
                }`}
              >
                {isComplete && !isActive && '\u2713 '}
                {phase.charAt(0).toUpperCase() + phase.slice(1)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stuck Factory Banner */}
      {isStuck && sessionId && (
        <StuckFactoryBanner sessionId={sessionId} workerCount={workerIdeas.size} ideaCount={Array.from(workerIdeas.values()).reduce((sum, ideas) => sum + ideas.length, 0)} />
      )}

      {/* Diverge View */}
      {(factoryPhase === 'diverge' || factoryPhase === 'idle') && (
        <DivergenceView workerIdeas={workerIdeas} />
      )}

      {/* Converge View */}
      {factoryPhase === 'converge' && <ConvergenceView ideas={scoredIdeas} />}

      {/* Evolve View */}
      {factoryPhase === 'evolve' && (
        <EvolutionView ideas={evolvedIdeas} scoredIdeas={scoredIdeas} />
      )}

      {/* Interactive View */}
      {(factoryPhase === 'interactive' || factoryPhase === 'complete') && (
        <InteractiveView
          sessionId={sessionId}
          combinedPool={combinedPool}
          scoredIdeas={scoredIdeas}
          qaSheets={qaSheets}
          ideaPackages={ideaPackages}
          reviewInProgress={reviewInProgress}
          isCompleted={stage === 'completed' || factoryPhase === 'complete'}
        />
      )}
    </div>
  );
}

// ---- Stuck Factory Banner ----

function StuckFactoryBanner({ sessionId, workerCount, ideaCount }: { sessionId: string; workerCount: number; ideaCount: number }) {
  const resumeMutation = trpc.session.resume.useMutation();
  const retryMutation = trpc.session.retry.useMutation();
  const isLoading = useSessionStore((s) => s.isLoading);

  const handleResume = async () => {
    useSessionStore.setState({ error: null, errorStage: null, isLoading: true });
    try {
      await resumeMutation.mutateAsync({ id: sessionId });
    } catch {
      useSessionStore.setState({ isLoading: false });
    }
  };

  const handleRetry = async () => {
    useSessionStore.setState({ error: null, errorStage: null, isLoading: true });
    try {
      await retryMutation.mutateAsync({ id: sessionId });
    } catch {
      useSessionStore.setState({ isLoading: false });
    }
  };

  return (
    <div className="bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 mb-6 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <span className="text-warning text-sm font-medium">Factory interrupted</span>
        <span className="text-gray-400 text-sm ml-2">
          Found {workerCount} completed workers with {ideaCount} ideas.
        </span>
      </div>
      <button
        onClick={handleResume}
        disabled={isLoading}
        className="btn-secondary text-xs shrink-0 border-accent/50 text-accent-light hover:bg-accent/20 disabled:opacity-50"
      >
        {isLoading ? 'Resuming...' : 'Resume (preserve progress)'}
      </button>
      <button
        onClick={handleRetry}
        disabled={isLoading}
        className="btn-secondary text-xs shrink-0 border-red-700/50 text-red-200 hover:bg-red-800/50 disabled:opacity-50"
      >
        {isLoading ? 'Retrying...' : 'Retry (start fresh)'}
      </button>
    </div>
  );
}

// ---- Sub-components ----

function DivergenceView({ workerIdeas }: { workerIdeas: Map<string, RawIdea[]> }) {
  const entries = Array.from(workerIdeas.entries());

  if (entries.length === 0) {
    return (
      <div className="text-center text-gray-500 py-12">
        Waiting for workers to begin generating ideas...
      </div>
    );
  }

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${entries.length}, 1fr)` }}
    >
      {entries.map(([workerId, ideas]) => (
        <div key={workerId}>
          <h4 className="font-medium text-sm mb-3 text-accent-light">
            {ideas[0]?.persona ?? workerId}
            <span className="text-gray-500 ml-2">({ideas.length} ideas)</span>
          </h4>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {ideas.map((idea) => (
              <div key={idea.id} className="card text-sm animate-in">
                <div className="flex items-start justify-between gap-2">
                  <h5 className="font-medium">{idea.name}</h5>
                  <span
                    className={
                      idea.probability === 'high'
                        ? 'badge-high'
                        : idea.probability === 'medium'
                          ? 'badge-medium'
                          : 'badge-low'
                    }
                  >
                    {idea.probability}
                  </span>
                </div>
                <p className="text-gray-400 mt-1 text-xs">{idea.description}</p>
                <span className="text-xs text-gray-500 mt-1 inline-block">
                  {idea.method}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConvergenceView({ ideas }: { ideas: ScoredIdea[] }) {
  const sorted = [...ideas].sort((a, b) => {
    if (a.eliminated && !b.eliminated) return 1;
    if (!a.eliminated && b.eliminated) return -1;
    return b.totalScore - a.totalScore;
  });

  return (
    <div className="space-y-3">
      {sorted.map((idea) => (
        <div key={idea.id} className={`card ${idea.eliminated ? 'opacity-40' : ''}`}>
          <div className="flex items-start justify-between">
            <div>
              <h4 className="font-medium">
                {idea.name}
              </h4>
              <p className="text-sm text-gray-400 mt-1">{idea.description}</p>
            </div>
            <div className="text-right shrink-0 ml-4">
              {idea.eliminated ? (
                <span className="badge bg-danger/20 text-danger">Eliminated</span>
              ) : (
                <span className="text-lg font-bold text-accent">
                  {idea.totalScore.toFixed(1)}
                </span>
              )}
            </div>
          </div>
          {idea.eliminated && idea.eliminationReason && (
            <p className="text-xs text-danger mt-2">{idea.eliminationReason}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function EvolutionView({
  ideas,
  scoredIdeas,
}: {
  ideas: ScoredIdea[];
  scoredIdeas: ScoredIdea[];
}) {
  const [showEliminated, setShowEliminated] = useState(false);
  const eliminated = scoredIdeas.filter((i) => i.eliminated);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        Concepts have been evolved — weaknesses addressed, strengths amplified.
      </p>
      {ideas.map((idea) => (
        <div key={idea.id} className="card border-accent/20">
          <div className="flex items-start justify-between">
            <h4 className="font-medium">{idea.name}</h4>
            <span className="text-lg font-bold text-accent">
              {idea.totalScore.toFixed(1)}
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-2">{idea.description}</p>
        </div>
      ))}

      {eliminated.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowEliminated((prev) => !prev)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span className="text-base">{showEliminated ? '\u25BE' : '\u25B8'}</span>
            Eliminated during convergence ({eliminated.length})
          </button>
          {showEliminated && (
            <div className="space-y-2 mt-3">
              {eliminated.map((idea) => (
                <div key={idea.id} className="card opacity-40">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium">{idea.name}</h4>
                      <p className="text-sm text-gray-400 mt-1">{idea.description}</p>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <span className="badge bg-danger/20 text-danger">Eliminated</span>
                    </div>
                  </div>
                  {idea.eliminationReason && (
                    <p className="text-xs text-danger mt-2">{idea.eliminationReason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InteractiveView({
  sessionId,
  combinedPool,
  scoredIdeas,
  qaSheets,
  ideaPackages,
  reviewInProgress,
  isCompleted,
}: {
  sessionId: string | null;
  combinedPool: ScoredIdea[];
  scoredIdeas: ScoredIdea[];
  qaSheets: QAResult[];
  ideaPackages: IdeaPackage[];
  reviewInProgress: boolean;
  isCompleted: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showEliminated, setShowEliminated] = useState(false);
  const store = useSessionStore();
  const factoryProgress = useSessionStore((s) => s.factoryProgress);

  const reviewMutation = trpc.session.runCriticalReview.useMutation();
  const completeMutation = trpc.session.completeSession.useMutation();

  const qaSheetMap = useMemo(() => new Map(qaSheets.map((s) => [s.conceptId, s])), [qaSheets]);
  const pkgMap = useMemo(() => new Map(ideaPackages.map((p) => [p.ideaId, p])), [ideaPackages]);

  // Merge pool + eliminated into a single lookup for names/descriptions
  const allIdeasMap = useMemo(() => {
    const map = new Map<string, ScoredIdea>();
    for (const idea of combinedPool) map.set(idea.id, idea);
    for (const idea of scoredIdeas) if (!map.has(idea.id)) map.set(idea.id, idea);
    return map;
  }, [combinedPool, scoredIdeas]);

  const sorted = useMemo(
    () => [...combinedPool].sort((a, b) => b.totalScore - a.totalScore),
    [combinedPool],
  );

  const eliminated = useMemo(() => scoredIdeas.filter((i) => i.eliminated), [scoredIdeas]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpanded = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRunReview = async () => {
    if (!sessionId || selected.size === 0) return;
    store.setError(null);
    useSessionStore.setState({ reviewInProgress: true });
    try {
      await reviewMutation.mutateAsync({
        sessionId,
        ideaIds: Array.from(selected),
      });
    } catch {
      useSessionStore.setState({ reviewInProgress: false });
    }
    // reviewInProgress will be cleared when all packages arrive or on error
  };

  const handleComplete = async () => {
    if (!sessionId) return;
    await completeMutation.mutateAsync({ sessionId });
    store.setStage('completed');
  };

  const downloadHTML = (pkg: IdeaPackage) => {
    const blob = new Blob([pkg.htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pkg.ideaName.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyPrompt = async (pkg: IdeaPackage) => {
    await navigator.clipboard.writeText(pkg.deepResearchPrompt);
  };

  // Build reviewed ideas: ideas that have a QA sheet (and optionally a package)
  const reviewedIdeas = useMemo(() => {
    return qaSheets.map((qa) => ({
      qa,
      idea: allIdeasMap.get(qa.conceptId),
      pkg: pkgMap.get(qa.conceptId),
    }));
  }, [qaSheets, allIdeasMap, pkgMap]);

  return (
    <div className="space-y-8">
      {/* Critical Reviews */}
      {reviewedIdeas.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold mb-4">Critical Reviews</h3>
          <div className="space-y-3">
            {reviewedIdeas.map(({ qa, idea, pkg }) => (
              <div key={qa.conceptId} className="card">
                <div className="flex items-start justify-between mb-3">
                  <h4 className="font-medium">{idea?.name ?? qa.conceptId}</h4>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">
                      Feasibility: {qa.feasibilityScore}/5
                    </span>
                    <span
                      className={`badge ${
                        qa.verdict === 'strong'
                          ? 'bg-success/20 text-success'
                          : qa.verdict === 'conditional'
                            ? 'bg-warning/20 text-warning'
                            : 'bg-danger/20 text-danger'
                      }`}
                    >
                      {qa.verdict}
                    </span>
                  </div>
                </div>
                {idea && (
                  <p className="text-sm text-gray-300 mb-3">{idea.description}</p>
                )}
                <p className="text-sm text-gray-400 mb-3">{qa.summary}</p>
                {qa.risks.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {qa.risks.map((risk, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span
                          className={`badge ${
                            risk.severity === 'critical'
                              ? 'bg-danger/20 text-danger'
                              : risk.severity === 'high'
                                ? 'bg-danger/10 text-danger/80'
                                : risk.severity === 'medium'
                                  ? 'bg-warning/20 text-warning'
                                  : 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {risk.severity}
                        </span>
                        <span className="text-gray-400">
                          <strong>{risk.category}:</strong> {risk.description}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {pkg && (
                  <div className="flex items-center gap-2 pt-2 border-t border-bg-3">
                    <button onClick={() => downloadHTML(pkg)} className="btn-ghost text-xs">
                      Download HTML
                    </button>
                    <button onClick={() => copyPrompt(pkg)} className="btn-ghost text-xs">
                      Copy Prompt
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Combined Idea Pool */}
      <section>
        <h3 className="text-lg font-semibold mb-2">Idea Pool</h3>
        <p className="text-sm text-gray-400 mb-4">
          Select ideas, then run Critical Review to analyze feasibility and generate reports.
        </p>

        {!isCompleted && (
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={handleRunReview}
              disabled={selected.size === 0 || reviewInProgress || reviewMutation.isPending}
              className="btn-primary text-sm"
            >
              {reviewInProgress
                ? 'Reviewing...'
                : `Run Critical Review (${selected.size})`}
            </button>
            {reviewInProgress && factoryProgress && (
              <span className="text-sm text-accent-light">{factoryProgress.detail}</span>
            )}
          </div>
        )}

        <div className="space-y-2">
          {sorted.map((idea) => {
            const hasQA = qaSheetMap.has(idea.id);
            const hasPkg = pkgMap.has(idea.id);
            const isSelected = selected.has(idea.id);
            const isExpanded = expanded.has(idea.id);

            return (
              <div
                key={idea.id}
                onClick={() => !isCompleted && toggleSelect(idea.id)}
                className={`card flex items-center gap-4 ${
                  !isCompleted ? 'cursor-pointer' : ''
                } ${isSelected ? 'border-accent/50 bg-accent/5' : ''}`}
              >
                {!isCompleted && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(idea.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="accent-accent shrink-0"
                  />
                )}
                <button
                  onClick={(e) => toggleExpanded(idea.id, e)}
                  className="text-gray-500 hover:text-gray-300 text-base shrink-0 p-1"
                  title={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? '\u25BE' : '\u25B8'}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className={`font-medium ${isExpanded ? '' : 'truncate'}`}>
                      {idea.name}
                    </h4>
                    {hasQA && (
                      <span className="badge bg-success/20 text-success text-xs shrink-0">
                        Reviewed
                      </span>
                    )}
                    {hasPkg && (
                      <span className="badge bg-accent/20 text-accent text-xs shrink-0">
                        Packaged
                      </span>
                    )}
                  </div>
                  <p className={`text-sm text-gray-400 ${isExpanded ? '' : 'truncate'}`}>
                    {idea.description}
                  </p>
                </div>
                <span className="text-lg font-bold text-accent shrink-0">
                  {idea.totalScore.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Eliminated Ideas — selectable for critical review */}
      {eliminated.length > 0 && (
        <section>
          <button
            onClick={() => setShowEliminated((prev) => !prev)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span className="text-base">{showEliminated ? '\u25BE' : '\u25B8'}</span>
            Eliminated Ideas ({eliminated.length})
          </button>
          {showEliminated && (
            <div className="space-y-2 mt-3">
              {eliminated.map((idea) => {
                const isSelected = selected.has(idea.id);
                const isExpanded = expanded.has(idea.id);
                const hasQA = qaSheetMap.has(idea.id);
                const hasPkg = pkgMap.has(idea.id);
                return (
                  <div
                    key={idea.id}
                    onClick={() => !isCompleted && toggleSelect(idea.id)}
                    className={`card flex items-center gap-4 ${
                      !isCompleted ? 'cursor-pointer' : ''
                    } ${isSelected ? 'border-accent/50 bg-accent/5' : 'opacity-50'}`}
                  >
                    {!isCompleted && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(idea.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-accent shrink-0"
                      />
                    )}
                    <button
                      onClick={(e) => toggleExpanded(idea.id, e)}
                      className="text-gray-500 hover:text-gray-300 text-base shrink-0 p-1"
                      title={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      {isExpanded ? '\u25BE' : '\u25B8'}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-medium ${isExpanded ? '' : 'truncate'}`}>
                          {idea.name}
                        </h4>
                        {hasQA && (
                          <span className="badge bg-success/20 text-success text-xs shrink-0">
                            Reviewed
                          </span>
                        )}
                        {hasPkg && (
                          <span className="badge bg-accent/20 text-accent text-xs shrink-0">
                            Packaged
                          </span>
                        )}
                      </div>
                      <p className={`text-sm text-gray-400 ${isExpanded ? '' : 'truncate'}`}>
                        {idea.description}
                      </p>
                      {idea.eliminationReason && (
                        <p className="text-xs text-danger mt-1">{idea.eliminationReason}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      {idea.totalScore > 0 ? (
                        <span className="text-sm text-gray-500">
                          {idea.totalScore.toFixed(1)}
                        </span>
                      ) : (
                        <span className="badge bg-danger/20 text-danger">Eliminated</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Complete Session */}
      {!isCompleted && (
        <div className="flex justify-end pt-4 border-t border-bg-3">
          <button
            onClick={handleComplete}
            disabled={completeMutation.isPending}
            className="btn-primary"
          >
            {completeMutation.isPending ? 'Completing...' : 'Complete Session'}
          </button>
        </div>
      )}
    </div>
  );
}
