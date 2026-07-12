# ---- Build stage: has the C++ toolchain better-sqlite3 needs if no ----
# ---- prebuilt binary matches this platform (e.g. arm64 Raspberry Pi). ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public

# ---- Runtime stage: small image, no build tools left in it. ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# Keep the database and uploads outside the app code directory so a
# docker-compose volume can mount over just this path and persist across
# image updates/restarts.
ENV DB_PATH=/app/data/data.sqlite
COPY --from=build /app /app
RUN mkdir -p /app/data /app/uploads
EXPOSE 8080
CMD ["npm", "start"]
