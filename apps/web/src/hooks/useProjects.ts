import { useCallback, useEffect, useState } from "react"

import { apiGet } from "@/lib/api"
import type { ProjectListResponse } from "@/types"

export function useProjects() {
  const [data, setData] = useState<ProjectListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    apiGet<ProjectListResponse>("/projects")
      .then(setData)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(reload, [reload])
  return { data, error, loading, reload }
}
