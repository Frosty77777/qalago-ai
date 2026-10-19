import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Language } from '../api/types'
import { CATEGORY_LABELS, STRINGS, type StringKey } from './strings'

const STORAGE_KEY = 'qalago.lang'
const LOCALES: Record<Language, string> = { en: 'en', ru: 'ru', kk: 'kk' }

function readStoredLanguage(): Language | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'ru' || v === 'kk' || v === 'en' ? v : null
  } catch {
    return null
  }
}

interface I18n {
  lang: Language
  locale: string
  setLang: (l: Language) => void
  t: (key: StringKey, vars?: Record<string, string | number>) => string
  category: (c: string) => string
  formatDate: (iso: string) => string
}

const I18nContext = createContext<I18n | null>(null)

export function I18nProvider({ initial, children }: { initial?: Language | null; children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => initial ?? readStoredLanguage() ?? 'ru')

  useEffect(() => {
    document.documentElement.lang = LOCALES[lang]
  }, [lang])

  const setLang = useCallback((l: Language) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // Storage may be unavailable (private mode); language still applies for this session.
    }
  }, [])

  const value = useMemo<I18n>(() => {
    const dict = STRINGS[lang]
    return {
      lang,
      locale: LOCALES[lang],
      setLang,
      t: (key, vars) => {
        let s = dict[key] ?? STRINGS.en[key]
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
        return s
      },
      category: (c) => CATEGORY_LABELS[lang][c] ?? c.replaceAll('_', ' '),
      formatDate: (iso) => {
        const d = new Date(iso)
        return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: 'medium', timeStyle: 'short' }).format(d)
      },
    }
  }, [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
