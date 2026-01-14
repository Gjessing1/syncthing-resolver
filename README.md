# Syncthing-resolver
Three-way merge using simple file versioning, dockerised for easy deployment

Based on the public python gist: https://gist.github.com/solarkraft/26fe291a3de075ae8d96e1ada928fb7d (MIT Licensed)
Adapted to node.js and added selective paths to watch and file extension control to easy use with Obsidian or other synced text documents (avoiding binary files).

## How it works
- Watch: Uses chokidar to monitor your specified folder for new conflict files.
- Identify: Extracts the file metadata and locates the "ancestor" version in the .stversions directory.
- Merge: Executes git merge-file --union to combine the changes.
Using the --union flag ensures that if the same line was edited on both devices, both versions are kept (non-destructive), rather than throwing an error.
- Clean: Deletes the conflict file after a successful merge.

## Merge handling
- Extension Filtering: By default, it only touches text-based files. It will ignore binary files like .jpg, .pdf, or .sqlite to prevent corruption.
- Data Preservation: By using Git's --union merge strategy, the script avoids picking "winners." If two changes conflict on the same line, both are preserved in the text file for you to review.
- Read-Only Ancestors: The script only reads from .stversions; it never modifies your history.

## Configuration

Example docker-compose.yml:
```docker-compose.yml
services:
  syncthing-resolver:
    container_name: syncthing-resolver
    image: ghcr.io/gjessing1/syncthing-resolver:latest
    restart: unless-stopped
    user: "${PUID}:${PGID}"
    
    # Load all variables from .env
    env_file:
      - .env

    volumes:
      # Maps the path defined in .env (HOST_SYNCTHING_PATH)
      # to the fixed internal path (/data)
      - ${HOST_SYNCTHING_PATH}:/data:rw
```

Configuration .env file:
```
# ==============================================================================
# 1. HOST CONFIGURATION (Where are the files on your computer?)
# ==============================================================================

# The absolute path to your ROOT Syncthing folder on your host machine.
# IMPORTANT: This folder must contain the .stversions directory.
# Example Linux: /home/user/Syncthing/Obsidian
# Example Mac:   /Users/name/Syncthing/Obsidian
# Example Windows: C:/Users/name/Syncthing/Obsidian
HOST_SYNCTHING_ROOT=./example-folder

# ==============================================================================
# 2. CONTAINER CONFIGURATION (Do not use host paths here!)
# ==============================================================================
# Inside the container, your HOST_SYNCTHING_ROOT is always mounted at: /data
# All paths below MUST start with /data

# The Root path inside the container (usually just /data)
# This is used to locate /data/.stversions
SYNC_ROOT=/data

# The specific subfolder you want to watch for conflicts
# Example: If you only want to watch the 'Work' subfolder, use /data/Work
WATCH_PATH=/data/Work/Drafts

# Where to write the log file (inside the container)
MERGE_LOG_PATH=/data/Work/_sync-merge-log.md

# ==============================================================================
# 3. APP SETTINGS
# ==============================================================================
# Name of the versions directory (usually .stversions)
VERSIONS_DIR=.stversions

# Time in ms to wait for file operations to settle
SETTLE_DELAY=250

# Set to 'true' to simulate merges without changing files
DRY_RUN=false

# Comma-separated list of extensions to process
ALLOWED_EXTENSIONS=md,txt,json,yaml,yml,org,canvas,taskpaper

# Enable verbose logging for debugging
VERBOSE=false

# Backup the conflict file before merging - The pre-merge backups are currently stored in the same directory as the original file being merged. Subject to change in later releases.
BACKUP_BEFORE_MERGE=false

# Git binary to use
GIT_BIN=git

# ==========================================
# PERMISSIONS - Typical for Ubuntu/Debian Systems
# ==========================================
PUID=1000
PGID=1000
```
