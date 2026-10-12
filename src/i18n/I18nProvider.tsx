import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '../core/format';
import { cs, type Messages } from './cs';
import { en } from './en';

const MESSAGES: Record<Locale, Messages> = { cs, en };
const STORAGE_KEY = 'logistics-locale';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Messages;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function isLocale(value: unknown): value is Locale {
  return value === 'cs' || value === 'en';
}

export function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Úložiště může být zakázané; použije se jazyk prohlížeče.
  }
  const browser = navigator.language.toLowerCase();
  return browser.startsWith('cs') || browser.startsWith('sk') ? 'cs' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Volba jazyka se jen nezapamatuje.
    }
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t: MESSAGES[locale] }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n musí být uvnitř <I18nProvider>');
  return context;
}
