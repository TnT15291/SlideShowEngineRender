import { createServer } from "node:http"

import { createRequestHandler } from "./app.js"
import { config } from "./config.js"
import { jobRunner } from "./services/jobs.js"
import { analysisService } from "./services/analysis.js"

const server = createServer(createRequestHandler())

server.listen(config.port, config.host, () => {
  console.log(`[storeel-api] http://${config.host}:${config.port}`)
})

async function shutdown() {
  await jobRunner.shutdown()
  await analysisService.shutdown()
  server.close(() => process.exit(0))
}

process.on("SIGINT", () => { void shutdown() })
process.on("SIGTERM", () => { void shutdown() })
