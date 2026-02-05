import { STAGES, STAGE_ORDER } from '@ideafactory/shared';
import type { Stage } from '@ideafactory/shared';

interface RollbackModalProps {
  targetStage: Stage;
  onEditSession: () => void;
  onDuplicateAndEdit: () => void;
  onCancel: () => void;
}

export function RollbackModal({
  targetStage,
  onEditSession,
  onDuplicateAndEdit,
  onCancel,
}: RollbackModalProps) {
  const targetInfo = STAGES.find((s) => s.id === targetStage);
  const targetIdx = STAGE_ORDER.indexOf(targetStage);

  const discardedStages = STAGES.filter((s) => {
    const idx = STAGE_ORDER.indexOf(s.id as Stage);
    return idx > targetIdx;
  });

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-bg-2 border border-bg-3 rounded-xl w-full max-w-md mt-32 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-3">
          Go back to {targetInfo?.label ?? targetStage}?
        </h2>

        {discardedStages.length > 0 && (
          <p className="text-sm text-gray-400 mb-5">
            Progress after {targetInfo?.label} will be discarded:{' '}
            <span className="text-gray-300">
              {discardedStages.map((s) => s.label).join(', ')}
            </span>
          </p>
        )}

        <div className="space-y-3 mb-5">
          <button
            onClick={onEditSession}
            className="w-full text-left p-4 rounded-lg border border-bg-3 hover:border-accent/50 hover:bg-accent/5 transition-colors"
          >
            <div className="font-medium mb-1">Edit this session</div>
            <div className="text-sm text-gray-400">
              Roll back and discard progress after {targetInfo?.label}.
            </div>
          </button>

          <button
            onClick={onDuplicateAndEdit}
            className="w-full text-left p-4 rounded-lg border border-bg-3 hover:border-accent/50 hover:bg-accent/5 transition-colors"
          >
            <div className="font-medium mb-1">Make a copy first</div>
            <div className="text-sm text-gray-400">
              Duplicate this session, then edit the copy. Original preserved.
            </div>
          </button>
        </div>

        <button onClick={onCancel} className="btn-ghost w-full">
          Cancel
        </button>
      </div>
    </div>
  );
}
