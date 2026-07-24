import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, "../..")
  const env = loadEnv(mode, repoRoot, "")
  const apiPort = env.STOREEL_API_PORT || "8787"
  const apiTarget = `http://127.0.0.1:${apiPort}`

  return {
    root: __dirname,
    envDir: repoRoot,
    base: "/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      // 0.0.0.0 so a phone on the same Wi-Fi can load this during development
      // (see .env.example) — the API proxy target below stays local either way.
      host: "0.0.0.0",
      port: 5173,
      proxy: { "/api": apiTarget },
    },
    preview: {
      host: "0.0.0.0",
      proxy: { "/api": apiTarget },
    },
  }
})
