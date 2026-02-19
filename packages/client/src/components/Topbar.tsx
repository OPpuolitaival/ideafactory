import { useLocale, useT } from '../i18n/index.js';
import type { Locale } from '@ideafactory/shared';

interface TopbarProps {
  onSettingsClick: () => void;
  onSessionsClick: () => void;
}

export function Topbar({ onSettingsClick, onSessionsClick }: TopbarProps) {
  const t = useT();
  const { locale, setLocale } = useLocale();

  return (
    <header className="h-14 bg-bg-1 border-b border-bg-3 flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-gray-100">{t('topbar.title')}</h1>
        <span className="text-xs text-gray-500 font-mono">{t('topbar.version')}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 mr-2">
          {(['en', 'fi'] as Locale[]).map((loc) => (
            <button
              key={loc}
              onClick={() => setLocale(loc)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                locale === loc
                  ? 'bg-accent/20 text-accent-light font-medium'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t(`language.${loc}` as 'language.en' | 'language.fi')}
            </button>
          ))}
        </div>
        <button onClick={onSessionsClick} className="btn-ghost text-sm">
          {t('topbar.sessions')}
        </button>
        <button onClick={onSettingsClick} className="btn-ghost text-sm">
          {t('topbar.settings')}
        </button>
      </div>
    </header>
  );
}
