import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? "./" : "/",
  root: "apps/web",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: {
    outDir: mode === "pages" ? "../../dist/pages" : "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve("apps/web/index.html"),
        help: resolve("apps/web/help.html"),
      },
    },
  },
}));
