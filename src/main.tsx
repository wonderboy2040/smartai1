import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

// v13.5 (full-site recheck): ToastProvider removed — the Toast system was
// fully dead (zero useToast/addToast call sites; every error path used
// alert()). src/components/Toast.tsx deleted with it.

createRoot(document.getElementById("root")!).render(
<StrictMode>
<ErrorBoundary>
<App />
</ErrorBoundary>
</StrictMode>
);

// --- PWA: register service worker for installability + offline shell ---
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("SW registration failed:", err);
    });
  });
}
