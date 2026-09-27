FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -o /bin/execution ./cmd/server

FROM alpine:3.21
RUN adduser -D olyr
COPY --from=build /bin/execution /usr/local/bin/execution
USER olyr
ENV EXECUTION_PORT=8001
EXPOSE 8001
ENTRYPOINT ["execution"]
