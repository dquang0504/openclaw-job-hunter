FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN go build -o scraper cmd/scraper/main.go
RUN go build -o server cmd/server/main.go

FROM mcr.microsoft.com/playwright:v1.40.0-focal
WORKDIR /app
COPY --from=builder /app/scraper .
COPY --from=builder /app/server .
COPY configs/ ./configs/

# Cloud Run expects PORT environment variable
ENV PORT=8080
EXPOSE 8080

CMD ["./server"]