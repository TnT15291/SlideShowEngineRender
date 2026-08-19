import { useI18n } from "@/lib/i18n"
import type { LegalDocumentId } from "@/LegalPage"

/**
 * The "I agree to the Terms and the Privacy Policy" checkbox.
 *
 * The label is one translated sentence with `{terms}` and `{privacy}` markers
 * in it, split here so each marker becomes a real link. Concatenating three
 * fragments instead would put the word order at the mercy of the language —
 * Vietnamese and English do not agree on where those two names fall.
 *
 * The links open in a new tab: a customer who clicks through mid-registration
 * must not come back to an emptied form.
 */
export function TermsAcceptance({ checked, onChange, disabled, idPrefix = "terms" }: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  idPrefix?: string
}) {
  const { t } = useI18n()
  // No params: `translate` leaves the placeholders intact when none are given,
  // which is exactly the template this needs to split.
  const parts = t("legal.accept").split(/(\{terms\}|\{privacy\})/)

  return (
    <label htmlFor={`${idPrefix}-accept`} className="flex cursor-pointer items-start gap-2.5 text-sm leading-6">
      <input
        id={`${idPrefix}-accept`}
        type="checkbox"
        required
        disabled={disabled}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 shrink-0 cursor-pointer accent-primary"
      />
      <span className="text-muted-foreground">
        {parts.map((part, index) =>
          part === "{terms}" ? <LegalLink key={index} document="terms" label={t("legal.terms")} />
          : part === "{privacy}" ? <LegalLink key={index} document="privacy" label={t("legal.privacy")} />
          : <span key={index}>{part}</span>)}
      </span>
    </label>
  )
}

export function LegalLink({ document, label }: { document: LegalDocumentId; label: string }) {
  return (
    <a
      href={`?view=${document}`}
      target="_blank"
      rel="noreferrer"
      // Stops the click from toggling the checkbox it sits inside.
      onClick={(event) => event.stopPropagation()}
      className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
    >
      {label}
    </a>
  )
}
