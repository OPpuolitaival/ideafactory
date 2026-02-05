import { trpc } from '../trpc/index.js';

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const configQuery = trpc.config.getConfig.useQuery();

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-2 border border-bg-3 rounded-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Settings</h2>
          <button onClick={onClose} className="btn-ghost text-sm">
            ✕
          </button>
        </div>

        <div className="space-y-6">
          {/* Authentication */}
          <div>
            <p className="text-sm text-gray-400">
              Authentication is handled automatically via Claude Code or the ANTHROPIC_API_KEY environment variable.
            </p>
          </div>

          {/* Current Config */}
          {configQuery.data && (
            <div>
              <label className="block text-sm font-medium mb-2">Current Defaults</label>
              <div className="bg-bg-1 rounded-lg p-3 text-sm font-mono text-gray-400 space-y-1">
                <p>Workers: {configQuery.data.defaults.workerCount}</p>
                <p>Ideas/worker: {configQuery.data.defaults.ideasPerWorker}</p>
                <p>Web search: {configQuery.data.defaults.webSearch ? 'on' : 'off'}</p>
                <p>Default model: {configQuery.data.models.default}</p>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Edit ~/.ideafactory/config.yaml to change defaults.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
