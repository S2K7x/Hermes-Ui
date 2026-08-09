# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
# bookworm (not alpine): better-sqlite3 ships prebuilt binaries for glibc
# arm64. On musl it would have to compile from source on the Pi every build.
FROM node:22-bookworm-slim AS build

WORKDIR /app

# python3/make/g++ are only needed if prebuild-install misses for this
# arch/ABI; they stay out of the runtime image either way.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The build only needs the variable to exist — config.ts throws on an empty
# key at import time, and prerendering would trip that. The real key is
# injected at runtime.
RUN HERMES_API_KEY=build-time-placeholder \
	HERMES_PUBLIC_ORIGIN=https://placeholder.invalid \
	npm run build

# Drop dev dependencies but keep the compiled better-sqlite3 binding.
RUN npm prune --omit=dev

# ---- runtime --------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	WEB_DB_PATH=/data/hermes-web.db

WORKDIR /app

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build/index.js"]
