const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, '../db.json');

let memCache = null;
let dirty = false;
let flushTimer = null;

const FLUSH_DELAY = 500;

function readDB() {
    if (memCache) return memCache;
    if (!fs.existsSync(dbPath)) {
        memCache = { users: {}, groups: {}, settings: {} };
        return memCache;
    }
    try {
        memCache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch {
        memCache = { users: {}, groups: {}, settings: {} };
    }
    return memCache;
}

function scheduledFlush() {
    if (!dirty) return;
    try {
        fs.writeFileSync(dbPath, JSON.stringify(memCache, null, 4));
        dirty = false;
    } catch {}
}

function markDirty() {
    dirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        scheduledFlush();
    }, FLUSH_DELAY);
}

module.exports = {
    get: (key, id) => {
        const db = readDB();
        return db[key]?.[id] || {};
    },
    set: (key, id, data) => {
        const db = readDB();
        if (!db[key]) db[key] = {};
        db[key][id] = data;
        markDirty();
    },
    update: (key, id, data) => {
        const db = readDB();
        if (!db[key]) db[key] = {};
        db[key][id] = { ...(db[key][id] || {}), ...data };
        markDirty();
    },
    getGlobal: (key) => {
        const db = readDB();
        return db.settings[key];
    },
    setGlobal: (key, val) => {
        const db = readDB();
        db.settings[key] = val;
        markDirty();
    },
    flush: scheduledFlush
};
