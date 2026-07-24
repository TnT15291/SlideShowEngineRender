import assert from "node:assert/strict"
import test from "node:test"

import { createSseParser, type ServerEvent } from "./sse"

test("SSE parser preserves events split across network chunks", () => {
  const events: ServerEvent[] = []
  const push = createSseParser((event) => events.push(event))

  push(": heartbeat\n\nevent: snap")
  push("shot\ndata: {\"status\":")
  push("\"running\"}\n\nevent: log\ndata: first\ndata: second\n\n")

  assert.deepEqual(events, [
    { event: "snapshot", data: '{"status":"running"}' },
    { event: "log", data: "first\nsecond" },
  ])
})
