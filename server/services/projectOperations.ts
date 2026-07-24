import path from "node:path"

export type ProjectOperation = "job" | "analysis" | "cull" | "timeline" | "revision" | "director" | "delivery"

const activeOperations = new Map<string, ProjectOperation>()

export class ProjectOperationBusyError extends Error {
  constructor(readonly operation: ProjectOperation) {
    super(`Project is busy with ${operation}`)
  }
}

export function acquireProjectOperation(engineRoot: string, projectId: string, operation: ProjectOperation) {
  const key = `${path.resolve(engineRoot)}\0${projectId}`
  const current = activeOperations.get(key)
  if (current) throw new ProjectOperationBusyError(current)
  activeOperations.set(key, operation)
  let released = false
  return () => {
    if (released) return
    released = true
    activeOperations.delete(key)
  }
}
