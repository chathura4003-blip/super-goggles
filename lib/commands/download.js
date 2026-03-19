const { downloadCompressAndSend } = require('../../downloader');
const { searchYouTube, searchSite, searchAllAdult } = require('../../search');
const { sendReact, presenceUpdate } = require('../utils');
const { storeSearchResults, showQualityButtons } = require('../handler');

const NUM_EMOJI = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

function truncate(str, max = 50) {
    return str && str.length > max ? str.slice(0, max - 1) + '…' : (str || 'Unknown');
}

const SITE_MAP = {
    'yt':   { name: 'YouTube',    adult: false },
    'yta':  { name: 'YouTube',    adult: false },
    'tt':   { name: 'TikTok',     adult: false },
    'ig':   { name: 'Instagram',  adult: false },
    'fb':   { name: 'Facebook',   adult: false },
    'ph':   { name: 'Pornhub',    adult: true  },
    'xnxx': { name: 'XNXX',       adult: true  },
    'xv':   { name: 'XVideos',    adult: true  },
    'xh':   { name: 'xHamster',   adult: true  },
    'yp':   { name: 'YouPorn',    adult: true  },
    'sb':   { name: 'SpankBang',  adult: true  },
    'rt':   { name: 'RedTube',    adult: true  }
};

module.exports = {
    name: 'download',
    aliases: ['yt', 'yta', 'tt', 'ig', 'fb', 'ph', 'xnxx', 'xv', 'xh', 'yp', 'sb', 'rt'],
    description: 'Universal media downloader with search fallback',
    async execute(sock, msg, from, args) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const command = text.toLowerCase().trim().split(' ')[0].slice(1);
        const sender = msg.key.participant || msg.key.remoteJid;

        const siteInfo = SITE_MAP[command] || { name: 'Media', adult: false };
        const siteName = siteInfo.name;
        const isAudio = command === 'yta';

        // Detect quality flag from full text
        let quality = 'sd'; // default SD for speed
        if (text.toLowerCase().includes(' hd')) quality = 'hd';
        else if (text.toLowerCase().includes(' low')) quality = 'low';

        const url = args.find(a => /^https?:\/\//i.test(a));
        const keyword = args.filter(a => !/^https?:\/\//i.test(a) && !['hd','sd','low'].includes(a.toLowerCase())).join(' ');

        // ── No input ────────────────────────────────────────────────────
        if (!url && !keyword) {
            return await sock.sendMessage(from, {
                text: `⚠️ Usage:\n*.${command} <link>* — direct download\n*.${command} <keyword>* — search & pick\n\n_Example: .${command} https://... or .${command} funny cats_`
            });
        }

        // ── Keyword mode: search → show list ────────────────────────────
        if (!url && keyword) {
            await sendReact(sock, from, msg, '🔍');
            await presenceUpdate(sock, from, 'composing');
            await sock.sendMessage(from, {
                text: `🔍 Searching *${siteName}* for "${keyword}"...`
            });

            try {
                let results = [];
                if (!siteInfo.adult && (command === 'yt' || command === 'yta')) {
                    results = await searchYouTube(keyword, 10);
                } else if (siteInfo.adult) {
                    results = await searchSite(siteName, keyword, 10);
                    if (!results.length) results = await searchAllAdult(keyword, 10);
                } else {
                    results = await searchYouTube(keyword, 10);
                }

                if (!results.length) {
                    return await sock.sendMessage(from, { text: `❌ No results for "${keyword}", Master.` });
                }

                const emoji = siteInfo.adult ? '🔞' : '🎥';
                let listMsg = `${emoji} *${siteName} Search*\n`;
                listMsg += `🔍 Search: _${keyword}_\n`;
                listMsg += `${'─'.repeat(28)}\n\n`;
                listMsg += `🎥 *RESULTS:*\n`;
                results.slice(0, 10).forEach((v, i) => {
                    listMsg += `${NUM_EMOJI[i] || `${i+1}.`} ${truncate(v.title)} _(${v.duration || '?'})_\n`;
                });
                listMsg += `\n${'─'.repeat(28)}\n`;
                listMsg += `👉 *Reply 1–${Math.min(results.length, 10)} or tap a button*`;

                const topResults = results.slice(0, 10);
                await sock.sendMessage(from, {
                    text: listMsg
                });
                storeSearchResults(msg?.key?.id, sender, topResults);
                await sendReact(sock, from, msg, '✅');

            } catch (e) {
                await sendReact(sock, from, msg, '❌');
                await sock.sendMessage(from, { text: `❌ Search failed: ${e.message}` });
            }
            return;
        }

        // ── Direct download or show quality ─────────────────────────────
        const hasQualityFlag = text.toLowerCase().match(/\s(hd|sd|low|audio|mp3)\b/);
        
        if (!hasQualityFlag && !isAudio) {
            await sendReact(sock, from, msg, '🔍');
            const { getMetadata } = require('../../downloader');
            const meta = await getMetadata(url);
            if (meta) {
                await showQualityButtons(sock, from, meta, null, sender);
                await sendReact(sock, from, msg, '✅');
            } else {
                await sock.sendMessage(from, { text: `🎬 *Quality Selector*\n${'─'.repeat(28)}\n\n🔗 ${url}\n\n_To download, reply with the quality:_ \n\n*.${command} ${url} hd* — 1080p\n*.${command} ${url} sd* — 720p\n*.${command} ${url} low* — 480p\n*.yta ${url}* — Audio (MP3)` });
            }
            return;
        }

        await sendReact(sock, from, msg, '⏳');
        await presenceUpdate(sock, from, isAudio ? 'recording' : 'composing');

        try {
            await downloadCompressAndSend(sock, from, url, siteName, quality, isAudio);
            await sendReact(sock, from, msg, '✅');
        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            await sock.sendMessage(from, { text: `❌ Download error: ${e.message}` });
        }
    }
};
