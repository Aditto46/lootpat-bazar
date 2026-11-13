import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxy = { "/functions/v1/app": "http://127.0.0.1:8000" };

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  server: { host: "127.0.0.1", proxy },
  preview: { host: "127.0.0.1", proxy },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: app code changes often, React/motion rarely do.
        advancedChunks: {
          groups: [
            { name: "react-vendor", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "motion-vendor", test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
          ],
        },
      },
    },
  },
});
