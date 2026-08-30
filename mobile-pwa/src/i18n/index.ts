import { createContext, useContext, useState, useCallback, createElement, type ReactNode } from 'react';
import en from './en';
import es from './es';

export type Locale = 'en' | 'es';

const locales: Record<Locale, Record<string, string>> = { en, es };

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem('xdeck-locale');
    if (saved === 'en' || saved === 'es') return saved;
    const lang = navigator.language.split('-')[0];
    return (lang === 'es' ? 'es' : 'en') as Locale;
  });

  const handleSetLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    localStorage.setItem('xdeck-locale', newLocale);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    let str = locales[locale][key] || locales.en[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  }, [locale]);

  return createElement(
    I18nContext.Provider,
    { value: { locale, setLocale: handleSetLocale, t } },
    children,
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
