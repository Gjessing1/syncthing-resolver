FROM node:20-alpine

# Install git (required for merge-file)
RUN apk add --no-cache git

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy application
COPY syncthing-deconflict.js ./

# Default environment variables (override via docker-compose or -e flags)
ENV WATCH_PATH=/data/Notes/Work \
    SYNC_ROOT=/data \
    VERSIONS_DIR=.stversions \
    GIT_BIN=git \
    SETTLE_DELAY=250 \
    DRY_RUN=false \
    ALLOWED_EXTENSIONS=md,txt,json,yaml,yml,org,canvas,taskpaper \
    VERBOSE=false \
    BACKUP_BEFORE_MERGE=true \
    MERGE_LOG_PATH=/data/Notes/Work/_sync-merge-log.md

# The /data volume should be mounted to your Syncthing folder
VOLUME ["/data"]

CMD ["node", "syncthing-deconflict.js"]