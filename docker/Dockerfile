# BuildKit syntax directive removed to avoid fetching the frontend image on offline builds.

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json ./
RUN npm install --production=false --legacy-peer-deps

# ---------- builder ----------
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Guarantee public/ exists (Next.js build references it; missing dir breaks COPY in runner stage)
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl tini && addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.js ./next.config.js

# Prepare mount points
RUN mkdir -p /config /downloads /media/movies /media/tv && \
    chown -R app:app /app /config /downloads /media

USER app
EXPOSE 3000

ENV DATABASE_URL="file:/config/aimediacenter.db"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx prisma/seed.ts && node_modules/.bin/next start -p 3000"]
