const { isAdmin, isOwner, sendReact } = require('../utils');
const db = require('../db');

const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'pussy', 'whore', 'nigger'];

module.exports = {
    name: 'group',
    aliases: ['kick', 'add', 'promote', 'demote', 'lock', 'unlock', 'antilink', 'antibad'],
    description: 'Group & Admin management tools',
    async execute(sock, msg, from, args) {
        if (!from.endsWith('@g.us')) {
            return await sock.sendMessage(from, { text: '⚠️ This command only works in groups, Master.' });
        }

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const command = text.toLowerCase().trim().split(' ')[0].slice(1);
        const sender = msg.key.participant || msg.key.remoteJid;

        const isUserAdmin = await isAdmin(sock, from, sender);
        const isUserOwner = isOwner(sender);

        if (!isUserAdmin && !isUserOwner) {
            return await sock.sendMessage(from, { text: '❌ This command is for group admins only, Master.' });
        }

        await sendReact(sock, from, msg, '👑');

        try {
            if (command === 'kick') {
                const target =
                    msg.message.extendedTextMessage?.contextInfo?.participant ||
                    (args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
                if (!target || target === '@s.whatsapp.net') {
                    return await sock.sendMessage(from, { text: '⚠️ Tag a user or provide their number to kick!' });
                }
                await sock.groupParticipantsUpdate(from, [target], 'remove');
                await sock.sendMessage(from, {
                    text: `✅ Kicked @${target.split('@')[0]} from the group.`,
                    mentions: [target]
                });
            }

            else if (command === 'add') {
                const number = args[0]?.replace(/[^0-9]/g, '');
                if (!number) return await sock.sendMessage(from, { text: '⚠️ Provide a phone number to add (e.g. .add 94712345678), Master.' });
                const jid = `${number}@s.whatsapp.net`;
                await sock.groupParticipantsUpdate(from, [jid], 'add');
                await sock.sendMessage(from, { text: `✅ Added +${number} to the group.` });
            }

            else if (command === 'promote') {
                const target =
                    msg.message.extendedTextMessage?.contextInfo?.participant ||
                    (args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
                await sock.groupParticipantsUpdate(from, [target], 'promote');
                await sock.sendMessage(from, {
                    text: `✅ Promoted @${target.split('@')[0]} to Admin.`,
                    mentions: [target]
                });
            }

            else if (command === 'demote') {
                const target =
                    msg.message.extendedTextMessage?.contextInfo?.participant ||
                    (args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
                await sock.groupParticipantsUpdate(from, [target], 'demote');
                await sock.sendMessage(from, {
                    text: `✅ Demoted @${target.split('@')[0]} from Admin.`,
                    mentions: [target]
                });
            }

            else if (command === 'lock') {
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: '🔒 Group locked — only admins can send messages.' });
            }

            else if (command === 'unlock') {
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: '🔓 Group unlocked — everyone can send messages.' });
            }

            else if (command === 'antilink') {
                const state = args[0]?.toLowerCase() === 'on';
                db.update('groups', from, { antilink: state });
                await sock.sendMessage(from, {
                    text: `🛡️ Anti-Link is now *${state ? 'ON ✅' : 'OFF ❌'}* for this group.`
                });
            }

            else if (command === 'antibad') {
                const state = args[0]?.toLowerCase() === 'on';
                db.update('groups', from, { antibad: state });
                await sock.sendMessage(from, {
                    text: `🚫 Anti-Bad Words is now *${state ? 'ON ✅' : 'OFF ❌'}* for this group.\n\n_${state ? `Monitored words: ${BAD_WORDS.length} entries.` : 'Word filter disabled.'}_`
                });
            }

            await sendReact(sock, from, msg, '✅');
        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            await sock.sendMessage(from, { text: `❌ Action failed: ${e.message}` });
        }
    }
};
