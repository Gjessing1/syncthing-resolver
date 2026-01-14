# Syncthing-resolver
Three-way merge using simple file versioning, dockerised for easy deployment

Based on the public python gist: https://gist.github.com/solarkraft/26fe291a3de075ae8d96e1ada928fb7d (MIT Licensed)
Adapted to node.js 

## How it works
Watch: Uses chokidar to monitor your specified folder for new conflict files.
Identify: Extracts the file metadata and locates the "ancestor" version in the .stversions directory.
Merge: Executes git merge-file --union to combine the changes.
Using the --union flag ensures that if the same line was edited on both devices, both versions are kept (non-destructive), rather than throwing an error.
Clean: Deletes the conflict file after a successful merge.

## Merging handling
Extension Filtering: By default, it only touches text-based files. It will ignore binary files like .jpg, .pdf, or .sqlite to prevent corruption.
Data Preservation: By using Git's --union merge strategy, the script avoids picking "winners." If two changes conflict on the same line, both are preserved in the text file for you to review.
Read-Only Ancestors: The script only reads from .stversions; it never modifies your history.

## Configuration

Example docker-compose.yml:
```docker-compose.yml
services:
  deconflict:
    build: .
    container_name: syncthing-deconflict
    restart: unless-stopped
    volumes:
      # Mount your Syncthing folder - adjust path as needed
      - /path/to/your/syncthing/folder:/data:rw
    environment:
      - WATCH_PATH=/data/Notes/Work
      - SYNC_ROOT=/data
      - VERSIONS_DIR=.stversions
      - SETTLE_DELAY=250
      - DRY_RUN=false
      - ALLOWED_EXTENSIONS=md,txt,json,yaml,yml,org,canvas,taskpaper
      - VERBOSE=false
      - BACKUP_BEFORE_MERGE=true
      - MERGE_LOG_PATH=/data/Notes/Work/_sync-merge-log.md
    # Optional: use .env file instead of inline environment
    # env_file:
    #   - .env
```

Optional .env file:
```
# Syncthing 3-Way Merge Deconflicter Configuration

# Path to watch for conflict files
WATCH_PATH=./Notes/Work

# Root of the Syncthing folder (used to locate .stversions)
SYNC_ROOT=./

# Name of the Syncthing versions directory
VERSIONS_DIR=.stversions

# Path to git binary
GIT_BIN=git

# Delay (ms) to wait for Syncthing to finish writing files
SETTLE_DELAY=250

# Dry run mode - set to 'true' to test without modifying files
DRY_RUN=false

# Allowed file extensions (comma-separated, no dots)
ALLOWED_EXTENSIONS=md,txt,json,yaml,yml,org,canvas,taskpaper

# Verbose logging
VERBOSE=false

# Create backup before merging (set to 'false' to disable)
BACKUP_BEFORE_MERGE=true

# Path to merge log file (leave empty to disable)
# This file will be created inside your Obsidian vault so you can review merges
MERGE_LOG_PATH=./Notes/Work/_sync-merge-log.md
```
