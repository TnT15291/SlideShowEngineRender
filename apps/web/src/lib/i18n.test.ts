import assert from "node:assert/strict"
import test from "node:test"

import { detectLocale, translate, type Locale } from "./i18n"
import { strings, type StringKey } from "./strings"

const t = (locale: Locale, key: StringKey, params?: Record<string, string | number>) => translate(locale, key, params)

test("English picks a plural form from `count`; Vietnamese has only one form", () => {
  assert.equal(t("en", "media.photosAdded", { count: 1 }), "1 photo added")
  assert.equal(t("en", "media.photosAdded", { count: 7 }), "7 photos added")
  assert.equal(t("vi", "media.photosAdded", { count: 1 }), "Đã thêm 1 ảnh")
  assert.equal(t("vi", "media.photosAdded", { count: 7 }), "Đã thêm 7 ảnh")
})

test("a `count` param on a key with no plural variants uses the base key", () => {
  assert.equal(t("en", "dashboard.andMore", { count: 3 }), "and 3 more")
  assert.equal(t("vi", "dashboard.andMore", { count: 3 }), "và 3 mục nữa")
})

test("every placeholder in the template is substituted", () => {
  assert.equal(t("en", "plan.quotaUsed", { used: 2, quota: 10 }), "2 of 10 renders used this period")
  assert.equal(t("vi", "plan.quotaUsed", { used: 2, quota: 10 }), "Đã dùng 2/10 lượt kết xuất trong kỳ này")
})

test("an unknown key renders as the key itself, never as blank text", () => {
  // Blank text would hide the gap on a page nobody happened to open;
  // `projects.title` on screen is impossible to miss in review.
  assert.equal(t("vi", "does.not.exist" as StringKey, undefined), "does.not.exist")
})

test("every entry defines both languages", () => {
  const missing = Object.entries(strings).flatMap(([key, entry]) => [
    ...(entry.vi?.trim() ? [] : [`${key}.vi`]),
    ...(entry.en?.trim() ? [] : [`${key}.en`]),
  ])
  assert.deepEqual(missing, [], `empty translations: ${missing.join(", ")}`)
})

test("both languages of an entry use the same placeholders", () => {
  // A placeholder present in one language and not the other silently drops a
  // number for half the customers — "Đã dùng lượt kết xuất" with no figure.
  const names = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",")
  const mismatched = Object.entries(strings)
    .filter(([, entry]) => names(entry.vi) !== names(entry.en))
    .map(([key, entry]) => `${key} (vi:${names(entry.vi)} en:${names(entry.en)})`)
  assert.deepEqual(mismatched, [], `placeholder mismatch: ${mismatched.join(" | ")}`)
})

test("plural keys come in _one/_other pairs", () => {
  const lonely = Object.keys(strings).filter((key) =>
    (key.endsWith("_one") && !(`${key.slice(0, -4)}_other` in strings)) ||
    (key.endsWith("_other") && !(`${key.slice(0, -6)}_one` in strings)))
  assert.deepEqual(lonely, [], `half-defined plural: ${lonely.join(", ")}`)
})

test("no HTML entities survive in text that is rendered as text", () => {
  // These strings go through `{t(...)}`, which escapes nothing — a stray
  // "&amp;" copied out of JSX would print literally.
  const offenders = Object.entries(strings)
    .filter(([, entry]) => /&(amp|lt|gt|quot|#\d+);/.test(`${entry.vi}${entry.en}`))
    .map(([key]) => key)
  assert.deepEqual(offenders, [], `HTML entities in text: ${offenders.join(", ")}`)
})

test("Vietnamese is the default, and an explicit choice always wins", () => {
  const withNavigator = (languages: string[], stored: string | null) => {
    const originalNavigator = globalThis.navigator
    const originalStorage = globalThis.localStorage
    Object.defineProperty(globalThis, "navigator", { value: { languages, language: languages[0] }, configurable: true })
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => stored, setItem: () => undefined, removeItem: () => undefined },
      configurable: true,
    })
    try { return detectLocale() } finally {
      if (originalNavigator) Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true })
      if (originalStorage) Object.defineProperty(globalThis, "localStorage", { value: originalStorage, configurable: true })
      else Reflect.deleteProperty(globalThis, "localStorage")
    }
  }

  // English only when the browser asks for English and never mentions
  // Vietnamese; every other combination falls back to Vietnamese.
  assert.equal(withNavigator(["en-US"], null), "en")
  assert.equal(withNavigator(["vi-VN"], null), "vi")
  assert.equal(withNavigator(["en-US", "vi-VN"], null), "vi")
  assert.equal(withNavigator(["fr-FR"], null), "vi")
  // A stored choice overrides the browser in both directions.
  assert.equal(withNavigator(["en-US"], "vi"), "vi")
  assert.equal(withNavigator(["vi-VN"], "en"), "en")
})
