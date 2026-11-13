// Registers the installable web app shell. The service worker only exists in the
// production build, so local development keeps Vite's normal module reloads.
export function registerPwa() {
  if (!import.meta.env.PROD || typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const start = () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installation is optional: the shop keeps working without a worker.
    });
  };

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}
