'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const jwt = require('jsonwebtoken');
const { PORT, ADMIN_USER, ADMIN_PASS, JWT_SECRET, DOWNLOAD_DIR } = require('./config');
const appState = require('./state');
const { setIO } = require('./logger');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ── Network speed tracker (reads /proc/net/dev) ─────────────────────────────
let _netLast = null;

function readNetStats() {
    try {
        const raw = fs.readFileSync('/proc/net/dev', 'utf8');
        let rxTotal = BigInt(0), txTotal = BigInt(0);
        for (const line of raw.split('\n').slice(2)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 10) continue;
            const iface = parts[0].replace(':', '');
            if (iface === 'lo') continue; // skip loopback
            rxTotal += BigInt(parts[1]);
            txTotal += BigInt(parts[9]);
        }
        return { rx: rxTotal, tx: txTotal, ts: Date.now() };
    } catch { return null; }
}

function fmtSpeed(kbs) {
    if (kbs >= 1024) return (kbs / 1024).toFixed(2) + ' MB/s';
    return kbs.toFixed(1) + ' KB/s';
}

// Rolling 3-second speed sample — keeps readings fresh between API polls
let _netSpeed = { downloadKBs: 0, uploadKBs: 0 };
_netLast = readNetStats();
setInterval(() => {
    const cur = readNetStats();
    if (!cur || !_netLast) { _netLast = cur; return; }
    const dt = (cur.ts - _netLast.ts) / 1000;
    if (dt < 0.1) return;
    const rxDiff = Number(cur.rx - _netLast.rx);
    const txDiff = Number(cur.tx - _netLast.tx);
    _netSpeed = {
        downloadKBs: Math.max(0, rxDiff / dt / 1024),
        uploadKBs:   Math.max(0, txDiff / dt / 1024),
    };
    _netLast = cur;
}, 3000);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── JWT middleware ─────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
        req.admin = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ── Auth ───────────────────────────────────────────────────────────────────
app.post('/bot-api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = jwt.sign({ user: username }, JWT_SECRET, { expiresIn: '24h' });
        return res.json({ token, username });
    }
    res.status(401).json({ error: 'Invalid credentials' });
});

// ── Stats ──────────────────────────────────────────────────────────────────
app.get('/bot-api/stats', authMiddleware, (req, res) => {
    const memTotal = os.totalmem();
    const memFree  = os.freemem();
    const memUsed  = memTotal - memFree;
    const cpuLoad  = os.loadavg()[0];

    let fileCount = 0, fileSize = 0;
    try {
        const files = fs.readdirSync(DOWNLOAD_DIR);
        fileCount = files.length;
        files.forEach(f => {
            try { fileSize += fs.statSync(path.join(DOWNLOAD_DIR, f)).size; } catch {}
        });
    } catch {}

    let userCount = 0;
    try {
        const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json'), 'utf8'));
        userCount = Object.keys(db.users || {}).length;
    } catch {}

    let currentStatus = appState.getStatus();
    let currentNumber = appState.getNumber();
    try {
        const sm = require('./session-manager');
        const cSession = sm.getAll().find(s => s.status === 'Connected');
        if (cSession && currentStatus !== 'Connected') {
            currentStatus = 'Connected';
            currentNumber = cSession.number;
        }
    } catch(e) {}

    res.json({
        status: currentStatus,
        number: currentNumber,
        connectedAt: appState.getConnectedAt(),
        uptime: Math.floor(process.uptime()),
        memUsed: Math.round(memUsed / 1024 / 1024),
        memTotal: Math.round(memTotal / 1024 / 1024),
        memPercent: Math.round((memUsed / memTotal) * 100),
        cpuLoad: cpuLoad.toFixed(2),
        platform: os.platform(),
        nodeVersion: process.version,
        userCount,
        fileCount,
        fileSizeMB: (fileSize / 1024 / 1024).toFixed(1),
        downloadKBs: _netSpeed.downloadKBs,
        uploadKBs:   _netSpeed.uploadKBs,
        downloadSpeed: fmtSpeed(_netSpeed.downloadKBs),
        uploadSpeed:   fmtSpeed(_netSpeed.uploadKBs),
    });
});

// ── Sessions (Main bot) ────────────────────────────────────────────────────
app.get('/bot-api/bot/session', authMiddleware, (req, res) => {
    const sock = appState.getSocket();
    res.json({
        id: '__main__',
        label: 'Main Bot',
        number: appState.getNumber() || null,
        status: appState.getStatus(),
        connectedAt: appState.getConnectedAt(),
        platform: sock?.authState?.creds?.platform || 'whatsapp',
        isMain: true,
    });
});

app.post('/bot-api/bot/session/logout', authMiddleware, async (req, res) => {
    const sock = appState.getSocket();
    if (!sock) return res.status(400).json({ error: 'No active main session' });
    try {
        await sock.logout();
        appState.setSocket(null);
        appState.setStatus('Disconnected');
        appState.setNumber(null);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Multi-Session Manager API ──────────────────────────────────────────────
app.get('/bot-api/sessions', authMiddleware, (req, res) => {
    const sessionMgr = require('./session-manager');
    res.json(sessionMgr.getAll());
});

app.post('/bot-api/sessions', authMiddleware, async (req, res) => {
    const { id } = req.body || {};
    if (!id || !/^[a-zA-Z0-9_-]{2,30}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid session ID (2–30 alphanumeric chars)' });
    }
    const sessionMgr = require('./session-manager');
    const result = await sessionMgr.createSession(id);
    if (result.error) return res.status(400).json(result);
    res.json(result);
});

app.delete('/bot-api/sessions/:id', authMiddleware, async (req, res) => {
    const sessionMgr = require('./session-manager');
    const result = await sessionMgr.removeSession(req.params.id);
    res.json(result);
});

app.post('/bot-api/sessions/:id/paircode', authMiddleware, async (req, res) => {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Phone number required' });
    const sessionMgr = require('./session-manager');
    const result = await sessionMgr.requestPairCode(req.params.id, phone);
    if (result.error) return res.status(400).json(result);
    res.json(result);
});

// ── Broadcast ──────────────────────────────────────────────────────────────
app.post('/bot-api/broadcast', authMiddleware, async (req, res) => {
    const sock = appState.getSocket();
    if (!sock) return res.status(400).json({ error: 'Bot is not connected' });

    const { message, targets } = req.body || {};
    if (!message) return res.status(400).json({ error: 'Message is required' });

    let jids = targets;
    if (!jids || !jids.length) {
        try {
            const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json'), 'utf8'));
            jids = Object.keys(db.users || {});
        } catch { jids = []; }
    }

    const results = { sent: 0, failed: 0, total: jids.length, errors: [] };
    for (const jid of jids.slice(0, 50)) {
        try {
            await sock.sendMessage(jid, { text: message });
            results.sent++;
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            results.failed++;
            results.errors.push({ jid, error: e.message });
        }
    }
    res.json(results);
});

// ── Bot Control ────────────────────────────────────────────────────────────
app.post('/bot-api/admin/restart', authMiddleware, (req, res) => {
    appState.requestRestart();
    res.json({ ok: true, message: 'Restart queued — reconnecting in ~5 seconds' });
    setTimeout(() => {
        if (appState.isRestartRequested()) {
            appState.clearRestart();
            const { startBot } = require('./bot');
            startBot().catch(console.error);
        }
    }, 5000);
});

// ── Settings ───────────────────────────────────────────────────────────────
app.get('/bot-api/settings', authMiddleware, (req, res) => {
    const cfg = require('./config');
    let dbSettings = {};
    try {
        const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json'), 'utf8'));
        dbSettings = db.settings || {};
    } catch {}
    res.json({
        botName: dbSettings.botName || cfg.BOT_NAME,
        prefix: dbSettings.prefix || cfg.PREFIX,
        ownerNumber: cfg.OWNER_NUMBER,
        autoRead: dbSettings.autoRead !== undefined ? dbSettings.autoRead : cfg.AUTO_READ,
        autoTyping: dbSettings.autoTyping !== undefined ? dbSettings.autoTyping : cfg.AUTO_TYPING,
        nsfwEnabled: dbSettings.nsfwEnabled !== undefined ? dbSettings.nsfwEnabled : cfg.NSFW_ENABLED,
        premiumCode: cfg.PREMIUM_CODE,
    });
});

app.post('/bot-api/settings', authMiddleware, (req, res) => {
    const { botName, prefix, autoRead, autoTyping, nsfwEnabled } = req.body || {};
    try {
        const dbPath = path.join(__dirname, 'db.json');
        const db = JSON.parse(fs.existsSync(dbPath) ? fs.readFileSync(dbPath, 'utf8') : '{}');
        if (!db.settings) db.settings = {};
        if (botName !== undefined) db.settings.botName = botName;
        if (prefix !== undefined) db.settings.prefix = prefix;
        if (autoRead !== undefined) db.settings.autoRead = autoRead;
        if (autoTyping !== undefined) db.settings.autoTyping = autoTyping;
        if (nsfwEnabled !== undefined) db.settings.nsfwEnabled = nsfwEnabled;
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Economy ────────────────────────────────────────────────────────────────
app.get('/bot-api/economy', authMiddleware, (req, res) => {
    try {
        const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json'), 'utf8'));
        const users = db.users || {};
        const list = Object.entries(users).map(([jid, data]) => ({
            jid,
            number: jid.split('@')[0],
            balance: data.balance || 0,
            premium: data.premium || false,
            wins: data.wins || 0,
            dailyLast: data.dailyLast || null,
        }));
        res.json(list);
    } catch { res.json([]); }
});

app.post('/bot-api/economy/edit', authMiddleware, (req, res) => {
    const { jid, balance } = req.body || {};
    if (!jid || balance === undefined) return res.status(400).json({ error: 'jid and balance required' });
    try {
        const dbPath = path.join(__dirname, 'db.json');
        const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (!db.users) db.users = {};
        if (!db.users[jid]) db.users[jid] = {};
        db.users[jid].balance = Number(balance);
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/bot-api/economy/reset', authMiddleware, (req, res) => {
    try {
        const dbPath = path.join(__dirname, 'db.json');
        const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        Object.keys(db.users || {}).forEach(jid => {
            db.users[jid].balance = 0;
            db.users[jid].wins = 0;
        });
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── File Manager ───────────────────────────────────────────────────────────
app.get('/bot-api/files', authMiddleware, (req, res) => {
    try {
        const files = fs.readdirSync(DOWNLOAD_DIR).map(name => {
            const fPath = path.join(DOWNLOAD_DIR, name);
            try {
                const stat = fs.statSync(fPath);
                return {
                    name,
                    sizeMB: (stat.size / 1024 / 1024).toFixed(2),
                    modified: stat.mtime.toISOString(),
                    ext: path.extname(name).slice(1).toLowerCase() || 'file',
                };
            } catch { return null; }
        }).filter(Boolean).sort((a, b) => new Date(b.modified) - new Date(a.modified));
        res.json(files);
    } catch { res.json([]); }
});

app.delete('/bot-api/files/:name', authMiddleware, (req, res) => {
    const name = path.basename(req.params.name);
    const fPath = path.join(DOWNLOAD_DIR, name);
    if (!fs.existsSync(fPath)) return res.status(404).json({ error: 'File not found' });
    try {
        fs.unlinkSync(fPath);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Logs ───────────────────────────────────────────────────────────────────
app.get('/bot-api/logs', authMiddleware, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    res.json(appState.getLogs().slice(-limit).reverse());
});

// ── WebSocket ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    socket.emit('update', {
        status: appState.getStatus(),
        number: appState.getNumber(),
    });
    appState.getLogs().slice(-30).forEach(l => socket.emit('log', l));
});

// ── Fallback (SPA) ─────────────────────────────────────────────────────────
app.get('*', (req, res) => {
    if (req.path.startsWith('/bot-api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
function startDashboard() {
    setIO(io);
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} in use — killing old process and retrying...`);
            const { execSync } = require('child_process');
            try {
                execSync(`fuser -k ${PORT}/tcp 2>/dev/null || kill $(lsof -t -i:${PORT}) 2>/dev/null || true`, { stdio: 'pipe' });
            } catch {}
            setTimeout(() => {
                server.listen(PORT, '0.0.0.0', () => {
                    console.log(`🌐 Dashboard: http://localhost:${PORT} (retry)`);
                }).on('error', (e2) => {
                    console.error('Server Error on retry:', e2.message);
                });
            }, 1500);
        } else {
            console.error('Server Error:', err);
        }
    });
}

module.exports = { startDashboard, io };
