# ─────────────────────────────────────────────
# OpenClaw Job Hunter — Makefile
# Usage:
#   make server    → start server only (Telegram polling + HTTP)
#   make scraper   → run scraper once
#   make dev       → start server + scraper concurrently
#   make build     → build both binaries into ./bin/
#   make test      → run unit tests only (fast, no browser, -short)
#   make test-all  → run all tests including integration (opens browser)
#   make clean     → remove built binaries
# ─────────────────────────────────────────────

.PHONY: server scraper dev build test test-all clean test-facebook

# Run the server (blocks — Telegram polling + HTTP on :8080)
server:
	go run ./cmd/server/

# Run the scraper once then exit
scraper:
	go run ./cmd/scraper/

# Push base-knowledge.json to DB (updates master_resume_json for all users)
update-resume:
	go run ./cmd/update_resume/

# Start server first, wait 3s for it to initialize, then run scraper.
# `trap 'kill 0' INT` ensures Ctrl+C kills all background processes cleanly.
dev:
	@echo "🚀 Starting Server + Scraper..."
	@trap 'kill 0' INT; \
	go run ./cmd/server/ & \
	sleep 3 && go run ./cmd/scraper/ & \
	wait

# Build production binaries into ./bin/
build:
	@mkdir -p bin
	go build -o bin/server  ./cmd/server/
	go build -o bin/scraper ./cmd/scraper/
	@echo "✅ Build complete → bin/server, bin/scraper"

# Unit tests only — fast, no browser needed (-short skips integration tests)
test:
	go test -short ./...

# All tests including integration tests (opens real browser, needs network)
test-all:
	go test ./...

# Legacy test target
test-facebook:
	go run cmd/test/facebook/main.go

# Remove built binaries
clean:
	rm -rf bin/
	@echo "🧹 Cleaned bin/"