import { useEffect, useState } from 'react';
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
    qaInProgress,
    packagingInProgress,
    sessionId,
    stage,
  } = useSessionStore();

  const isAutomating =
    factoryPhase !== 'idle' &&
    factoryPhase !== 'interactive' &&
    factoryPhase !== 'complete';
  const elapsed = useElapsedTimer(isAutomating ? factoryStartedAt : null);

  const currentPhaseIdx = PHASES.indexOf(factoryPhase as (typeof PHASES)[number]);

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

      {/* Diverge View */}
      {(factoryPhase === 'diverge' || factoryPhase === 'idle') && (
        <DivergenceView workerIdeas={workerIdeas} />
      )}

      {/* Converge View */}
      {factoryPhase === 'converge' && <ConvergenceView ideas={scoredIdeas} />}

      {/* Evolve View */}
      {factoryPhase === 'evolve' && <EvolutionView ideas={evolvedIdeas} />}

      {/* Interactive View */}
      {(factoryPhase === 'interactive' || factoryPhase === 'complete') && (
        <InteractiveView
          sessionId={sessionId}
          combinedPool={combinedPool}
          qaSheets={qaSheets}
          ideaPackages={ideaPackages}
          qaInProgress={qaInProgress}
          packagingInProgress={packagingInProgress}
          isCompleted={stage === 'completed' || factoryPhase === 'complete'}
        />
      )}
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
              <h4 className={`font-medium ${idea.eliminated ? 'line-through' : ''}`}>
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

function EvolutionView({ ideas }: { ideas: ScoredIdea[] }) {
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
    </div>
  );
}

function InteractiveView({
  sessionId,
  combinedPool,
  qaSheets,
  ideaPackages,
  qaInProgress,
  packagingInProgress,
  isCompleted,
}: {
  sessionId: string | null;
  combinedPool: ScoredIdea[];
  qaSheets: QAResult[];
  ideaPackages: IdeaPackage[];
  qaInProgress: boolean;
  packagingInProgress: boolean;
  isCompleted: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const store = useSessionStore();

  const runQAMutation = trpc.session.runQA.useMutation();
  const packageMutation = trpc.session.packageIdeas.useMutation();
  const completeMutation = trpc.session.completeSession.useMutation();

  const qaSheetMap = new Map(qaSheets.map((s) => [s.conceptId, s]));
  const pkgMap = new Map(ideaPackages.map((p) => [p.ideaId, p]));

  const sorted = [...combinedPool].sort((a, b) => b.totalScore - a.totalScore);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelectedHaveQA =
    selected.size > 0 && Array.from(selected).every((id) => qaSheetMap.has(id));

  const handleRunQA = async () => {
    if (!sessionId || selected.size === 0) return;
    store.setError(null);
    useSessionStore.setState({ qaInProgress: true });
    try {
      await runQAMutation.mutateAsync({
        sessionId,
        ideaIds: Array.from(selected),
      });
    } finally {
      useSessionStore.setState({ qaInProgress: false });
    }
    // Keep selection — user can now click "Package Selected"
  };

  const handlePackage = async () => {
    if (!sessionId || selected.size === 0) return;
    store.setError(null);
    useSessionStore.setState({ packagingInProgress: true });
    try {
      await packageMutation.mutateAsync({
        sessionId,
        ideaIds: Array.from(selected),
      });
      setSelected(new Set());
    } finally {
      useSessionStore.setState({ packagingInProgress: false });
    }
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

  return (
    <div className="space-y-8">
      {/* QA Results */}
      {qaSheets.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold mb-4">QA Results</h3>
          <div className="space-y-3">
            {qaSheets.map((qa) => (
              <div key={qa.conceptId} className="card">
                <div className="flex items-start justify-between mb-3">
                  <h4 className="font-medium">
                    {combinedPool.find((i) => i.id === qa.conceptId)?.name ??
                      qa.conceptId}
                  </h4>
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
                <p className="text-sm text-gray-400 mb-3">{qa.summary}</p>
                <div className="space-y-1">
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
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Packaged Ideas */}
      {ideaPackages.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold mb-4">Packaged Ideas</h3>
          <div className="space-y-3">
            {ideaPackages.map((pkg) => (
              <div key={pkg.ideaId} className="card border-accent/20">
                <div className="flex items-start justify-between">
                  <h4 className="font-medium">{pkg.ideaName}</h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => downloadHTML(pkg)}
                      className="btn-ghost text-xs"
                    >
                      Download HTML
                    </button>
                    <button
                      onClick={() => copyPrompt(pkg)}
                      className="btn-ghost text-xs"
                    >
                      Copy Prompt
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Combined Idea Pool */}
      <section>
        <h3 className="text-lg font-semibold mb-2">Idea Pool</h3>
        <p className="text-sm text-gray-400 mb-4">
          Click ideas to select them, then run QA or package.
        </p>

        {!isCompleted && (
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={handleRunQA}
              disabled={selected.size === 0 || qaInProgress || runQAMutation.isPending}
              className="btn-primary text-sm"
            >
              {qaInProgress ? 'Running QA...' : `Run QA on Selected (${selected.size})`}
            </button>
            <button
              onClick={handlePackage}
              disabled={
                !allSelectedHaveQA || packagingInProgress || packageMutation.isPending
              }
              className="btn-secondary text-sm"
            >
              {packagingInProgress
                ? 'Packaging...'
                : `Package Selected (${selected.size})`}
            </button>
          </div>
        )}

        <div className="space-y-2">
          {sorted.map((idea) => {
            const hasQA = qaSheetMap.has(idea.id);
            const hasPkg = pkgMap.has(idea.id);
            const isSelected = selected.has(idea.id);

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
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium truncate">{idea.name}</h4>
                    {hasQA && (
                      <span className="badge bg-success/20 text-success text-xs">
                        QA'd
                      </span>
                    )}
                    {hasPkg && (
                      <span className="badge bg-accent/20 text-accent text-xs">
                        Packaged
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 truncate">{idea.description}</p>
                </div>
                <span className="text-lg font-bold text-accent shrink-0">
                  {idea.totalScore.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

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
