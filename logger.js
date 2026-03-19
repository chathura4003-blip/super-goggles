'use strict';

const state = require('./state');

let _io = null;

function setIO(io) { _io = io; }

function logger(msg) {
    const time = new Date().toLocaleString('en-GB', { hour12: false });
    const entry = `[${time}] ${msg}`;
    console.log(entry);
    state.addLog(entry);
    if (_io) {
        _io.emit('log', entry);
    }
}

module.exports = { logger, setIO, getLogs: state.getLogs };
