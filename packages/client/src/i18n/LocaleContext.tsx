import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Locale } from '@ideafactory/shared';
import en from './en.js';
import fi from './fi.js';
import type { TranslationKey } from './en.js';

const STORAGE_KEY = 'ideafactory-locale';

const translations: Record<Locale, Record<TranslationKey, string>> = { en, fi };

function detectBrowserLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'fi' || stored === 'en') return stored;

  const browserLang = navigator.language || (navigator as { userLanguage?: string }).userLanguage || '';
  if (browserLang.startsWith('fi')) return 'fi';
  return 'en';
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectBrowserLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      let text = translations[locale][key] ?? translations.en[key] ?? key;
      if (params) {
        for (const [param, value] of Object.entries(params)) {
          text = text.replace(`{${param}}`, String(value));
        }
      }
      return text;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext value={value}>{children}</LocaleContext>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}

export function useT() {
  return useLocale().t;
}
