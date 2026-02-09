import { useSessionStore } from '../store/index.js';
import { trpc } from '../trpc/index.js';
import { STAGES } from '@ideafactory/shared';

export function ErrorBanner() {
  const error = useSessionStore((s) => s.error);
  const errorStage = useSessionStore((s) => s.errorStage);
  const sessionId = useSessionStore((s) => s.sessionId);
  const isLoading = useSessionStore((s) => s.isLoading);

  const retryMutation = trpc.session.retry.useMutation();
  const resumeMutation = trpc.session.resume.useMutation();

  const progressQuery = trpc.session.getFactoryProgress.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId && errorStage === 'factory' },
  );

  if (!error) return null;

  const stageLabel = STAGES.find((s) => s.id === errorStage)?.label ?? errorStage;
  const canResume = errorStage === 'factory' && progressQuery.data != null && progressQuery.data.resumeFrom !== null;
  const divergeCount = progressQuery.data?.divergeIdeaCount ?? 0;

  const handleRetry = async () => {
    if (!sessionId) return;
    useSessionStore.setState({ error: null, errorStage: null, isLoading: true });
    try {
      await retryMutation.mutateAsync({ id: sessionId });
    } catch {
      useSessionStore.setState({ isLoading: false });
    }
  };

  const handleResume = async () => {
    if (!sessionId) return;
    useSessionStore.setState({ error: null, errorStage: null, isLoading: true });
    try {
      await resumeMutation.mutateAsync({ id: sessionId });
    } catch {
      useSessionStore.setState({ isLoading: false });
    }
  };

  const handleDismiss = () => {
    useSessionStore.setState({ error: null, errorStage: null });
  };

  return (
    <div className="bg-red-900/40 border-b border-red-700/50 px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        {stageLabel && (
          <span className="text-red-300 text-xs font-medium uppercase tracking-wide mr-2">
            {stageLabel}
          </span>
        )}
        <span className="text-red-200 text-sm">{error}</span>
      </div>
      {canResume && (
        <button
          onClick={handleResume}
          disabled={isLoading}
          className="btn-secondary text-xs shrink-0 border-accent/50 text-accent-light hover:bg-accent/20 disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              Resuming...
            </span>
          ) : (
            `Resume (preserve ${divergeCount} ideas)`
          )}
        </button>
      )}
      <button
        onClick={handleRetry}
        disabled={isLoading}
        className="btn-secondary text-xs shrink-0 border-red-700/50 text-red-200 hover:bg-red-800/50 disabled:opacity-50"
      >
        {isLoading ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 border-2 border-red-300/30 border-t-red-300 rounded-full animate-spin" />
            Retrying...
          </span>
        ) : (
          `Retry${canResume ? ' (start fresh)' : ''}`
        )}
      </button>
      <button
        onClick={handleDismiss}
        className="text-red-400 hover:text-red-200 text-xs shrink-0"
      >
        Dismiss
      </button>
    </div>
  );
}
