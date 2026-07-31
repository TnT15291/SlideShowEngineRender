import { useEffect, useRef, useState } from "react"

import { apiBlob } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * An authenticated <img> that only fetches once it is close to the viewport.
 *
 * The API needs a bearer header, so the URL can't go straight into `src` and
 * the browser's native `loading="lazy"` never applies. Without the observer a
 * project with a hundred photos would fire a hundred blob requests the moment
 * the Media step mounted.
 */
export function LazyApiImage({ path, alt, className, rootMargin = "400px" }: {
  path: string | null | undefined
  alt: string
  className?: string
  rootMargin?: string
}) {
  const { t } = useI18n()
  const holder = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const node = holder.current
    if (!node || inView) return
    if (typeof IntersectionObserver !== "function") { setInView(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setInView(true)
        observer.disconnect()
      }
    }, { rootMargin })
    observer.observe(node)
    return () => observer.disconnect()
  }, [inView, rootMargin])

  useEffect(() => {
    if (!inView || !path) return
    let active = true
    let objectUrl: string | null = null
    setFailed(false)
    void apiBlob(path).then((blob) => {
      objectUrl = URL.createObjectURL(blob)
      if (active) setUrl(objectUrl)
      else URL.revokeObjectURL(objectUrl)
    }).catch(() => {
      if (active) setFailed(true)
    })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [inView, path])

  return <div ref={holder} className={cn("relative overflow-hidden bg-muted", className)}>
    {url && <img src={url} alt={alt} className="h-full w-full object-cover" />}
    {!url && <div className={cn("h-full w-full", !failed && "animate-pulse bg-secondary/60")} />}
    {failed && <span className="absolute inset-0 grid place-items-center px-2 text-center text-[10px] leading-tight text-muted-foreground">{t("media.previewUnavailable")}</span>}
  </div>
}
