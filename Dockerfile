# Portable, self-hostable Node/SQLite staging image. No production network endpoint.
# Pin the resolved image digest for a real, approved customer release.
FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json LICENSE ./
COPY apps/ ./apps/
COPY packages/ ./packages/
COPY scripts/ ./scripts/
RUN npm run build

FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS runtime
# Operator-supplied labels identify build inputs; they are not signatures.
ARG MIZVO_SOURCE_COMMIT=unverified
ARG MIZVO_SOURCE_TREE=unverified
LABEL org.opencontainers.image.source="https://github.com/devonalanakins/mizvo" \
      org.opencontainers.image.revision="${MIZVO_SOURCE_COMMIT}" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      com.mizvo.checkout-tree="${MIZVO_SOURCE_TREE}"
ENV NODE_ENV=production \
    PORT=4173 \
    MIZVO_BIND_HOST=0.0.0.0 \
    MIZVO_DATABASE=/var/lib/mizvo/mizvo.sqlite
WORKDIR /app
COPY --from=build /src/dist/ ./dist/
RUN mkdir -p /var/lib/mizvo \
    && chown node:node /var/lib/mizvo \
    && chmod 0700 /var/lib/mizvo
USER node
EXPOSE 4173
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/apps/api/server.js"]
