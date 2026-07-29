# One static binary with the web client embedded, so the runtime image needs
# nothing else.

FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /src/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM golang:1.25-alpine AS server
WORKDIR /src/server
COPY server/go.mod ./
RUN go mod download
COPY server/ ./
# Staged into the embed directory, the same as `make web` does locally.
COPY --from=web /src/web/dist/ ./internal/webui/assets/
RUN CGO_ENABLED=0 go build -trimpath -ldflags '-s -w' -o /out/rhythm ./cmd/rhythm

FROM scratch
COPY --from=server /out/rhythm /rhythm
# Numeric: scratch has no /etc/passwd to resolve a name against.
USER 65532:65532
VOLUME ["/music", "/data"]
EXPOSE 4533
ENTRYPOINT ["/rhythm"]
CMD ["--music", "/music", "--data-dir", "/data", "--host", "0.0.0.0", "--port", "4533"]
