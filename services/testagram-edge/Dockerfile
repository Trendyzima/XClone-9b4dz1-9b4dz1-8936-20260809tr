FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/testagram-edge ./cmd/edge

FROM alpine:3.20
RUN addgroup -S edge && adduser -S -G edge edge
WORKDIR /app
COPY --from=build /out/testagram-edge /app/testagram-edge
RUN mkdir -p /app/cache && chown -R edge:edge /app
USER edge
ENV LISTEN_ADDR=:8080 PUBLIC_BASE_URL=https://media.testagram.site MEDIA_URL_PREFIX=/v1 CACHE_DIR=/app/cache TV_PREFETCH_SECONDS=45s TV_PREFETCH_CONCURRENCY=4 TV_PREFETCH_TIMEOUT=12s MAX_CACHE_BYTES=8589934592 HOT_CACHE_BYTES=536870912 MAX_SEGMENT_BYTES=33554432
EXPOSE 8080
ENTRYPOINT ["/app/testagram-edge"]
