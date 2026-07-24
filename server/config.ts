import { z } from "zod"
import { existsSync } from "node:fs"
import path from "node:path"

const envPath = path.resolve(process.cwd(), ".env")
if (existsSync(envPath)) process.loadEnvFile(envPath)

const configSchema = z.object({
  STOREEL_API_HOST: z.string().min(1).default("127.0.0.1"),
  STOREEL_API_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  STOREEL_WEB_ORIGINS: z.string().min(1).default("http://127.0.0.1:5173"),
  npm_package_version: z.string().default("0.1.0"),
})

const parsed = configSchema.parse(process.env)
const webOrigins = new Set(
  parsed.STOREEL_WEB_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
)

export const config = {
  host: parsed.STOREEL_API_HOST,
  port: parsed.STOREEL_API_PORT,
  webOrigins,
  version: parsed.npm_package_version,
}
