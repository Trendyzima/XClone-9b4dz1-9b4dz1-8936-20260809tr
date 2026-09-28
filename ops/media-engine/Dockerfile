FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod .
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/testagram-media-engine ./main.go
FROM alpine:3.22
RUN addgroup -S testagram && adduser -S -G testagram testagram
COPY --from=build /out/testagram-media-engine /usr/local/bin/testagram-media-engine
USER testagram
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/testagram-media-engine"]
