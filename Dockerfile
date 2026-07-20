FROM node:22-alpine AS builder

RUN apk add --no-cache openssl && corepack enable
WORKDIR /workspace

COPY . .
RUN pnpm install --frozen-lockfile

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm build

FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl && corepack enable
WORKDIR /workspace
ENV NODE_ENV=production

COPY --from=builder /workspace /workspace
RUN mkdir -p /data/archives && chown -R node:node /data

USER node
EXPOSE 3000 4000
CMD ["pnpm", "--filter", "@private-pub/api", "start"]
