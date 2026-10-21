FROM fbrdevacr.azurecr.io/ai/maps-android-runtime@sha256:7691aa8c220d055619ceb0d45c15ca0f2ca434f8b059d9db219ab00bf19c6fc5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM fbrdevacr.azurecr.io/ai/maps-android-runtime@sha256:7691aa8c220d055619ceb0d45c15ca0f2ca434f8b059d9db219ab00bf19c6fc5
ARG GIT_COMMIT=unknown
ENV NODE_ENV=production GIT_COMMIT=${GIT_COMMIT}
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY deploy/android ./deploy/android
CMD ["node", "dist/domain/cli.js"]
