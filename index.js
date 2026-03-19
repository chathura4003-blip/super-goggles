const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (reason) => {
    console.error('[Bot] Unhandled promise rejection (ignored to prevent crash):', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
    console.error('[Bot] Uncaught exception (ignored to prevent crash):', err?.message || err);
});

const { startBot } = require('./bot');
const { startDashboard, io } = require('./dashboard');
const { logger } = require('./logger');
const { SESSION_DIR, DOWNLOAD_DIR } = require('./config');
const sessionMgr = require('./session-manager');

// Ensure required directories exist before starting
[SESSION_DIR, DOWNLOAD_DIR].forEach(dir => {
    const fullPath = path.resolve(dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        logger(`Created directory: ${fullPath}`);
    }
});

async function main() {
    try {
        logger('Initializing Super Bot System...');
        startDashboard();

        // Give dashboard a tick to start, then wire session manager to socket.io
        await new Promise(r => setTimeout(r, 200));
        sessionMgr.setIO(io);

        // Start main bot session
        await startBot();

        // Auto-restore any saved multi-sessions
        await sessionMgr.autoRestore();

    } catch (e) {
        console.error('Core Error:', e);
        logger(`CRITICAL ERROR: ${e.message}`);
    }
}

main();
