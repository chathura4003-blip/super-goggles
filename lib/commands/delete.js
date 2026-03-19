const { deleteMessage } = require('../utils');

module.exports = {
    name: 'delete',
    aliases: ['del', 'can', 'unsend'],
    description: 'Delete a message (reply to the message to delete it)',
    async execute(sock, msg, from, args) {
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo?.stanzaId) {
            return await sock.sendMessage(from, { text: '⚠️ Please reply to the message you want me to delete!' });
        }

        const key = {
            remoteJid: from,
            id: contextInfo.stanzaId,
            fromMe: contextInfo.participant === sock.user.id.split(':')[0] + '@s.whatsapp.net',
            participant: contextInfo.participant
        };

        if (!key.fromMe) {
            return await sock.sendMessage(from, { text: '⚠️ I can only delete my own messages, Master!' });
        }

        await deleteMessage(sock, from, key);
        // Also delete the command message itself to keep it clean
        await deleteMessage(sock, from, msg.key);
    }
};
