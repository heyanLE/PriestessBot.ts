FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY . .
RUN ./gradlew --no-daemon clean installDist

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/build/install/PriestessBot /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl fontconfig fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/config /app/data /app/logs /app/plugins
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1
ENTRYPOINT ["/app/bin/PriestessBot", "--config", "/app/config/config.json"]
