const os = require('os');
const { sendReact, presenceUpdate } = require('../utils');
const { BOT_NAME, OWNER_NUMBER, PREFIX } = require('../../config');

module.exports = {
    name: 'ping',
    aliases: ['alive', 'system', 'status', 'uptime'],
    description: 'System status and latency commands',
    async execute(sock, msg, from, args) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const command = text.toLowerCase().trim().split(' ')[0].slice(1);

        await sendReact(sock, from, msg, '⚙️');
        await presenceUpdate(sock, from, 'composing');

        try {
            if (command === 'ping') {
                const start = Date.now();
                const sent = await sock.sendMessage(from, { text: '🏓 Pinging...' });
                const latency = Date.now() - start;
                await sock.sendMessage(from, {
                    edit: sent.key,
                    text: `🏓 *Pong, Master!*\n⚡ Speed: *${latency}ms*\n✅ All systems operational.`
                });
            } else {
                const uptime = process.uptime();
                const h = Math.floor(uptime / 3600);
                const m = Math.floor((uptime % 3600) / 60);
                const s = Math.floor(uptime % 60);
                const totalMem = (os.totalmem() / 1024 / 1024).toFixed(0);
                const freeMem = (os.freemem() / 1024 / 1024).toFixed(0);
                const usedMem = totalMem - freeMem;

                const sysMsg =
`⚡ *${BOT_NAME} — SYSTEM STATUS* ⚡

🤖 *Bot:* ${BOT_NAME}
⏱️ *Uptime:* ${h}h ${m}m ${s}s
💾 *RAM:* ${usedMem}MB used / ${totalMem}MB total
🖥️ *OS:* ${os.type()} ${os.release()} (${os.arch()})
📡 *Mode:* Multi-Device (MD)
🔑 *Prefix:* [ ${PREFIX} ]
👑 *Owner:* +${OWNER_NUMBER}

_Status: ONLINE | Power: UNRESTRICTED_`;

                await sock.sendMessage(from, { text: sysMsg });
            }

            await sendReact(sock, from, msg, '✅');
        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            await sock.sendMessage(from, { text: `System error: ${e.message}` });
        }
    }
};
