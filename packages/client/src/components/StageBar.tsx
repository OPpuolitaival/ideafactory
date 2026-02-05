import { useSessionStore } from '../store/index.js';
import { STAGES, STAGE_ORDER } from '@ideafactory/shared';
import type { Stage } from '@ideafactory/shared';

export function StageBar() {
  const currentStage = useSessionStore((s) => s.stage);
  const currentIdx = STAGE_ORDER.indexOf(currentStage);

  return (
    <nav className="bg-bg-1 border-b border-bg-3 px-6 py-3">
      <div className="flex items-center gap-2">
        {STAGES.map((stage, i) => {
          const stageIdx = STAGE_ORDER.indexOf(stage.id as Stage);
          const isCurrent = stage.id === currentStage;
          const isComplete = stageIdx < currentIdx;
          const isFuture = stageIdx > currentIdx;

          return (
            <div key={stage.id} className="flex items-center">
              {i > 0 && (
                <div
                  className={`w-8 h-px mx-1 ${
                    isComplete ? 'bg-accent' : 'bg-bg-3'
                  }`}
                />
              )}
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isCurrent
                    ? 'bg-accent/20 text-accent-light border border-accent/30'
                    : isComplete
                      ? 'text-accent'
                      : isFuture
                        ? 'text-gray-500'
                        : ''
                }`}
              >
                <span
                  className={`flex items-center justify-center w-5 h-5 rounded-full text-xs ${
                    isComplete
                      ? 'bg-accent text-white'
                      : isCurrent
                        ? 'bg-accent/30 text-accent-light'
                        : 'bg-bg-3 text-gray-500'
                  }`}
                >
                  {isComplete ? '✓' : stage.number}
                </span>
                <span>{stage.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
