const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, '../db.json');

function readDB() {
    if (!fs.existsSync(dbPath)) return { users: {}, groups: {}, settings: {} };
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function writeDB(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 4));
}

module.exports = {
    get: (key, id) => {
        const db = readDB();
        return db[key][id] || {};
    },
    set: (key, id, data) => {
        const db = readDB();
        if (!db[key]) db[key] = {};
        db[key][id] = data;
        writeDB(db);
    },
    update: (key, id, data) => {
        const db = readDB();
        if (!db[key]) db[key] = {};
        db[key][id] = { ...(db[key][id] || {}), ...data };
        writeDB(db);
    },
    getGlobal: (key) => {
        const db = readDB();
        return db.settings[key];
    },
    setGlobal: (key, val) => {
        const db = readDB();
        db.settings[key] = val;
        writeDB(db);
    }
};
