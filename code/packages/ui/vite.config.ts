import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const ENGINE = "http://127.0.0.1:9656";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": ENGINE, "/hook": ENGINE, "/health": ENGINE },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
