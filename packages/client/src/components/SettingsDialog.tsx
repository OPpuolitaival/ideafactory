import { trpc } from '../trpc/index.js';
import { useSessionStore } from '../store/index.js';
import { ModelSelector } from './ModelSelector.js';
import { useT } from '../i18n/index.js';

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const t = useT();
  const configQuery = trpc.config.getConfig.useQuery();
  const sessionModels = useSessionStore((s) => s.sessionModels);
  const sessionId = useSessionStore((s) => s.sessionId);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-bg-2 border border-bg-3 rounded-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">{t('settings.title')}</h2>
          <button onClick={onClose} className="btn-ghost text-sm">
            ✕
          </button>
        </div>

        <div className="space-y-6">
          {/* Authentication */}
          <div>
            <p className="text-sm text-gray-400">
              {t('settings.authInfo')}
            </p>
          </div>

          {/* Session Models (read-only) */}
          {sessionId && sessionModels && (
            <div>
              <label className="block text-sm font-medium mb-2">{t('settings.sessionModels')}</label>
              <div className="space-y-2 p-3 bg-bg-1 rounded-lg border border-bg-3">
                <ModelSelector role="Navigator" value={sessionModels.navigator} onChange={() => {}} disabled />
                <ModelSelector role="Strategist" value={sessionModels.strategist} onChange={() => {}} disabled />
                <ModelSelector role="Worker" value={sessionModels.worker} onChange={() => {}} disabled />
                <ModelSelector role="Analyst" value={sessionModels.analyst} onChange={() => {}} disabled />
              </div>
            </div>
          )}

          {/* Current Config */}
          {configQuery.data && (
            <div>
              <label className="block text-sm font-medium mb-2">{t('settings.currentDefaults')}</label>
              <div className="bg-bg-1 rounded-lg p-3 text-sm font-mono text-gray-400 space-y-1">
                <p>{t('settings.ideasPerWorker')}: {configQuery.data.defaults.ideasPerWorker}</p>
                <p>{t('settings.webSearch')}: {configQuery.data.defaults.webSearch ? t('settings.on') : t('settings.off')}</p>
                <p>{t('settings.defaultModel')}: {configQuery.data.models.default}</p>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {t('settings.editConfig')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
