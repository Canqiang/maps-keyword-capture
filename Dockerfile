# Build and runtime both use the official Playwright image pinned to the same version as
# package.json, so the bundled Chromium matches the library. Target platform: linux/amd64 (AKS aiapp).
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.63.0-noble
# tini reaps Chromium's child processes and forwards SIGTERM to node.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && echo "pwuser uid=$(id -u pwuser) gid=$(id -g pwuser)"
ARG GIT_COMMIT=unknown
ENV NODE_ENV=production \
    GIT_COMMIT=${GIT_COMMIT} \
    HOME=/tmp
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER pwuser
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/cli.js", "--config", "/config/keywords.json"]
