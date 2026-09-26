FROM rust:1-slim AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN useradd --create-home olyr
COPY --from=build /src/target/release/risk-engine /usr/local/bin/risk-engine
USER olyr
ENV RISK_ENGINE_PORT=8002
EXPOSE 8002
ENTRYPOINT ["risk-engine"]
