const { sendReact } = require('../utils');
const db = require('../db');

module.exports = {
    name: 'premium',
    aliases: ['claim', 'unlock'],
    description: 'Premium user management',
    async execute(sock, msg, from, args) {
        const sender = msg.key.participant || msg.key.remoteJid;
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const command = text.toLowerCase().trim().split(' ')[0].slice(1);

        await sendReact(sock, from, msg, '💎');

        try {
            if (command === 'premium') {
                const userData = db.get('users', sender);
                const isPremium = userData.premium || false;
                await sock.sendMessage(from, { text: `💎 *Premium Status:* ${isPremium ? 'Active ✅' : 'Inactive ❌'}\n\nType \`.claim\` to unlock features if you have a code, Master.` });
            }
            else if (command === 'claim') {
                const code = args[0];
                if (code === 'SUPREME2026') { // Static example code
                    db.update('users', sender, { premium: true });
                    await sock.sendMessage(from, { text: '💎 *CONGRATULATIONS!* \nYou have just claimed Premium Status, Master! All restricted limits are now removed.' });
                } else {
                    await sock.sendMessage(from, { text: '❌ Invalid claim code, Master.' });
                }
            }

            await sendReact(sock, from, msg, '✅');
        } catch (e) {
            await sendReact(sock, from, msg, '❌');
        }
    }
};
