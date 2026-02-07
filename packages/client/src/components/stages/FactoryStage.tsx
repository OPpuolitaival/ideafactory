import { useEffect, useState } from 'react';
import { useSessionStore } from '../../store/index.js';
import { trpc } from '../../trpc/index.js';

const PHASE_LABELS = {
  idle: 'Waiting...',
  diverge: 'Diverge — Generating Ideas',
  converge: 'Converge — Filtering & Scoring',
  evolve: 'Evolve — Polishing Concepts',
  qa: 'QA — Reality Check',
  complete: 'Factory Complete',
};

const PHASES = ['diverge', 'converge', 'evolve', 'qa'] as const;

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
    qaResults,
    sessionId,
    setStage,
    setLoading,
  } = useSessionStore();
  const elapsed = useElapsedTimer(factoryPhase !== 'complete' && factoryPhase !== 'idle' ? factoryStartedAt : null);

  const advanceMutation = trpc.session.advance.useMutation();

  const handleAdvance = async () => {
    if (!sessionId) return;
    setLoading(true);
    await advanceMutation.mutateAsync({ sessionId, stage: 'output' });
    setStage('output');
  };

  const currentPhaseIdx = PHASES.indexOf(factoryPhase as any);

  return (
    <div className="max-w-6xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">
        Stage 4: Factory
        {elapsed && <span className="text-base font-normal text-gray-500 ml-3">({elapsed} elapsed)</span>}
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
                <div className={`w-12 h-px mx-2 ${isComplete ? 'bg-accent' : 'bg-bg-3'}`} />
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
                {isComplete && !isActive && '✓ '}
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

      {/* QA View */}
      {(factoryPhase === 'qa' || factoryPhase === 'complete') && <QAView results={qaResults} />}

      {factoryPhase === 'complete' && (
        <div className="mt-8 flex justify-end">
          <button
            onClick={handleAdvance}
            disabled={advanceMutation.isPending}
            className="btn-primary"
          >
            {advanceMutation.isPending ? 'Packaging...' : 'Next: Package Output'}
          </button>
        </div>
      )}
    </div>
  );
}

function DivergenceView({
  workerIdeas,
}: {
  workerIdeas: Map<string, import('@ideafactory/shared').RawIdea[]>;
}) {
  const entries = Array.from(workerIdeas.entries());

  if (entries.length === 0) {
    return (
      <div className="text-center text-gray-500 py-12">
        Waiting for workers to begin generating ideas...
      </div>
    );
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${entries.length}, 1fr)` }}>
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
                <span className="text-xs text-gray-500 mt-1 inline-block">{idea.method}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConvergenceView({ ideas }: { ideas: import('@ideafactory/shared').ScoredIdea[] }) {
  const sorted = [...ideas].sort((a, b) => {
    if (a.eliminated && !b.eliminated) return 1;
    if (!a.eliminated && b.eliminated) return -1;
    return b.totalScore - a.totalScore;
  });

  return (
    <div className="space-y-3">
      {sorted.map((idea) => (
        <div
          key={idea.id}
          className={`card ${idea.eliminated ? 'opacity-40' : ''}`}
        >
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
                <span className="text-lg font-bold text-accent">{idea.totalScore.toFixed(1)}</span>
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

function EvolutionView({ ideas }: { ideas: import('@ideafactory/shared').ScoredIdea[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        Concepts have been evolved — weaknesses addressed, strengths amplified.
      </p>
      {ideas.map((idea) => (
        <div key={idea.id} className="card border-accent/20">
          <div className="flex items-start justify-between">
            <h4 className="font-medium">{idea.name}</h4>
            <span className="text-lg font-bold text-accent">{idea.totalScore.toFixed(1)}</span>
          </div>
          <p className="text-sm text-gray-400 mt-2">{idea.description}</p>
        </div>
      ))}
    </div>
  );
}

function QAView({ results }: { results: import('@ideafactory/shared').QAResult[] }) {
  return (
    <div className="space-y-4">
      {results.map((qa) => (
        <div key={qa.conceptId} className="card">
          <div className="flex items-start justify-between mb-3">
            <h4 className="font-medium">{qa.conceptId}</h4>
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
  );
}
