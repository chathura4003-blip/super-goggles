'use strict';
/**
 * Multi-Session Manager
 * Each session lives in sessions/<id>/ with its own Baileys socket.
 * The main bot.js session (session/) is separate and untouched.
 */

const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// session registry: id → { sock, status, qr, pairCode, number, startedAt, phoneNumber }
const registry = new Map();
let _io = null;

function setIO(io) { _io = io; }

function emit(event, data) {
    if (_io) _io.emit(event, data);
}

function sessionDir(id) {
    return path.join(SESSIONS_DIR, id);
}

function listSessionIds() {
    try {
        return fs.readdirSync(SESSIONS_DIR).filter(f => {
            return fs.statSync(path.join(SESSIONS_DIR, f)).isDirectory();
        });
    } catch { return []; }
}

function getAll() {
    return Array.from(registry.entries()).map(([id, s]) => ({
        id,
        number: s.number || null,
        status: s.status,
        startedAt: s.startedAt,
        qrAvailable: !!s.qr && s.status !== 'Connected',
        pairCode: s.pairCode || null,
    }));
}

function get(id) { return registry.get(id) || null; }

// ── Create / start a session ───────────────────────────────────────────────
async function createSession(id) {
    if (registry.has(id)) {
        const existing = registry.get(id);
        if (existing.status === 'Connected') return { error: 'Session already connected' };
        // Destroy old socket
        await destroySocket(id);
    }

    const dir = sessionDir(id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const entry = {
        sock: null,
        status: 'Initializing',
        qr: null,
        qrDataUrl: null,
        pairCode: null,
        number: null,
        startedAt: new Date().toISOString(),
        phoneNumber: null,
        reconnectTimer: null,
    };
    registry.set(id, entry);
    emit('session:update', { id, status: 'Initializing' });

    await startSocket(id, entry);
    return { ok: true, id };
}

async function startSocket(id, entry) {
    try {
        const dir = sessionDir(id);
        const { state, saveCreds } = await useMultiFileAuthState(dir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            browser: ['SupremeBot-Session', 'Chrome', '131.0'],
            syncFullHistory: false,
            markOnlineOnConnect: false,
            printQRInTerminal: false,
        });

        entry.sock = sock;
        entry.status = 'Connecting';
        emit('session:update', { id, status: 'Connecting' });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    entry.qr = qr;
                    const dataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
                    entry.qrDataUrl = dataUrl;
                    entry.status = 'Awaiting QR Scan';
                    emit('session:qr', { id, qr: dataUrl });
                    emit('session:update', { id, status: 'Awaiting QR Scan', qr: dataUrl });
                    logger(`[Session ${id}] QR generated`);
                } catch (e) { logger(`[Session ${id}] QR error: ${e.message}`); }
            }

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                const loggedOut  = code === DisconnectReason.loggedOut || code === 401;
                const replaced   = code === 440;  // Session replaced by another client

                entry.qr = null;
                entry.qrDataUrl = null;
                entry.pairCode = null;

                if (loggedOut) {
                    entry.status = 'Logged Out';
                    emit('session:update', { id, status: entry.status });
                    logger(`[Session ${id}] Logged out — removing session.`);
                    registry.delete(id);
                    try { fs.rmSync(sessionDir(id), { recursive: true }); } catch {}
                    emit('session:removed', { id });
                } else if (replaced) {
                    entry.status = 'Session Replaced';
                    emit('session:update', { id, status: entry.status });
                    logger(`[Session ${id}] Session replaced (440) — not reconnecting to avoid conflict.`);
                    // Do NOT reconnect — another client owns this session
                } else {
                    entry.status = 'Disconnected';
                    emit('session:update', { id, status: entry.status });
                    logger(`[Session ${id}] Closed (code ${code}) — reconnecting in 8s...`);
                    entry.reconnectTimer = setTimeout(() => {
                        if (registry.has(id)) {
                            logger(`[Session ${id}] Auto-reconnecting...`);
                            startSocket(id, registry.get(id)).catch(e => logger(`[Session ${id}] Reconnect error: ${e.message}`));
                        }
                    }, 8000);
                }
            }

            if (connection === 'open') {
                const num = sock.user?.id?.split(':')[0] || sock.user?.id || 'Unknown';
                entry.number = num;
                entry.status = 'Connected';
                entry.qr = null;
                entry.qrDataUrl = null;
                entry.pairCode = null;
                emit('session:update', { id, status: 'Connected', number: num });
                logger(`[Session ${id}] Connected as ${num}`);
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            let handleMessages;
            try { handleMessages = require('./bot').handleMessages; } catch(e) {}
            if (handleMessages) await handleMessages(sock, m);
        });

    } catch (e) {
        logger(`[Session ${id}] Socket error: ${e.message}`);
        const entry = registry.get(id);
        if (entry) {
            entry.status = 'Error';
            emit('session:update', { id, status: 'Error', error: e.message });
        }
    }
}

// ── Request pair code ──────────────────────────────────────────────────────
async function requestPairCode(id, phoneNumber) {
    const entry = registry.get(id);
    if (!entry) return { error: 'Session not found' };
    if (entry.status === 'Connected') return { error: 'Already connected' };
    if (!entry.sock) return { error: 'Socket not ready yet — wait a moment and retry' };

    const cleaned = phoneNumber.replace(/[^0-9]/g, '');
    if (!cleaned || cleaned.length < 7) return { error: 'Invalid phone number' };

    try {
        const code = await entry.sock.requestPairingCode(cleaned);
        entry.pairCode = code;
        entry.phoneNumber = cleaned;
        emit('session:update', { id, pairCode: code, status: entry.status });
        logger(`[Session ${id}] Pair code requested for ${cleaned}: ${code}`);
        return { ok: true, code };
    } catch (e) {
        return { error: e.message };
    }
}

// ── Remove / logout session ────────────────────────────────────────────────
async function destroySocket(id) {
    const entry = registry.get(id);
    if (!entry) return;
    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    if (entry.sock) {
        try { await entry.sock.logout(); } catch {}
        try { entry.sock.end(undefined); } catch {}
    }
}

async function removeSession(id) {
    await destroySocket(id);
    registry.delete(id);
    try { fs.rmSync(sessionDir(id), { recursive: true }); } catch {}
    emit('session:removed', { id });
    logger(`[Session ${id}] Removed`);
    return { ok: true };
}

// ── Auto-restore sessions on startup ──────────────────────────────────────
async function autoRestore() {
    const ids = listSessionIds();
    logger(`Session Manager: restoring ${ids.length} session(s)...`);
    for (const id of ids) {
        const entry = {
            sock: null,
            status: 'Restoring',
            qr: null,
            qrDataUrl: null,
            pairCode: null,
            number: null,
            startedAt: new Date().toISOString(),
            phoneNumber: null,
            reconnectTimer: null,
        };
        registry.set(id, entry);
        await startSocket(id, entry).catch(e => logger(`[Session ${id}] Restore error: ${e.message}`));
        await new Promise(r => setTimeout(r, 500)); // stagger startup
    }
}

module.exports = {
    setIO,
    createSession,
    removeSession,
    requestPairCode,
    getAll,
    get,
    autoRestore,
    SESSIONS_DIR,
};
