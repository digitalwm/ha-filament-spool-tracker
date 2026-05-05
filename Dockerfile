# syntax=docker/dockerfile:1

ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest

# Official Node image for the same CPU/OS as this build (amd64, arm64, …).
# Without --platform=$TARGETPLATFORM, `COPY --from=node:…` could pull the builder host’s arch
# and break on other machines (e.g. amd64 Node inside an arm64 HA image).
# Default: common local/CI amd64 build. BuildKit/buildx overrides this per `--platform` / multi-arch.
ARG TARGETPLATFORM=linux/amd64
FROM --platform=$TARGETPLATFORM node:20-alpine AS node_upstream

# ---------------------------------------------------------------------------
# Shared stack: Home Assistant OS + Node + pnpm — used by builder and runtime.
# Native deps (e.g. better-sqlite3) compile against this libc/musl in builder and
# load on the same stack at runtime (no Alpine-vs-HA mismatch).
# ---------------------------------------------------------------------------
FROM $BUILD_FROM AS base

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apk add --no-cache bash curl && rm -rf /var/cache/apk/*

# Node/npm from official image (pinned major); arch matches TARGETPLATFORM (see node_upstream).
COPY --from=node_upstream /usr/local/bin/node /usr/local/bin/node
COPY --from=node_upstream /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && npm install -g pnpm@8

# ---------------------------------------------------------------------------
# Build stage — extends base with toolchain only (not shipped in final image).
# ---------------------------------------------------------------------------
FROM base AS builder

RUN apk add --no-cache git python3 make g++ && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json pnpm-*.yaml ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY types/package.json ./types/

# Install dependencies (handle lockfile version differences)
RUN pnpm install --force || pnpm install

# Copy source code
COPY server/ ./server/
COPY client/ ./client/
COPY types/ ./types/

# Generate Prisma client (essential for TypeScript types)
RUN pnpm --filter @ha-addon/server db:generate

# Build all packages in the workspace
RUN pnpm build

# ---------------------------------------------------------------------------
# Production — same base as builder; no duplicate Node/pnpm install.
# ---------------------------------------------------------------------------
FROM base

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder /app/package*.json /app/pnpm-*.yaml ./
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/client/package.json ./client/
COPY --from=builder /app/types/package.json ./types/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/types ./types

# Copy and setup startup scripts
COPY run.sh /run.sh
COPY run-standalone.sh /run-standalone.sh
RUN chmod +x /run.sh /run-standalone.sh

# Create data directory for persistence
RUN mkdir -p /data

# Ports are handled by Home Assistant ingress and port mapping
# No need to EXPOSE when using ingress system

# Start the application
CMD ["/run.sh"]
