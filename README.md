# Syncthing-resolver
**An automated 3-way merge daemon for Syncthing conflicts.**

This tool monitors your Syncthing folders and automatically resolves "sync-conflict" files by performing a git three-way merge between the current file, the conflicted version, and the common ancestor found in `.stversions`.

Based on the public python gist by [solarkraft](https://gist.github.com/solarkraft/26fe291a3de075ae8d96e1ada928fb7d). Adapted to Node.js with added support for Docker, environment-based configuration, selective path watching, and ghost file cleanup.

<p>
  <img src="https://img.shields.io/github/v/release/gjessing1/syncthing-resolver" alt="Latest release">
  <img src="https://img.shields.io/github/stars/gjessing1/syncthing-resolver?style=social" alt="GitHub stars">
  <a href="https://buymeacoffee.com/gjessing">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" width="80" style="vertical-align: middle;">
  </a>
</p>

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

ALLOWED_EXTENSIONS=md,txt,js,py,html,css,yaml,ini,conf,sh
SETTLE_DELAY=3000
DRY_RUN=false
VERBOSE=false
BACKUP_BEFORE_MERGE=false

# Permissions
PUID=1000
PGID=1000
```

Reccomended syncthing ignore pattern if used with Obsidian:
```
#  UI & Meta (Prevents Layout Conflicts)
(?d).obsidian/workspace
(?d).obsidian/workspace.json
(?d).obsidian/workspace-mobile.json
(?d).obsidian/cache
(?d).obsidian/community-plugins.json

# System junk
(?d).DS_Store
(?d)Thumbs.db
(?d)~syncthing~*
(?d).syncthing.*
(?d)desktop.ini

# Sync history (Keeps history local to each device)
.stversions
```
## Performance & Footprint
- **Memory:** Extremely lightweight, typically using ~15MB to 20MB of RAM.
- **CPU:** Near-zero idle usage; only wakes up when a file change is detected.
- **Privacy:** Operates entirely locally within your Docker environment.

## Tested and approved by my active syncthing instance
- Actively used and tested against my own Syncthing instance, it has successfully resolved conflicts in all my test scenarios.
- While no guarantees can be made, it has been exercised extensively in day-to-day use.
- Found a bug or have an idea for an improvement? Open an issue in the repository and I’ll take a look.

- ## Like the project?
Please consider buying me a coffe, I really do drink it alot!
<p>
  <a href="https://buymeacoffee.com/gjessing">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" width="80" style="vertical-align: middle;">
  </a>
</p>
