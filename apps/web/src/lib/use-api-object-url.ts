import { useEffect, useState } from "react"

import { apiBlob } from "./api"

export function useApiObjectUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setUrl(null)
    if (!path) return () => { active = false }

    void apiBlob(path).then((blob) => {
      objectUrl = URL.createObjectURL(blob)
      if (active) setUrl(objectUrl)
      else URL.revokeObjectURL(objectUrl)
    }).catch(() => {
      if (active) setUrl(null)
    })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  return url
}
