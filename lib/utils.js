const { OWNER_NUMBER } = require('../config');

async function sendReact(sock, from, msg, emoji) {
    try {
        await sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
    } catch (e) {}
}

async function presenceUpdate(sock, from, type = 'composing') {
    try {
        await sock.sendPresenceUpdate(type, from);
    } catch (e) {}
}

function isOwner(sender) {
    return sender.replace(/[^0-9]/g, '') === OWNER_NUMBER;
}

async function isAdmin(sock, from, sender) {
    try {
        const groupMetadata = await sock.groupMetadata(from);
        const participant = groupMetadata.participants.find(p => p.id === sender);
        return participant?.admin === 'admin' || participant?.admin === 'superadmin';
    } catch (e) {
        return false;
    }
}

async function deleteMessage(sock, from, key) {
    try {
        await sock.sendMessage(from, { delete: key });
    } catch (e) {
        console.error('Delete Error:', e);
    }
}

async function sendTemporaryMessage(sock, jid, text, delay = 7000) {
    try {
        const msg = await sock.sendMessage(jid, { text: text });
        setTimeout(async () => {
            try {
                await sock.sendMessage(jid, { delete: msg.key });
            } catch (err) {
                // Silently fail if message already deleted or connection lost
            }
        }, delay);
        return msg;
    } catch (e) {
        console.error('Send Temp Message Error:', e);
        return null;
    }
}

module.exports = {
    sendReact,
    presenceUpdate,
    isOwner,
    isAdmin,
    deleteMessage,
    sendTemporaryMessage
};
