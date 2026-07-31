import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { strings, type StringKey } from "./strings"

export const locales = ["vi", "en"] as const
export type Locale = (typeof locales)[number]

const STORAGE_KEY = "storeel.locale"

/** What the language switch shows for each locale — always in its own language. */
export const localeNames: Record<Locale, string> = { vi: "Tiếng Việt", en: "English" }
export const localeShortNames: Record<Locale, string> = { vi: "VI", en: "EN" }

/**
 * Every locale-aware `Intl` call goes through this so dates, numbers and
 * currency follow the chosen language rather than the browser's — otherwise a
 * Vietnamese page would still print "Jul 29, 2026" for an en-US browser.
 */
export const intlLocales: Record<Locale, string> = { vi: "vi-VN", en: "en-US" }

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === "vi" || stored === "en" ? stored : null
  } catch {
    return null // localStorage unavailable (private browsing, etc.)
  }
}

/**
 * Vietnamese is the fallback, English the exception.
 *
 * A stored choice always wins. Failing that, English is used only when the
 * browser asks for English and never mentions Vietnamese — that case is a
 * real visitor (an overseas guest opening a shared gallery link), and the
 * public gallery has no sign-in behind which to hide a language switch.
 * Everything else, including a browser that lists both or neither, gets
 * Vietnamese: this product sells wedding films to Vietnamese couples and
 * charges in VND through MoMo.
 *
 * To make Vietnamese unconditional, drop the `speaksEnglish` branch below and
 * always return "vi"; the switch still reaches English in one click.
 */
export function detectLocale(): Locale {
  const stored = readStoredLocale()
  if (stored) return stored
  const preferred = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]
  const speaksVietnamese = preferred.some((tag) => tag?.toLowerCase().startsWith("vi"))
  const speaksEnglish = preferred.some((tag) => tag?.toLowerCase().startsWith("en"))
  return speaksEnglish && !speaksVietnamese ? "en" : "vi"
}

export type TranslateParams = Record<string, string | number>
export type Translate = (key: StringKey, params?: TranslateParams) => string

/**
 * English needs "1 photo" / "2 photos"; Vietnamese needs neither form. A key
 * that differs by count is stored as `<key>_one` and `<key>_other` and picked
 * here from `params.count`, so callers only ever write the base key.
 */
function pluralize(key: StringKey, params?: TranslateParams): string {
  if (typeof params?.count !== "number") return key
  const variant = `${key}_${params.count === 1 ? "one" : "other"}`
  return variant in strings ? variant : key
}

export function translate(locale: Locale, key: StringKey, params?: TranslateParams): string {
  const entry = strings[pluralize(key, params) as keyof typeof strings]
  // A missing key renders as the key itself. Blank text would hide the gap;
  // `projects.title` on screen makes it obvious in review.
  if (!entry) return key
  const template = entry[locale]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}

type I18nValue = { locale: Locale; setLocale: (locale: Locale) => void; t: Translate }

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  // `<html lang>` is what screen readers and the browser's own translation
  // prompt read; leaving it at the build-time "en" mislabels the whole page.
  useEffect(() => { document.documentElement.lang = locale }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* choice just won't survive a reload */ }
  }, [])

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: (key, params) => translate(locale, key, params) }),
    [locale, setLocale],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>")
  return value
}
