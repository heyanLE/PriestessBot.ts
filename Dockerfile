FROM node:22.22.2-bookworm-slim AS build
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY tools/patch-sdk-types.ts tools/patch-sdk-types.ts
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY apps/ apps/
COPY packages/ packages/
COPY tools/ tools/
RUN npm run build:server
WORKDIR /workspace/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build
WORKDIR /workspace
RUN npm prune --omit=dev

FROM node:22.22.2-bookworm-slim
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=build /workspace/package.json ./
COPY --from=build /workspace/node_modules node_modules
COPY --from=build /workspace/dist dist
COPY --from=build /workspace/dashboard/dist dashboard
COPY resources/.agent/skill/skill-packager/SKILL.md resources/.agent/skill/skill-packager/SKILL.md
USER node
ENV HOST=0.0.0.0 PORT=8081 PRIESTESS_DATA_DIR=/data PRIESTESS_DASHBOARD=/app/dashboard
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8081/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/server/src/main.js"]
