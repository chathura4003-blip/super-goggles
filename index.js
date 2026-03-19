const fs = require('fs');
const path = require('path');

// Suppress noisy crypto errors from the libsignal library (non-fatal, Baileys handles them internally)
const _origConsoleError = console.error.bind(console);
console.error = (...args) => {
    const msg = (args[0] ?? '').toString();
    if (
        msg.includes('Bad MAC') ||
        msg.includes('MessageCounterError') ||
        msg.includes('Failed to decrypt') ||
        msg.includes('Session error') ||
        msg.includes('Key used already')
    ) return;
    _origConsoleError(...args);
};

process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || String(reason);
    if (msg.includes('Bad MAC') || msg.includes('MessageCounterError')) return;
    console.error('[Bot] Unhandled promise rejection (ignored to prevent crash):', msg);
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

        // Wire session manager to socket.io immediately
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
