import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Preserve the supplied theme and layout. Separate assets let the
// desktop keep its existing CSP without permitting inline JavaScript.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    proxy: { "/api": process.env.REPRO_API_URL || "http://127.0.0.1:8178" },
  },
});
