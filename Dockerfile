FROM node:22-bookworm-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && corepack enable \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace

COPY . .
RUN pnpm install --frozen-lockfile

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN build_attempt=1; \
  until pnpm build; do \
    if [ "$build_attempt" -ge 3 ]; then \
      echo "pnpm build failed after ${build_attempt} attempts." >&2; \
      exit 1; \
    fi; \
    echo "pnpm build failed; retrying (${build_attempt}/3) after Prisma engine download interruption..." >&2; \
    build_attempt=$((build_attempt + 1)); \
    sleep 5; \
  done

FROM node:22-bookworm-slim AS runtime

ARG TARGETARCH
ARG FVM_VERSION=3.2.1
ARG FLUTTER_VERSION=3.41.9
ARG APP_VERSION=0.1.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    openssl \
    unzip \
    xz-utils \
  && corepack enable \
  && rm -rf /var/lib/apt/lists/*

RUN case "$TARGETARCH" in \
      amd64) FVM_ARCH=x64; FVM_SHA256=39e8ebdb46b93de1c2aedbfa9aa75103ef16c9bf50048a928ef70abbb456f4f8 ;; \
      arm64) FVM_ARCH=arm64; FVM_SHA256=a5f8902aa503bcb7ab6421f460c73b69008a18dc76c833f4dbbd6ab10875832c ;; \
      *) echo "Unsupported Docker architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
  && curl -fsSL \
    "https://github.com/conceptadev/fvm/releases/download/${FVM_VERSION}/fvm-${FVM_VERSION}-linux-${FVM_ARCH}.tar.gz" \
    -o /tmp/fvm.tar.gz \
  && echo "${FVM_SHA256}  /tmp/fvm.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/fvm.tar.gz -C /opt \
  && ln -s /opt/fvm/fvm /usr/local/bin/fvm \
  && rm /tmp/fvm.tar.gz

WORKDIR /workspace
ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
ENV FVM_EXECUTABLE=/usr/local/bin/fvm
ENV FVM_CACHE_PATH=/opt/fvm-cache
ENV FVM_PROJECT_DIR=/workspace

COPY --from=builder /workspace /workspace
RUN node -e 'const fs = require("node:fs"); fs.writeFileSync(".fvmrc", `${JSON.stringify({ flutter: process.argv[1] }, null, 2)}\n`)' "$FLUTTER_VERSION" \
  && mkdir -p /data/archives "$FVM_CACHE_PATH" \
  && chown -R node:node /data /opt/fvm "$FVM_CACHE_PATH"

USER node
RUN fvm config --cache-path "$FVM_CACHE_PATH" --no-update-check \
  && fvm install "$FLUTTER_VERSION" --setup \
  && fvm global "$FLUTTER_VERSION" \
  && fvm dart pub global activate pana

EXPOSE 3000 4000
CMD ["pnpm", "--filter", "@private-pub/api", "start"]
