import { useSessionStore } from '../store/index.js';
import { STAGES, STAGE_ORDER, MODEL_OPTIONS } from '@ideafactory/shared';
import type { Stage } from '@ideafactory/shared';

function getModelColor(model?: string): string | undefined {
  const opt = MODEL_OPTIONS.find((m) => m.id === model);
  return opt?.color;
}

interface StageBarProps {
  onStageClick?: (stage: Stage) => void;
  viewingStage?: Stage | null;
}

export function StageBar({ onStageClick, viewingStage }: StageBarProps) {
  const currentStage = useSessionStore((s) => s.stage);
  const isLoading = useSessionStore((s) => s.isLoading);
  const stageModels = useSessionStore((s) => s.stageModels);
  const currentIdx = STAGE_ORDER.indexOf(currentStage);

  return (
    <nav className="bg-bg-1 border-b border-bg-3 px-6 py-3">
      <div className="flex items-center gap-2">
        {STAGES.map((stage, i) => {
          const stageIdx = STAGE_ORDER.indexOf(stage.id as Stage);
          const isCurrent = stage.id === currentStage;
          const isComplete = stageIdx < currentIdx;
          const isFuture = stageIdx > currentIdx;
          const isClickable = isComplete && !isLoading && onStageClick;
          const isViewing = viewingStage === stage.id;

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
                onClick={isClickable ? () => onStageClick(stage.id as Stage) : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isViewing
                    ? 'border border-dashed border-accent/50 bg-accent/5 text-accent-light'
                    : isCurrent
                      ? 'bg-accent/20 text-accent-light border border-accent/30'
                      : isComplete
                        ? 'text-accent'
                        : isFuture
                          ? 'text-gray-500'
                          : ''
                } ${isClickable ? 'cursor-pointer hover:bg-accent/10' : ''}`}
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
                {isComplete && stageModels[stage.id] && (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: getModelColor(stageModels[stage.id]) }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
