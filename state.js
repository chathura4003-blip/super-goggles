// Shared runtime state — bot.js writes, dashboard.js reads
'use strict';

const MAX_LOGS = 500;

const state = {
    socket: null,
    status: 'Disconnected',
    connectedNumber: null,
    connectedAt: null,
    logs: [],
    restartRequested: false,
};

module.exports = {
    getSocket:          ()  => state.socket,
    setSocket:          (s) => { state.socket = s; },
    getStatus:          ()  => state.status,
    setStatus:          (s) => { state.status = s; },
    getNumber:          ()  => state.connectedNumber,
    setNumber:          (n) => { state.connectedNumber = n; },
    getConnectedAt:     ()  => state.connectedAt,
    setConnectedAt:     (t) => { state.connectedAt = t; },
    getLogs:            ()  => state.logs,
    addLog:             (entry) => {
        state.logs.push(entry);
        if (state.logs.length > MAX_LOGS) state.logs.shift();
    },
    isRestartRequested: ()  => state.restartRequested,
    requestRestart:     ()  => { state.restartRequested = true; },
    clearRestart:       ()  => { state.restartRequested = false; },
};
