SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := build

# The web client is embedded in the binary, so it builds first and is copied
# into the package holding the embed directive. UI_ASSETS is generated output,
# git-ignored apart from the .gitkeep that keeps go:embed happy.
UI_ASSETS := server/internal/webui/assets
BIN := ./rhythm
GO_LDFLAGS := -s -w

.PHONY: build web server clean test test-go test-web fmt fmt-check lint dev-server dev-web docker

build: web server

## web: build the client and stage it for embedding
web:
	cd web && pnpm install --frozen-lockfile && pnpm build
	find $(UI_ASSETS) -mindepth 1 ! -name .gitkeep -delete
	cp -R web/dist/. $(UI_ASSETS)/

## server: compile the single static binary (expects `make web` to have run)
server:
	cd server && CGO_ENABLED=0 go build -trimpath -ldflags '$(GO_LDFLAGS)' \
		-o ../$(BIN) ./cmd/rhythm

test: test-go test-web

test-go:
	cd server && go test ./... && go test -race ./... && go vet ./... && go mod tidy -diff

test-web:
	cd web && pnpm test && pnpm typecheck && pnpm exec prettier --check .

fmt:
	cd server && gofmt -w .
	cd web && pnpm exec prettier --write .

fmt-check:
	@out="$$(cd server && gofmt -l .)"; \
	if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi
	cd web && pnpm exec prettier --check .

## dev-server: run the API alone (pair with dev-web)
dev-server:
	cd server && go run ./cmd/rhythm --music $(MUSIC)

## dev-web: Vite, proxying /api to a locally running rhythm
dev-web:
	cd web && pnpm dev

docker:
	docker build --tag rhythm:dev .

clean:
	rm -f $(BIN)
	rm -rf web/dist
	find $(UI_ASSETS) -mindepth 1 ! -name .gitkeep -delete
