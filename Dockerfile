# Cuttle's renderer on Linux, without a screen: the cuttle command renders, previews and checks
# videos written in code (motion pages, music) in a container. Recording stays Windows and macOS.
#
#   docker build -t cuttle .
#   docker run --rm --init -v "$PWD/my-video:/video" cuttle -C /video --json render
#
# Electron draws in a virtual display (Xvfb) with Chromium's software GL (SwiftShader); the export
# encodes with its software H.264 encoder and muxes with the system's ffmpeg.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg xvfb \
     libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgtk-3-0 libgbm1 libasound2 libxss1 libxshmfence1 libdrm2 \
     fonts-noto-core fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /cuttle
COPY . .
RUN pnpm install --frozen-lockfile \
  && node -e "require('electron')" \
  && pnpm cli:build

# a virtual display around every run (as root, the CLI runs Chromium without its sandbox); run it
# with --init, so that the container's first process reaps Chromium's
ENTRYPOINT ["/cuttle/tools/docker/entrypoint.sh"]
CMD ["--help"]
