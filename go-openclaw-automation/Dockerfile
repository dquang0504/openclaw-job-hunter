FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN go build -o scraper cmd/scraper/main.go

FROM mcr.microsoft.com/playwright:v1.40.0-focal
WORKDIR /app
COPY --from=builder /app/scraper .
COPY ../.env ./.env
COPY configs/ ./configs/
CMD ["./scraper"]