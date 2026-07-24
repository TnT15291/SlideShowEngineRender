export type ServerEvent = { event: string; data: string }

export function createSseParser(onEvent: (event: ServerEvent) => void) {
  let buffer = ""

  return (chunk: string) => {
    buffer += chunk
    let boundary = /\r?\n\r?\n/.exec(buffer)
    while (boundary) {
      const block = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary[0].length)
      const lines = block.split(/\r?\n/)
      let event = "message"
      const data: string[] = []
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trimStart()
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
      }
      if (data.length) onEvent({ event, data: data.join("\n") })
      boundary = /\r?\n\r?\n/.exec(buffer)
    }
  }
}
