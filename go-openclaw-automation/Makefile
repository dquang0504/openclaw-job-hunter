# Build, test, run commands

.PHONY: build test run clean

build:
	go build -o bin/scraper cmd/scraper/main.go

test:
	go test ./...

run:
	go run cmd/scraper/main.go

test-facebook:
	go run cmd/test/facebook/main.go

clean:
	rm -rf bin/