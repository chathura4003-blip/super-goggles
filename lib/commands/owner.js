const { isOwner, sendReact } = require('../utils');
const db = require('../db');
const { logger } = require('../../logger');
const fs = require('fs');

module.exports = {
    name: 'owner',
    aliases: ['bc', 'broadcast', 'ban', 'unban', 'setppbot', 'autoread', 'autotyping', 'restart'],
    description: 'Owner-only restricted panel',
    async execute(sock, msg, from, args) {
        const sender = msg.key.participant || msg.key.remoteJid;

        if (!isOwner(sender)) {
            return await sock.sendMessage(from, { text: '❌ This command is restricted to the bot owner, Master.' });
        }

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const command = text.toLowerCase().trim().split(' ')[0].slice(1);

        await sendReact(sock, from, msg, '👨‍💻');

        try {
            if (command === 'bc' || command === 'broadcast') {
                const q = args.join(' ');
                if (!q) return await sock.sendMessage(from, { text: '⚠️ Provide a message to broadcast, Master!' });
                const groups = Object.keys(await sock.groupFetchAllParticipating());
                let sent = 0;
                for (const gjid of groups) {
                    try {
                        await sock.sendMessage(gjid, { text: `📢 *BROADCAST FROM MASTER*\n\n${q}` });
                        sent++;
                    } catch {}
                }
                await sock.sendMessage(from, { text: `✅ Broadcast sent to *${sent}/${groups.length}* groups.` });
            }

            else if (command === 'ban') {
                const target =
                    msg.message.extendedTextMessage?.contextInfo?.participant ||
                    (args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
                db.update('settings', 'banned', { [target]: true });
                await sock.sendMessage(from, {
                    text: `✅ Banned @${target.split('@')[0]} — they can no longer use bot commands.`,
                    mentions: [target]
                });
            }

            else if (command === 'unban') {
                const target =
                    msg.message.extendedTextMessage?.contextInfo?.participant ||
                    (args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
                db.update('settings', 'banned', { [target]: false });
                await sock.sendMessage(from, {
                    text: `✅ Unbanned @${target.split('@')[0]} — access restored.`,
                    mentions: [target]
                });
            }

            else if (command === 'autoread') {
                const state = args[0]?.toLowerCase() === 'on';
                db.setGlobal('autoread', state);
                await sock.sendMessage(from, { text: `✅ Auto-Read is now *${state ? 'ON ✅' : 'OFF ❌'}*` });
            }

            else if (command === 'autotyping') {
                const state = args[0]?.toLowerCase() === 'on';
                db.setGlobal('autotyping', state);
                await sock.sendMessage(from, { text: `✅ Auto-Typing indicator is now *${state ? 'ON ✅' : 'OFF ❌'}*` });
            }

            else if (command === 'setppbot') {
                const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                const img = quoted?.imageMessage || msg.message.imageMessage;
                if (!img) {
                    return await sock.sendMessage(from, { text: '⚠️ Reply to an image to set it as the bot\'s profile picture, Master!' });
                }
                const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                const stream = await downloadContentFromMessage(img, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                await sock.updateProfilePicture(sock.user.id, buffer);
                await sock.sendMessage(from, { text: '✅ Bot profile picture updated, Master!' });
            }

            else if (command === 'restart') {
                await sock.sendMessage(from, { text: '🔄 Restarting bot systems, Master...' });
                logger('Owner triggered restart.');
                setTimeout(() => process.exit(0), 1000);
            }

            await sendReact(sock, from, msg, '✅');
        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            logger(`Owner command error (${command}): ${e.message}`);
            await sock.sendMessage(from, { text: `❌ Command failed: ${e.message}` });
        }
    }
};
