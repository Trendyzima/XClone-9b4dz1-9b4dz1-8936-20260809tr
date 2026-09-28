FROM golang:1.23-bookworm AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/testagram-media-engine .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/testagram-media-engine /testagram-media-engine
EXPOSE 8080
EXPOSE 10000-20000/udp
USER nonroot:nonroot
ENTRYPOINT ["/testagram-media-engine"]
