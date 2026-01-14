# Syncthing-resolver
**An automated 3-way merge daemon for Syncthing conflicts.**

This tool monitors your Syncthing folders and automatically resolves "sync-conflict" files by performing a git three-way merge between the current file, the conflicted version, and the common ancestor found in `.stversions`.

Based on the public python gist by [solarkraft](https://gist.github.com/solarkraft/26fe291a3de075ae8d96e1ada928fb7d). Adapted to Node.js with added support for Docker, environment-based configuration, selective path watching, and ghost file cleanup.

## How it works
- **Startup Scan:** On launch, the script sweeps for any existing conflicts or stray Syncthing temp files (`.tmp`) left over from previous failed syncs.
- **Watch:** Uses `chokidar` to monitor specific subfolders for new conflict files in real-time.
- **Identify:** Locates the correct "ancestor" version inside the `.stversions` directory by calculating relative paths from the sync root.
- **Merge:** Executes a `git merge-file` to combine changes. 
- **Clean:** After a successful merge, it deletes the conflict file and any associated Syncthing temp ghosts immediately to keep your folders clean.
- **Log:** Writes a detailed summary of every merge to a Markdown file of your choice.

## Merge Handling
- **Smart Merge (Recommended):** By default (`USE_UNION_MERGE=false`), the script uses Git's intelligent 3-way merge. It weaves changes together. If a conflict is too complex (editing the exact same line), it inserts standard `<<<<<<<` markers so you can resolve it in your editor without data loss.
- **Union Merge:** If enabled, the script will never insert markers and instead keep both versions of a conflicting line (non-destructive but can cause line duplication).
- **Extension Filtering:** Safely ignores binary files (images, PDFs, databases) to prevent corruption. Only handles text-based formats like `.md`, `.txt`, `.json`, etc.
- **Safety First:** The script only modifies the "current" file and reads from `.stversions`. It never modifies your version history.

## Configuration

Example docker-compose.yml:
```docker-compose.yml
services:
  syncthing-resolver:
    container_name: syncthing-resolver
    image: ghcr.io/gjessing1/syncthing-resolver:latest
    restart: unless-stopped
    user: "${PUID}:${PGID}"
    env_file:
      - .env
    volumes:
      # Map your Syncthing Root to /data
      - ${HOST_SYNCTHING_ROOT}:/data:rw
```

Configuration .env file:
```
# === HOST CONFIG ===
# Absolute path to the ROOT Syncthing folder (must contain .stversions)
HOST_SYNCTHING_ROOT=/home/user/Syncthing/Notes

# === CONTAINER PATHS (Must start with /data) ===
SYNC_ROOT=/data
WATCH_PATH=/data/Work/ProjectA
# Relative to /data. Leave empty to disable logging.
MERGE_LOG_PATH=/data/Logs/sync-merge-log.md

# === APP SETTINGS ===
# false: Smart Merge (Markers on direct conflicts) - Best for Obsidian
# true: Union Merge (Keep both lines, no markers)
USE_UNION_MERGE=false

ALLOWED_EXTENSIONS=md,txt,json,yaml,yml,org,canvas,taskpaper
SETTLE_DELAY=3000
DRY_RUN=false
VERBOSE=false
BACKUP_BEFORE_MERGE=false

# Permissions
PUID=1000
PGID=1000
```
## Performance & Footprint
- **Memory:** Extremely lightweight, typically using ~10MB to 15MB of RAM.
- **CPU:** Near-zero idle usage; only wakes up when a file change is detected.
- **Privacy:** Operates entirely locally within your Docker environment.
