# Build stage — install workspace dependencies and compile the Fastify API.
# Build context is the repository root (see docker-compose.yml).
FROM node:24-alpine AS build
ENV NODE_ENV=development
# Survive flaky registry connections during dependency install.
ENV npm_config_fetch_retries=5
ENV npm_config_fetch_retry_maxtimeout=120000
ENV npm_config_fetch_retry_mintimeout=20000
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile --filter @olyr/api...
# Topological: builds workspace packages first, then the api.
RUN pnpm --filter @olyr/api... build

# Runtime stage.
FROM node:24-alpine
ENV NODE_ENV=production
RUN corepack enable && pnpm --version
WORKDIR /repo
COPY --from=build --chown=node:node /repo ./
USER node
ENV API_PORT=4000
EXPOSE 4000
CMD ["pnpm", "--filter", "@olyr/api", "start"]
