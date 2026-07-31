import { locales, localeNames, localeShortNames, useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * The language switch, as a two-option segmented control rather than a
 * dropdown: with exactly two languages a select would hide the alternative
 * behind a click, and "VI"/"EN" is legible to a reader of either one.
 *
 * `tone` picks the palette for the surface it sits on — the sidebar is dark,
 * the sign-in card and gallery header are not.
 */
export function LanguageToggle({ className, tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const { locale, setLocale, t } = useI18n()
  const dark = tone === "dark"
  return (
    <div
      role="group"
      aria-label={t("common.switchLanguage")}
      className={cn("inline-flex gap-0.5 rounded-lg border p-0.5", dark ? "border-white/10" : "border-border", className)}
    >
      {locales.map((code) => {
        const active = code === locale
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={active}
            // The full language name is the accessible name; the two letters
            // are decoration a screen reader has no use for.
            aria-label={localeNames[code]}
            title={localeNames[code]}
            className={cn(
              "h-7 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? dark ? "bg-white/15 text-white" : "bg-secondary text-secondary-foreground"
                : dark ? "text-sidebar-muted hover:text-white" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span aria-hidden="true">{localeShortNames[code]}</span>
          </button>
        )
      })}
    </div>
  )
}
