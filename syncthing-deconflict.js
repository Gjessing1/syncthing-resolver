/**
 * Syncthing 3-Way Merge Deconflicter (Node.js)
 * 
 * Automatically resolves Syncthing conflicts via git three-way merge.
 * Features: Anti-nesting, Device ID detection, and cross-platform temp cleanup.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const chokidar = require('chokidar');

// --- CONFIGURATION ---
const CONFIG = {
    watchPath: process.env.WATCH_PATH || './Notes/Work',
    syncRootPath: process.env.SYNC_ROOT || './',
    versionsDirName: process.env.VERSIONS_DIR || '.stversions',
    gitBinary: process.env.GIT_BIN || 'git',
    settleDelayMs: parseInt(process.env.SETTLE_DELAY) || 2500,
    dryRun: process.env.DRY_RUN === 'true',
    
    useUnionMerge: process.env.USE_UNION_MERGE === 'true', 

    allowedExtensions: (process.env.ALLOWED_EXTENSIONS || 'md,txt,json,yaml,yml,org,canvas,taskpaper')
        .split(',')
        .map(e => e.trim().toLowerCase()),
    
    verbose: process.env.VERBOSE === 'true',
    backupBeforeMerge: process.env.BACKUP_BEFORE_MERGE !== 'false',
    mergeLogPath: process.env.MERGE_LOG_PATH || '',
};

const processingFiles = new Set();

// --- UTILS ---

function log(level, message) {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} [${level}] ${message}`);
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * UNIFIED FILE WALKER
 * Identifies Syncthing temp files using a broad pattern to ensure no ghosts are missed.
 */
function getFilesRecursive(dirPath, arrayOfFiles = []) {
    if (!fs.existsSync(dirPath)) return [];
    
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        let stat;
        try {
            stat = fs.statSync(fullPath);
        } catch (err) { return; }

        if (stat.isDirectory()) {
            // Standard directory ignore, but allow .stversions
            if ((file.startsWith('.') && file !== CONFIG.versionsDirName) || file === 'node_modules') {
                return;
            }
            getFilesRecursive(fullPath, arrayOfFiles);
        } else {
            // Robust pattern: Matches .syncthing. and ~syncthing~ and variations
            const isSyncthingTemp = /[.~]syncthing[.~].*\.tmp$/i.test(file);
            const isHidden = file.startsWith('.') || file.startsWith('~');

            if (!isHidden || isSyncthingTemp) {
                arrayOfFiles.push(fullPath);
            }
        }
    });

    return arrayOfFiles;
}

function appendMergeLog(entry) {
    if (!CONFIG.mergeLogPath) return;
    try {
        const logPath = path.resolve(CONFIG.mergeLogPath);
        const dir = path.dirname(logPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, '# Syncthing Merge Log\n\n---\n\n');
        }
        fs.appendFileSync(logPath, entry);
    } catch (err) {
        log('WARN', `Merge log failed: ${err.message}`);
    }
}

function formatMergeLogEntry(originalFile, conflictFile, baseFile, status, deviceId, error = null) {
    const deviceStr = deviceId ? ` (Device: ${deviceId})` : '';
    return `## ${new Date().toISOString()}\n` +
        `- **Status:** ${status}\n` +
        `- **File:** \`${originalFile}\`\n` +
        `- **Conflict:** \`${conflictFile}\`${deviceStr}\n` +
        `- **Base:** \`${baseFile}\`\n` +
        (error ? `- **Error:** ${error}\n` : '') +
        `\n---\n\n`;
}

// --- CORE LOGIC ---

function verifyGitAvailable() {
    const result = spawnSync(CONFIG.gitBinary, ['--version'], { encoding: 'utf8' });
    if (result.error) throw new Error(`Git not found: ${result.error.message}`);
}

/**
 * Cleans up temp files with logic to handle Windows (~syncthing~) and Linux (.syncthing.)
 */
async function cleanupSyncthingTemp(filePath) {
    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    
    // We check for the specific temp patterns of the conflict file just processed
    const variations = [
        `~syncthing~${fileName}.tmp`, 
        `.syncthing.${fileName}.tmp`
    ];
    
    await new Promise(r => setTimeout(r, 500));

    variations.forEach(tempName => {
        const tempPath = path.join(dir, tempName);
        if (fs.existsSync(tempPath)) {
            try {
                if (!CONFIG.dryRun) fs.unlinkSync(tempPath);
                log('CLEAN', `Removed: ${tempName}`);
            } catch (err) {
                log('WARN', `Locked: ${tempName} (Syncthing still busy)`);
            }
        }
    });
}

/**
 * Robust Startup Ghost Removal
 * Matches any syncthing temp files left behind.
 */
function cleanupPreviousGhosts() {
    log('GHOST', `Searching for ghost temp files...`);
    const allFiles = getFilesRecursive(path.resolve(CONFIG.watchPath));
    
    // Broad regex for all syncthing temps
    const ghostRegex = /[.~]syncthing[.~].*\.tmp$/i;
    const ghosts = allFiles.filter(f => ghostRegex.test(path.basename(f)));
    
    if (ghosts.length === 0) {
        log('GHOST', 'No ghost files found.');
        return;
    }

    ghosts.forEach(ghost => {
        try {
            if (!CONFIG.dryRun) fs.unlinkSync(ghost);
            log('GHOST', `Purged: ${path.basename(ghost)}`);
        } catch (err) {
            log('WARN', `Could not purge: ${path.basename(ghost)}`);
        }
    });
}

/**
 * Executes git merge with custom labels to identify the conflicting device.
 */
function mergeFiles(original, base, conflict, deviceId) {
    const flags = CONFIG.useUnionMerge ? ['--union'] : [];
    
    // Add custom labels for the merge markers
    const labels = [
        '-L', 'Our Local Version',
        '-L', 'Base (Historical)',
        '-L', `Remote Change (Device: ${deviceId || 'Unknown'})`
    ];

    const args = ['merge-file', ...flags, ...labels, original, base, conflict];
    
    log('MERGE', `${CONFIG.gitBinary} ${args.join(' ')}`);
    if (CONFIG.dryRun) return -1;

    const result = spawnSync(CONFIG.gitBinary, args, { stdio: 'pipe', encoding: 'utf8' });
    if (result.error) throw new Error(`Git failed: ${result.error.message}`);
    return result.status || 0;
}

async function handleFileEvent(filePath, isStartupScan = false) {
    const absConflictPath = path.resolve(filePath);
    if (processingFiles.has(absConflictPath)) return;
    
    try {
        if (!fs.lstatSync(absConflictPath).isFile()) return;
    } catch (err) { return; }

    const fileName = path.basename(absConflictPath);
    // Group 4 extracts the 7-character Device ID
    const conflictRegex = /^(.*?)(?:\.|%2F)sync-conflict-([0-9]{8})-([0-9]{6})-([A-Z0-9]{7})\.?(.*)$/i;
    const match = fileName.match(conflictRegex);

    if (!match || fileName.endsWith('.tmp')) return;

    const [_, baseName, date, time, deviceId, extension] = match;
    if (!CONFIG.allowedExtensions.includes((extension || '').toLowerCase())) return;

    processingFiles.add(absConflictPath);
    const absRoot = path.resolve(CONFIG.syncRootPath);
    
    try {
        await new Promise(r => setTimeout(r, CONFIG.settleDelayMs));
        if (!fs.existsSync(absConflictPath)) return;

        const originalFileName = extension ? `${baseName}.${extension}` : baseName;
        const originalFilePath = path.join(path.dirname(absConflictPath), originalFileName);

        if (!fs.existsSync(originalFilePath)) {
            log('SKIP', `Original file not found for ${fileName}`);
            return;
        }

        // --- ANTI-NESTING GUARD ---
        const originalContent = fs.readFileSync(originalFilePath, 'utf8');
        if (originalContent.includes('<<<<<<<') && !CONFIG.useUnionMerge) {
            log('WARN', `Skipping: "${originalFileName}" already has markers. Resolve manually.`);
            return;
        }

        const relativeOriginal = path.relative(absRoot, originalFilePath);
        const versionsFolder = path.join(absRoot, CONFIG.versionsDirName, path.dirname(relativeOriginal));

        if (!fs.existsSync(versionsFolder)) {
            log('SKIP', `No .stversions for ${relativeOriginal}`);
            return;
        }

        const escapedBase = escapeRegex(baseName);
        const escapedExt = escapeRegex(extension);
        const backupRegex = extension
            ? new RegExp(`^${escapedBase}~([0-9]{8})-([0-9]{6})\\.${escapedExt}$`)
            : new RegExp(`^${escapedBase}~([0-9]{8})-([0-9]{6})$`);

        const backupCandidates = getFilesRecursive(versionsFolder)
            .filter(f => backupRegex.test(path.basename(f)))
            .sort().reverse();

        if (backupCandidates.length === 0) {
            log('SKIP', `No versions for ${relativeOriginal}`);
            return;
        }

        const latestBackup = backupCandidates[0];
        
        if (CONFIG.backupBeforeMerge && !CONFIG.dryRun) {
            fs.copyFileSync(originalFilePath, `${originalFilePath}.${new Date().getTime()}.bak`);
        }

        const mergeExitCode = mergeFiles(originalFilePath, latestBackup, absConflictPath, deviceId);
        
        if (!CONFIG.dryRun) {
            fs.unlinkSync(absConflictPath);
            await cleanupSyncthingTemp(absConflictPath);
        }
        
        const status = mergeExitCode === 0 ? 'Clean Merge' : `Conflicts Marked (${mergeExitCode})`;
        log('SUCCESS', `Resolved: ${relativeOriginal} (${status})`);
        
        appendMergeLog(formatMergeLogEntry(
            relativeOriginal, 
            fileName, 
            path.basename(latestBackup), 
            status, 
            deviceId
        ));
        
    } catch (err) {
        log('ERROR', `Failed ${fileName}: ${err.message}`);
    } finally {
        processingFiles.delete(absConflictPath);
    }
}

async function startupScan() {
    log('SCAN', `Scanning for existing conflicts...`);
    const allFiles = getFilesRecursive(path.resolve(CONFIG.watchPath));
    const conflictRegex = /sync-conflict-[0-9]{8}-[0-9]{6}-[A-Z0-9]{7}/i;
    
    const conflicts = allFiles.filter(f => {
        const base = path.basename(f);
        return conflictRegex.test(base) && !base.endsWith('.tmp');
    });
    
    for (const c of conflicts) await handleFileEvent(c, true);
}

// --- STARTUP ---

verifyGitAvailable();
cleanupPreviousGhosts(); // Step 1: Broad cleanup of all syncthing temps

startupScan().then(() => {
    const watcher = chokidar.watch(CONFIG.watchPath, {
        ignored: /(^|[\/\\])\.|node_modules/,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
    });

    watcher
        .on('add', f => handleFileEvent(f))
        .on('change', f => handleFileEvent(f))
        .on('error', e => log('ERROR', `Watcher: ${e}`));

    log('INFO', `Watcher active. (Delay: ${CONFIG.settleDelayMs}ms)`);

    process.on('SIGINT', () => watcher.close().then(() => process.exit(0)));
});
