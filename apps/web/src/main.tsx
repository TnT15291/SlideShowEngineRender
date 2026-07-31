import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import { I18nProvider } from "./lib/i18n"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined)
  })
}
