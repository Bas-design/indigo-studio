# Indigo Studio — the project editor Mia runs on her own PC.
#
# bookworm-slim rather than alpine: sharp ships prebuilt binaries for
# glibc linux, and on musl it would compile from source on first install
# (slow, and needs a toolchain in the image).
FROM node:22-bookworm-slim

# git does the publishing; ca-certificates lets it talk to github.com over
# HTTPS; tini reaps zombies so Ctrl-C / "docker compose down" is clean.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

# Git asks for the password through this helper instead of us putting the
# token in a command line, where it would show up in `ps` and in any error
# message git prints. The remote URL carries the username only.
RUN printf '#!/bin/sh\nexec printf "%%s" "$GIT_TOKEN"\n' > /usr/local/bin/askpass \
 && chmod 0755 /usr/local/bin/askpass
ENV GIT_ASKPASS=/usr/local/bin/askpass \
    GIT_TERMINAL_PROMPT=0

WORKDIR /app

# Copy manifests first so `docker compose build` reuses the npm layer
# whenever only application code changed.
COPY app/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY app ./

# The repo working copy and the saved GitHub token are bind-mounted from
# the host, so they survive rebuilds and Mia can see the files.
VOLUME ["/site", "/config"]

ENV NODE_ENV=production \
    PORT=4100 \
    SITE_DIR=/site \
    CONFIG_DIR=/config

EXPOSE 4100

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
