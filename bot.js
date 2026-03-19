'use strict';

const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { logger } = require('./logger');
const { loadCommands, handleCommand } = require('./lib/handler');
const { BROWSER, SESSION_DIR, AUTO_READ, AUTO_TYPING, PREFIX } = require('./config');
const appState = require('./state');
const db = require('./lib/db');

const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'pussy', 'whore', 'nigger'];

const messageStore = [];
function cacheMsg(msg) {
    messageStore.push(msg);
    if (messageStore.length > 200) messageStore.shift();
}
function getCachedMsg(jid, id) {
    return messageStore.find(m => m.key.remoteJid === jid && m.key.id === id);
}

function getIO() {
    try { return require('./dashboard').io; } catch { return null; }
}

async function startBot() {
    loadCommands();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    logger(`Starting Supreme Bot (Baileys v${version.join('.')})`);
    appState.setStatus('Connecting');
    const io = getIO();
    if (io) io.emit('update', { status: 'Connecting' });

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        browser: BROWSER,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        getMessage: async (key) => {
            const msg = getCachedMsg(key.remoteJid, key.id);
            return msg?.message || undefined;
        }
    });

    appState.setSocket(sock);

    // ── Auto-delete all outgoing bot messages after 10 seconds ───────────────
    const AUTO_DELETE_MS = 10 * 1000;
    const _origSend = sock.sendMessage.bind(sock);
    sock.sendMessage = async (jid, content, options) => {
        const sent = await _origSend(jid, content, options);
        // Skip: deletions, reactions, edits, read-receipts (no key to delete)
        const isDelete = content?.delete;
        const isReact  = content?.react;
        const isEdit   = content?.edit;
        if (!isDelete && !isReact && !isEdit && sent?.key) {
            setTimeout(async () => {
                try { await _origSend(jid, { delete: sent.key }); } catch {}
            }, AUTO_DELETE_MS);
        }
        return sent;
    };
    // Keep the shared state socket updated to our wrapped version
    appState.setSocket(sock);

    sock.ev.on('connection.update', async (update) => {
        try {
            const { connection, lastDisconnect, qr } = update;
            const io = getIO();

            if (qr) {
                try {
                    const qrDataUrl = await QRCode.toDataURL(qr);
                    if (io) io.emit('qr', qrDataUrl);

                    // Clear the terminal and render a scannable QR code (works better on narrow terminals)
                    try { process.stdout.write('\x1Bc'); } catch {}
                    try {
                        const qrStr = await QRCode.toString(qr, { type: 'terminal', small: true });
                        console.log(qrStr);
                    } catch {
                        qrcodeTerminal.generate(qr, { small: true });
                    }
                    console.log('📱 Scan this QR with WhatsApp (or use the web dashboard).');

                    logger('[Main Bot] QR code generated. Scan with WhatsApp ^^^');
                } catch (err) { logger(`QR Error: ${err.message}`); }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.message || 'Unknown';

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    logger(`❌ [Main Bot] Logged Out (401). Please delete "${SESSION_DIR}" and re-scan.`);
                    appState.setStatus('Logged Out');
                } else if (statusCode === 440) {
                    logger('⚠️ [Main Bot] Session Replaced (440). Another instance may be running.');
                    appState.setStatus('Session Replaced');
                } else {
                    logger(`[Main Bot] Connection closed (${statusCode}): ${reason}. Reconnecting...`);
                    appState.setStatus('Disconnected');
                }

                appState.setSocket(null);
                appState.setNumber(null);
                if (io) io.emit('update', { status: 'Reconnecting...' });

                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) setTimeout(() => startBot(), 1500);
            } else if (connection === 'open') {
                logger('✅ [Main Bot] Connected!');
                appState.setStatus('Connected');
                appState.setConnectedAt(new Date().toISOString());
                const num = sock.user?.id?.split(':')[0] || sock.user?.id || 'Unknown';
                appState.setNumber(num);
                if (io) io.emit('update', { status: 'Connected', number: num });
            }
        } catch (e) {
            logger(`Connection Update Error: ${e.message}`);
        }
    });

    sock.ev.on('error', (err) => {
        logger(`Socket Error: ${err.message}`);
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        await handleMessages(sock, m);
    });

    return sock;
}

async function handleMessages(sock, m) {
    if (m.type !== 'notify') return;

    if (appState.isRestartRequested()) {
        appState.clearRestart();
        logger('Admin restart requested — reconnecting...');
        try { await sock.logout(); } catch {}
        setTimeout(() => startBot(), 1500);
        return;
    }

    const bannedList = db.get('settings', 'banned') || {};

    const tasks = m.messages.map(async (msg) => {
        if (!msg.message) return;
        const from = msg.key.remoteJid;

        if (from === 'status@broadcast') {
            if (AUTO_READ) sock.readMessages([msg.key]).catch(() => {});
            return;
        }

        const text = msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption || '';

        if (msg.key.fromMe && !text.startsWith(PREFIX)) return;

        const sender = msg.key.participant || msg.key.remoteJid;

        if (bannedList[sender]) return;

        cacheMsg(msg);

        if (from.endsWith('@g.us') && text) {
            const groupSettings = db.get('groups', from);

            if (groupSettings.antilink && /(https?:\/\/|chat\.whatsapp\.com)/i.test(text)) {
                try {
                    const meta = await sock.groupMetadata(from);
                    const isAdmin = meta.participants.find(p => p.id === sender)?.admin;
                    if (!isAdmin) {
                        await sock.sendMessage(from, { delete: msg.key });
                        sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                        return;
                    }
                } catch {}
            }

            if (groupSettings.antibad && BAD_WORDS.some(w => text.toLowerCase().includes(w))) {
                try {
                    const meta = await sock.groupMetadata(from);
                    const isAdmin = meta.participants.find(p => p.id === sender)?.admin;
                    if (!isAdmin) {
                        await sock.sendMessage(from, { delete: msg.key });
                        sock.sendMessage(from, {
                            text: `⚠️ @${sender.split('@')[0]}, watch your language! This group does not allow bad words.`,
                            mentions: [sender]
                        }).catch(() => {});
                        return;
                    }
                } catch {}
            }
        }

        if (AUTO_READ && text.startsWith(PREFIX)) sock.readMessages([msg.key]).catch(() => {});
        if (AUTO_TYPING && text.startsWith(PREFIX)) sock.sendPresenceUpdate('composing', from).catch(() => {});

        let isCommand = await handleCommand(sock, msg, from, text);
        if (!isCommand) {
            const { processMessage } = require('./commands');
            isCommand = await processMessage(sock, msg, from, text);
        }

        if (!isCommand && !msg.key.fromMe) {
            const lower = text.toLowerCase().trim();
            if (lower === 'hi' || lower === 'hello' || lower === 'hey') {
                sock.sendMessage(from, {
                    text: `Hello! 👋 Welcome, Master!\n\nType *${PREFIX}menu* to see all my features or *${PREFIX}help* for a quick guide. 🚀`
                }).catch(() => {});
            }
        }
    });

    await Promise.allSettled(tasks);
}

module.exports = { startBot, handleMessages };
