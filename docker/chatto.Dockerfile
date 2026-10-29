# Chatto mit den Patches aus patches/*.patch.
# Baut Frontend + Go-Binary aus dem Upstream-Tag und legt das Binary über das
# offizielle Release-Image, damit Entrypoint, ffmpeg, NATS-CLI usw. gleich bleiben.
# Build-Kontext ist das Repo-Wurzelverzeichnis (siehe .github/workflows/images.yml).
ARG CHATTO_VERSION

FROM node:24-bookworm AS frontend
ARG CHATTO_VERSION
RUN test -n "$CHATTO_VERSION"
RUN npm install -g pnpm@11.25.0
WORKDIR /src
RUN git clone --depth 1 --branch "v${CHATTO_VERSION}" https://github.com/chattocorp/chatto.git .
COPY patches /patches
RUN git -c user.name=build -c user.email=build@localhost am /patches/*.patch
RUN pnpm install --frozen-lockfile
RUN CHATTO_BUILD_VERSION="${CHATTO_VERSION}-lizzard" pnpm run build:frontend \
 && bash tools/prepare-embedded-frontend.sh apps/frontend/build cli/internal/http_server/.client

FROM golang:1.26 AS backend
COPY --from=frontend /src /src
WORKDIR /src
RUN mkdir -p cli/cmd/embedded \
 && cp LICENSES/AGPL-3.0-or-later.txt cli/LICENSE \
 && cp NOTICE cli/NOTICE \
 && cp LICENSES/AGPL-3.0-or-later.txt cli/cmd/embedded/LICENSE \
 && cp NOTICE cli/cmd/embedded/NOTICE
WORKDIR /src/cli
# nodynamic: HEIC-Decoder (purego) sonst dynamisch gegen glibc gelinkt → läuft nicht auf Alpine.
# Tags wie upstream in .github/workflows/release.yml halten.
RUN CGO_ENABLED=0 go build -trimpath -tags nomsgpack,nodynamic -ldflags "-s -w" -o /chatto .

FROM ghcr.io/chattocorp/chatto:${CHATTO_VERSION}
LABEL org.opencontainers.image.source="https://github.com/lizzard77/chatto"
LABEL org.opencontainers.image.description="Chatto mit Lizzard-Patches (iframe-Links, 3D-Würfel, Bild-Anmerkungen)"
COPY --from=backend /chatto /chatto
# Binary muss im Laufzeit-Image (Alpine/musl) starten – fehlender Loader fällt hier auf, nicht erst beim Deploy.
RUN /chatto --version
