const locks = new Map<string, Promise<void>>()

// Serializes concurrent read-modify-write JSON file updates keyed by file path.
export async function withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve()
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const current = previous.then(() => gate)
  locks.set(key, current)
  await previous
  try {
    return await action()
  } finally {
    release()
    if (locks.get(key) === current) locks.delete(key)
  }
}
