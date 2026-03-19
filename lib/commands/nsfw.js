const { isAdmin, isOwner, sendReact } = require('../utils');
const db = require('../db');
const axios = require('axios');

const WAIFU_NSFW = ['waifu', 'neko', 'trap', 'blowjob', 'ass'];

module.exports = {
    name: 'nsfw',
    aliases: ['18+', 'hentai', 'nsfwvid'],
    description: 'NSFW content module (admin & group-enabled only)',
    async execute(sock, msg, from, args) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const command = text.toLowerCase().trim().split(' ')[0].slice(1);
        const sender = msg.key.participant || msg.key.remoteJid;

        const isUserAdmin = await isAdmin(sock, from, sender);
        const isUserOwner = isOwner(sender);

        // Toggle command — admin only
        if (command === 'nsfw') {
            if (!isUserAdmin && !isUserOwner) {
                return await sock.sendMessage(from, { text: '❌ Only group admins can toggle NSFW, Master.' });
            }
            const state = args[0]?.toLowerCase() === 'on';
            db.update('groups', from, { nsfw: state });
            return await sock.sendMessage(from, {
                text: `🔞 NSFW content is now *${state ? 'ENABLED ✅' : 'DISABLED ❌'}* for this group.`
            });
        }

        // Content commands — check group setting
        const groupSettings = db.get('groups', from);
        if (!groupSettings.nsfw && !isUserOwner) {
            return await sock.sendMessage(from, {
                text: '🔞 NSFW is *disabled* in this group.\n\nAsk an admin to enable it with `.nsfw on`, Master.'
            });
        }

        await sendReact(sock, from, msg, '🔞');

        try {
            if (command === 'hentai') {
                const type = WAIFU_NSFW[Math.floor(Math.random() * WAIFU_NSFW.length)];
                const { data } = await axios.get(`https://api.waifu.pics/nsfw/${type}`);
                await sock.sendMessage(from, {
                    image: { url: data.url },
                    caption: `🔥 *Supreme Hentai — ${type.toUpperCase()}*\n\n_Use .nsfw off to disable this module._`
                });
            }

            else if (command === '18+') {
                const { data } = await axios.get('https://api.waifu.pics/nsfw/neko');
                await sock.sendMessage(from, {
                    image: { url: data.url },
                    caption: `🔥 *Supreme 18+ Content*`
                });
            }

            else if (command === 'nsfwvid') {
                const keyword = args.join(' ') || 'top';
                const { multiSiteSearch } = require('../../search');
                const results = await multiSiteSearch(keyword);
                const videoResults = results.filter(r =>
                    ['Pornhub', 'XNXX', 'XVideos', 'xHamster', 'YouPorn', 'SpankBang', 'RedTube'].includes(r.site)
                ).slice(0, 5);

                if (!videoResults.length) {
                    return await sock.sendMessage(from, { text: '❌ No video results found, Master.' });
                }

                let listMsg = `🔞 *NSFW Video Results*${keyword !== 'top' ? ` for "${keyword}"` : ''}\n\n`;
                videoResults.forEach((v, i) => {
                    listMsg += `${i + 1}. *[${v.site}]* ${v.title} (${v.duration || '?'})\n🔗 ${v.url}\n\n`;
                });
                listMsg += `_Use .ph / .xnxx / .xv <link> to download, Master._`;
                await sock.sendMessage(from, { text: listMsg });
            }

            await sendReact(sock, from, msg, '✅');
        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            await sock.sendMessage(from, { text: `NSFW error: ${e.message}` });
        }
    }
};
