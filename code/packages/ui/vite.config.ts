import { execSync } from "node:child_process";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const ENGINE = "http://127.0.0.1:9656";

/** The commit this UI is built from (About links it on GitHub); empty outside a git checkout, e.g. the npm package. */
function buildInfo() {
  const git = (args: string) => {
    try {
      return execSync(`git ${args}`, { cwd: import.meta.dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  };
  const commit = git("rev-parse HEAD");
  // local changes to the code (not to session data in .yolo-twice)
  const dirty = commit !== "" && git("status --porcelain --untracked-files=no -- ../..") !== "";
  return { commit, dirty, date: new Date().toISOString() };
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __BUILD__: JSON.stringify(buildInfo()) },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    port: 5173,
    proxy: { "/api": ENGINE, "/hook": ENGINE, "/health": ENGINE },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
