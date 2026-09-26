# --- HAL self-hosted web app -------------------------------------------------
# Multi-stage build producing a small standalone Next.js server image.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# --- deps: install the whole workspace ---------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/core/package.json packages/core/package.json
COPY packages/media/package.json packages/media/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile

# --- build: compile core + web ----------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm exec turbo run build --filter=@hal/web...

# --- runtime: standalone server ----------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Next.js standalone output bundles only what the server needs.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
