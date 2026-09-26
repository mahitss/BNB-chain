# Build stage — install workspace dependencies and build the Next.js app.
# Build context is the repository root (see docker-compose.yml).
FROM node:24-alpine AS build
# NODE_ENV stays unset so devDependencies install and `next build` runs in
# production mode; only registry fetch resilience is configured.
ENV npm_config_fetch_retries=5
ENV npm_config_fetch_retry_maxtimeout=120000
ENV npm_config_fetch_retry_mintimeout=20000
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN pnpm install --frozen-lockfile --filter @olyr/web...
RUN pnpm --filter @olyr/web... build

# Runtime stage.
FROM node:24-alpine
ENV NODE_ENV=production
RUN corepack enable && pnpm --version
WORKDIR /repo
COPY --from=build --chown=node:node /repo ./
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "--filter", "@olyr/web", "start"]
