# yolo-twice engine and UI in a container, listening on every interface.
# Build from code/:   docker build -t yolo-twice .
# Run: see documentation/network.md (mounts your project at the same path and your Claude transcripts read-only).
# ---- build: the engine (TypeScript) and the UI (Vite) ----
FROM node:22-bookworm-slim AS build
RUN npm install -g bun@1.3.14
WORKDIR /app
COPY . .
# the website and the pitch deck are workspaces too, but not part of the engine: leave them out;
# then bundle the engine like the npm package (one file, the UI next to it)
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.workspaces=['packages/*'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && bun install && bun run build \
 && cd packages/engine && bun run bundle \
 && node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));delete p.devDependencies;delete p.scripts;fs.writeFileSync('package.json',JSON.stringify(p,null,2))"

# ---- run: the bundled engine and its few runtime dependencies ----
FROM node:22-bookworm-slim
# git: the engine finds the project by its .git and can auto-commit .yolo-twice
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/yolo-twice
COPY --from=build /app/packages/engine/package.json ./
COPY --from=build /app/packages/engine/dist ./dist
COPY --from=build /app/packages/engine/ui ./ui
RUN npm install --omit=dev --no-audit --no-fund

# engine state in /data (a volume if it should survive), Claude transcripts mounted at /claude,
# every interface: inside a container 127.0.0.1 would be unreachable from the host.
# Set by the environment, the address is shown read-only in the UI's settings.
ENV YOLO_TWICE_HOME=/data \
    CLAUDE_CONFIG_DIR=/claude \
    YOLO_TWICE_HOST=0.0.0.0
RUN mkdir -p /data && chmod 1777 /data
EXPOSE 9656
ENTRYPOINT ["node", "/opt/yolo-twice/dist/cli.js"]
CMD ["start", "--foreground"]
