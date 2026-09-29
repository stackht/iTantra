# iTantra hub + web app + ITANTRA product models, in one image.
#
#   npm run models:stage            # gathers the models into deploy/models/
#   docker build -t itantra .
#   docker run -p 7860:7860 itantra # open http://localhost:7860
#
# Needs ~3 GB RAM at runtime (Whisper-small, Opus-MT packs, Piper voices).

# ---- build: install workspaces and build the web client ---------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY client client
COPY server server
# Empty = the page talks to the same origin that serves it (this container).
ARG VITE_HUB_URL=
ENV VITE_HUB_URL=${VITE_HUB_URL}
RUN npm run build

# ---- runtime ---------------------------------------------------------------------------------
FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/stackht/iTantra" \
      org.opencontainers.image.description="iTantra web prototype hub with ITANTRA product models (Whisper, Opus-MT, Piper)"
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Python model worker: Whisper (log-mel front-end via transformers, no torch), Opus-MT,
# spellcheck — the same stack as the Android project's reference tooling.
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir onnxruntime sentencepiece numpy transformers

WORKDIR /app
RUN chown 1000:1000 /app
COPY --chown=1000:1000 --from=build /app /app

# Models: the local installs (Whisper-small, voices) and the Android project subset.
COPY --chown=1000:1000 deploy/models/local /app/server/models
COPY --chown=1000:1000 deploy/models/android /opt/itantra/android

ENV NODE_ENV=production \
    PORT=7860 \
    ITANTRA_PYTHON=/opt/venv/bin/python \
    ITANTRA_ANDROID_DIR=/opt/itantra/android \
    TRANSFORMERS_VERBOSITY=error \
    HF_HUB_OFFLINE=1

# Hugging Face Spaces runs containers as uid 1000 (files are owned by it via COPY --chown).
USER 1000

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7860)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server/src/index.ts"]
