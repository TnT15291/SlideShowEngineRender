import { ArrowLeft, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { LanguageToggle } from "@/components/LanguageToggle"
import { useI18n } from "@/lib/i18n"
import { businessDetails, legalDocuments, unfilledBusinessDetails, type LegalDocument } from "@/lib/legalContent"

export type LegalDocumentId = "terms" | "privacy"

/**
 * The Terms of Service and Privacy Policy, rendered from `legalContent.ts`.
 *
 * Reachable with no session — Stripe and MoMo both check these pages during
 * merchant onboarding, and a customer deciding whether to hand over their
 * wedding photos has to be able to read them before creating an account. That
 * is why `App` routes here ahead of the auth gate.
 */
export function LegalPage({ document, onBack }: { document: LegalDocumentId; onBack: () => void }) {
  const { t, locale } = useI18n()
  const content = legalDocuments(locale)[document]
  const unfilled = unfilledBusinessDetails()

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-20 items-center justify-between gap-3 border-b px-4 md:px-10">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-4" /> {t("common.back")}</Button>
        <LanguageToggle />
      </header>

      <article className="mx-auto max-w-3xl px-6 py-10 md:px-10">
        {/* An unfinished policy must not be able to go out quietly, so the gap
            is shown on the page itself rather than left as a code comment.
            Every name here is a key of `businessDetails`. */}
        {unfilled.length > 0 && (
          <div className="mb-8 flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning-text">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              <strong>Draft.</strong> These placeholders are still unfilled in <code>apps/web/src/lib/legalContent.ts</code>:{" "}
              {unfilled.join(", ")}.
            </p>
          </div>
        )}

        <h1 className="font-serif text-3xl font-semibold">{content.title}</h1>
        <p className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {t("legal.lastUpdated", { date: lastUpdated(locale) })}
        </p>
        <p className="mt-6 leading-7 text-muted-foreground">{content.intro}</p>

        <Sections document={content} />
      </article>
    </main>
  )
}

function Sections({ document }: { document: LegalDocument }) {
  return (
    <div className="mt-10 space-y-8">
      {document.sections.map((section) => (
        <section key={section.heading}>
          <h2 className="font-serif text-xl font-semibold">{section.heading}</h2>
          <ul className="mt-3 space-y-2.5">
            {section.body.map((paragraph) => (
              <li key={paragraph} className="flex gap-3 leading-7">
                <span aria-hidden="true" className="mt-3 size-1.5 shrink-0 rounded-full bg-primary/60" />
                <span>{paragraph}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function lastUpdated(locale: "vi" | "en") {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "long" })
    .format(new Date(businessDetails.lastUpdated))
}
