/**
 * Syncthing 3-Way Merge Deconflicter (Node.js)
 * 
 * Automatically resolves Syncthing conflicts by performing a git three-way merge.
 * Prevents nested markers and handles locked temporary files.
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
    settleDelayMs: parseInt(process.env.SETTLE_DELAY) || 2500, // User set to 2500
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
 * Fast-tracks Syncthing temporary files while ignoring standard hidden folders.
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
            if ((file.startsWith('.') && file !== CONFIG.versionsDirName) || file === 'node_modules') {
                return;
            }
            getFilesRecursive(fullPath, arrayOfFiles);
        } else {
            const isSyncthingTemp = /^[.~]syncthing~.*\.tmp$/i.test(file);
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
        log('WARN', `Failed to write merge log: ${err.message}`);
    }
}

function formatMergeLogEntry(originalFile, conflictFile, baseFile, status, error = null) {
    return `## ${new Date().toISOString()}\n` +
        `- **Status:** ${status}\n` +
        `- **File:** \`${originalFile}\`\n` +
        `- **Conflict:** \`${conflictFile}\`\n` +
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
 * Cleans up temp files with an additional delay to ensure Syncthing releases locks.
 */
async function cleanupSyncthingTemp(filePath) {
    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const variations = [`~syncthing~${fileName}.tmp`, `.syncthing.${fileName}.tmp`];
    
    // Tiny extra grace period for the OS to release the file handle
    await new Promise(r => setTimeout(r, 500));

    variations.forEach(tempName => {
        const tempPath = path.join(dir, tempName);
        if (fs.existsSync(tempPath)) {
            try {
                if (!CONFIG.dryRun) fs.unlinkSync(tempPath);
                log('CLEAN', `Removed temp file: ${tempName}`);
            } catch (err) {
                log('WARN', `Could not remove "${tempName}" (likely still locked by Syncthing).`);
            }
        }
    });
}

function cleanupPreviousGhosts() {
    log('GHOST', `Scanning for leftover conflict temp files...`);
    const allFiles = getFilesRecursive(path.resolve(CONFIG.watchPath));
    const ghostRegex = /^[.~]syncthing~.*sync-conflict.*\.tmp$/i;
    const ghosts = allFiles.filter(f => ghostRegex.test(path.basename(f)));
    
    ghosts.forEach(ghost => {
        try {
            if (!CONFIG.dryRun) fs.unlinkSync(ghost);
            log('GHOST', `Removed: ${path.basename(ghost)}`);
        } catch (err) {
            log('WARN', `Failed to remove ghost ${path.basename(ghost)}`);
        }
    });
}

function mergeFiles(original, base, conflict) {
    const flags = CONFIG.useUnionMerge ? ['--union'] : [];
    const args = ['merge-file', ...flags, original, base, conflict];
    
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
    const conflictRegex = /^(.*?)(?:\.|%2F)sync-conflict-([0-9]{8})-([0-9]{6})-([A-Z0-9]{7})\.?(.*)$/i;
    const match = fileName.match(conflictRegex);

    if (!match || fileName.endsWith('.tmp')) return;

    const [_, baseName, date, time, id, extension] = match;
    if (!CONFIG.allowedExtensions.includes((extension || '').toLowerCase())) return;

    processingFiles.add(absConflictPath);
    const absRoot = path.resolve(CONFIG.syncRootPath);
    
    try {
        // Wait for Syncthing to finish writing the conflict file
        await new Promise(r => setTimeout(r, CONFIG.settleDelayMs));
        if (!fs.existsSync(absConflictPath)) return;

        const originalFileName = extension ? `${baseName}.${extension}` : baseName;
        const originalFilePath = path.join(path.dirname(absConflictPath), originalFileName);

        if (!fs.existsSync(originalFilePath)) {
            log('SKIP', `Original file not found for ${fileName}`);
            return;
        }

        // --- ANTI-NESTING GUARD ---
        // If "ours" already has conflict markers, merging into it creates nested junk.
        const originalContent = fs.readFileSync(originalFilePath, 'utf8');
        if (originalContent.includes('<<<<<<<') && !CONFIG.useUnionMerge) {
            log('WARN', `Skipping: "${originalFileName}" already contains markers. Resolve them manually first.`);
            return;
        }

        const relativeOriginal = path.relative(absRoot, originalFilePath);
        const versionsFolder = path.join(absRoot, CONFIG.versionsDirName, path.dirname(relativeOriginal));

        if (!fs.existsSync(versionsFolder)) {
            log('SKIP', `No .stversions folder for ${relativeOriginal}`);
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
            log('SKIP', `No historical versions for ${relativeOriginal}`);
            return;
        }

        const latestBackup = backupCandidates[0];
        
        if (CONFIG.backupBeforeMerge && !CONFIG.dryRun) {
            fs.copyFileSync(originalFilePath, `${originalFilePath}.${new Date().getTime()}.bak`);
        }

        const mergeExitCode = mergeFiles(originalFilePath, latestBackup, absConflictPath);
        
        if (!CONFIG.dryRun) {
            // Clean up the conflict file
            fs.unlinkSync(absConflictPath);
            // Specifically clean up associated .tmp files
            await cleanupSyncthingTemp(absConflictPath);
        }
        
        const status = mergeExitCode === 0 ? 'Clean Merge' : `Conflicts Marked (${mergeExitCode})`;
        log('SUCCESS', `Resolved: ${relativeOriginal} (${status})`);
        
        appendMergeLog(formatMergeLogEntry(relativeOriginal, fileName, path.basename(latestBackup), status));
        
    } catch (err) {
        log('ERROR', `Failed ${fileName}: ${err.message}`);
    } finally {
        processingFiles.delete(absConflictPath);
    }
}

async function startupScan() {
    log('SCAN', `Scanning ${CONFIG.watchPath}...`);
    const allFiles = getFilesRecursive(path.resolve(CONFIG.watchPath));
    const conflictRegex = /sync-conflict-[0-9]{8}-[0-9]{6}-[A-Z0-9]{7}/i;
    
    const conflicts = allFiles.filter(f => {
        const base = path.basename(f);
        return conflictRegex.test(base) && !base.endsWith('.tmp');
    });
    
    for (const c of conflicts) await handleFileEvent(c, true);
    log('SCAN', 'Startup scan complete.');
}

// --- STARTUP ---

verifyGitAvailable();
cleanupPreviousGhosts();

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

    log('INFO', `Watcher active. (Settle delay: ${CONFIG.settleDelayMs}ms)`);

    process.on('SIGINT', () => watcher.close().then(() => process.exit(0)));
});
