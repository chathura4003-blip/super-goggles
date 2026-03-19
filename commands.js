const fs = require('fs');
const { downloadCompressAndSend } = require('./downloader');
const { multiSiteSearch } = require('./search');
const { logger } = require('./logger');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const os = require('os');
const axios = require('axios');
const cheerio = require('cheerio');

const userSearches = new Map();

async function sendReact(sock, from, msg, emoji) {
    try { await sock.sendMessage(from, { react: { text: emoji, key: msg.key } }); } catch (e) {}
}

const mediaSites = {
    '.ph ': 'Pornhub',
    '.xv ': 'XVideos',
    '.xnxx ': 'XNXX',
    '.xh ': 'xHamster',
    '.yp ': 'YouPorn',
    '.ep ': 'Eporner',
    '.sb ': 'SpankBang',
    '.rt ': 'RedTube',
    '.yt ': 'YouTube',
    '.tt ': 'TikTok',
    '.fb ': 'Facebook',
    '.ig ': 'Instagram',
    '.pin ': 'Pinterest',
};

async function processMessage(sock, msg, from, text) {
    const lower = text.toLowerCase().trim();

    // Number Reply automated download trigger for Search Maps
    const contextInfo = msg.message.extendedTextMessage?.contextInfo;
    if (contextInfo?.stanzaId && userSearches.has(contextInfo.stanzaId)) {
        const selection = parseInt(lower);
        if (!isNaN(selection)) {
            const results = userSearches.get(contextInfo.stanzaId);
            if (selection > 0 && selection <= results.length) {
                const result = results[selection - 1];
                const selectedUrl = result.url;
                
                let q = 'sd';
                if (lower.includes(' hd ')) q = 'hd';
                else if (lower.includes(' sd ')) q = 'sd';
                else if (lower.includes(' low ')) q = 'low';
                else if (lower.endsWith('hd')) q = 'hd';
                else if (lower.endsWith('sd')) q = 'sd';

                await sock.sendMessage(from, { text: `🔄 Triggering automated download for Option ${selection} (${q.toUpperCase()})...` });
                await downloadCompressAndSend(sock, from, selectedUrl, result.site || 'XNXX', q);
                
                // Keep the list active in case they want more options, or optionally delete it:
                // userSearches.delete(contextInfo.stanzaId);
                return true;
            }
        }
    }

    // System Hooks (.alive, .system)
    if (lower === '.alive' || lower === '.system') {
        await sendReact(sock, from, msg, '⚙️');
        await sock.sendPresenceUpdate('composing', from);
        
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        
        const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
        const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
        
        const sysMsg = `⚡ *FULL MOD SYSTEM STATUS* ⚡\n\n*⏱️ Uptime:* ${hours}h ${minutes}m ${seconds}s\n*💾 RAM:* ${freeMem}GB Free / ${totalMem}GB Total\n*🖥️ Host OS:* ${os.type()} ${os.release()} (${os.arch()})\n*🤖 Mode:* Multi-Device (MD) Unrestricted\n\n_Master is globally active._`;
        
        await sock.sendMessage(from, { text: sysMsg });
        await sendReact(sock, from, msg, '✅');
        return true;
    }

    // Owner Hook (.owner, .creator)
    if (lower === '.owner' || lower === '.creator') {
        await sendReact(sock, from, msg, '👑');
        await sock.sendPresenceUpdate('composing', from);
        const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Master\nORG:Full Mod;\nTEL;type=CELL;type=VOICE;waid=1234567890:+1 234 567 890\nEND:VCARD';
        await sock.sendMessage(from, { 
            contacts: { displayName: 'Master', contacts: [{ vcard }] }
        });
        await sendReact(sock, from, msg, '✅');
        return true;
    }

    // Ping
    if (lower === '.ping') {
        await sendReact(sock, from, msg, '🏓');
        await sock.sendPresenceUpdate('composing', from);
        const start = Date.now();
        const sent = await sock.sendMessage(from, { text: '🏓 Pinging core engines...' });
        const latency = Date.now() - start;
        await sock.sendMessage(from, {
            edit: sent.key,
            text: `🏓 *Pong, Master!*\n⚡ Speed: ${latency}ms\n✅ System fully operational and waiting for orders.`
        });
        await sendReact(sock, from, msg, '✅');
        return true;
    }

    // Menu
    if (lower === '.menu' || lower === '.help') {
        await sock.sendMessage(from, {
            text:
`📥 AUTO-FETCH DOWNLOADERS (SELECTIVE MOD):
.ph <link/key> ⮕ (Top 10 Results + Interactive Selection)
.xv <link/key> ⮕ (Top 10 Results + Interactive Selection)
.xnxx <link/key> ⮕ (Top 10 Results + Interactive Selection)
.xh <link/key> ⮕ (Top 10 Results + Interactive Selection)
.yp <link/key> ⮕ (Top 10 Results + Interactive Selection)
.sb <link/key> ⮕ (Top 10 Results + Interactive Selection)
.rt <link/key> ⮕ (Top 10 Results + Interactive Selection)
.yt <link/key> ⮕ (YouTube Master Selection)
.tt <link/key> ⮕ (TikTok No-WM + Auto Selection)
.fb <link/key> ⮕ (Facebook HD/SD Selection)
.ig <link/key> ⮕ (Instagram Story/Post Selector)
.pin <link/key> ⮕ (Pinterest Image/Video Selector)

⚙️ PREMIUM QUALITY SELECTOR:
hd - 1080p Ultra | sd - 720p Standard | low - Data Saver

🔍 ULTRA X-SEARCH ENGINE:
.xnx <keyword> ⮕ (Top 10 Results + Interactive List)

🎨 WIZARD & UTILITIES:
.st ⮕ (Media to Sticker) | .ping ⮕ (Latency)
.alive ⮕ (System Status) | .owner ⮕ (Creator VCard)

Status: ONLINE | Mode: FULL MOD | Power: UNRESTRICTED` });
        await sendReact(sock, from, msg, '📜');
        return true;
    }

    // Download
    for (const [prefix, siteName] of Object.entries(mediaSites)) {
        if (lower.startsWith(prefix)) {
            let q = 'sd'; // Default to SD for fast <100MB downloads
            let url = '';

            if (lower.includes(' hd ')) {
                q = 'hd';
                url = lower.split(' ').slice(2).join(' ').trim();
            } else if (lower.includes(' sd ')) {
                q = 'sd';
                url = lower.split(' ').slice(2).join(' ').trim();
            } else if (lower.includes(' low ')) {
                q = 'low';
                url = lower.split(' ').slice(2).join(' ').trim();
            } else {
                url = lower.split(' ').slice(1).join(' ').trim();
            }

            if (!url) return await sock.sendMessage(from, { text: '⚠️ Please provide a link or keyword, Master!' });

            // Interactive Selection Logic Fallback
            if (!/^https?:\/\//i.test(url)) {
                await sendReact(sock, from, msg, '🔍');
                await sock.sendPresenceUpdate('composing', from);
                await sock.sendMessage(from, { text: `🔍 Keyword detected. Initializing deep fetch for "${url}", Master...` });
                const r = await multiSiteSearch(url);
                let filtered = r.filter(v => v.site.toLowerCase() === siteName.toLowerCase());
                
                // No Results Fix / Error Recovery Bypasses 
                if (!filtered.length) {
                    filtered = r.filter(v => v.site === 'YouTube' || v.site.toLowerCase().includes('search'));
                    if (!filtered.length) filtered = r; 
                }
                filtered = filtered.slice(0, 10);

                if (!filtered.length) return await sock.sendMessage(from, { text: '❌ No results mapped on any active server endpoints, Master.' });

                let listMsg = `*Top 10 Results for:* \`${url}\`\n\n`;
                filtered.forEach((v, i) => {
                    listMsg += `${i + 1}. *[${v.title}]* - (Time: ${v.duration})\n\n`;
                });
                listMsg += `👉 Reply with the number (1-10) to initiate the High-Speed Download, Master.`;

                const sentMsg = await sock.sendMessage(from, { text: listMsg });
                await sendReact(sock, from, msg, '✅');
                userSearches.set(sentMsg.key.id, filtered);
                setTimeout(() => userSearches.delete(sentMsg.key.id), 600000);
                return true;
            }

            // Direct File Downloader
            await sendReact(sock, from, msg, '⚡');
            await sock.sendPresenceUpdate('recording', from); // Simulates recording while downloading heavy payloads
            await downloadCompressAndSend(sock, from, url, siteName, q);
            await sendReact(sock, from, msg, '✅');
            return true;
        }
    }

    // Global Search
    if (lower.startsWith('.search ') || lower.startsWith('.s ')) {
        const q = lower.replace(/^\.(search|s)\s+/i, '').trim();
        if (!q) return await sock.sendMessage(from, { text: '🔍 Provide a keyword to search, Master! / සෙවීමට වචනය ලබා දෙන්න!' });

        await sendReact(sock, from, msg, '🔍');
        await sock.sendPresenceUpdate('composing', from);
        await sock.sendMessage(from, { text: `🔍 Locating targets for "${q}"... / සොයමින් පවතී...` });
        const r = await multiSiteSearch(q);

        if (!r.length) return await sock.sendMessage(from, { text: '❌ No results found, Master. / ප්‍රතිඵල හමු නොවීය.' });

        let msgBlock = `🔎 *Search Results for / සෙවුම් ප්‍රතිඵල:* \`${q}\` \n\n`;
        r.forEach((v, i) => msgBlock += `${i + 1}. *[${v.site}]* ${v.title} (Time: ${v.duration})\n🔗 \`${v.url}\`\n\n`);
        msgBlock += '📥 Download ( Ex: .yt / .ph / .xv ) <link>';

        await sock.sendMessage(from, { text: msgBlock });
        await sendReact(sock, from, msg, '✅');
        return true;
    }

    // Dedicated XNXX Top 10 Search (.xnx)
    if (lower.startsWith('.xnx ') && !lower.startsWith('.xnxx ')) {
        const q = lower.replace('.xnx ', '').trim();
        if (!q) return await sock.sendMessage(from, { text: '🔍 Please provide a keyword for .xnx search!' });

        await sendReact(sock, from, msg, '🔍');
        await sock.sendPresenceUpdate('composing', from);
        await sock.sendMessage(from, { text: `🔍 Fetching top 10 relevant results from XNXX for "${q}"...` });
        try {
            const { data } = await axios.get(`https://www.xnxx.com/search/${encodeURIComponent(q)}`);
            const $ = cheerio.load(data);
            const results = [];

            $('.thumb-block').slice(0, 10).each((_, el) => {
                const titleEl = $(el).find('.title a');
                const title = titleEl.attr('title') || titleEl.text().trim();
                const href = titleEl.attr('href');
                if (title && href) {
                    const url = href.startsWith('http') ? href : `https://www.xnxx.com${href}`;
                    const duration = $(el).find('.duration').text().trim() || '?';
                    results.push({ title, url, duration });
                }
            });

            if (!results.length) return await sock.sendMessage(from, { text: '❌ No results found, Master. / ප්‍රතිඵල හමු නොවීය.' });

            let listMsg = `*Top 10 XNXX Results for:* \`${q}\`\n\n`;
            results.forEach((v, i) => {
                listMsg += `${i + 1}. *[${v.title}]* - (Time: ${v.duration})\n\n`;
            });
            listMsg += `👉 Reply with the number (1-10) to initiate the High-Speed Download, Master.`;

            const sentMsg = await sock.sendMessage(from, { text: listMsg });
            await sendReact(sock, from, msg, '✅');
            userSearches.set(sentMsg.key.id, results);
            
            // Auto cleanup memory map after 10 minutes
            setTimeout(() => userSearches.delete(sentMsg.key.id), 600000);
            return true;
        } catch (e) {
            logger(`XNXX custom search fail: ${e.message}`);
            await sendReact(sock, from, msg, '❌');
            return await sock.sendMessage(from, { text: `❌ Search request failed.` });
        }
    }

    return false;
}

async function handleSticker(sock, msg, from) {
    try {
        const isQuotedImage = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
        const isQuotedVideo = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
        const isImage = msg.message.imageMessage;
        const isVideo = msg.message.videoMessage;

        let targetMessage = isQuotedImage || isQuotedVideo;
        let type = isQuotedImage ? 'image' : isQuotedVideo ? 'video' : null;

        if (!targetMessage) {
            targetMessage = isImage || isVideo;
            type = isImage ? 'image' : isVideo ? 'video' : null;
        }

        if (!targetMessage) {
            return await sock.sendMessage(from, { text: '⚠️ Please reply to an image/video to make a sticker, Master!' });
        }

        await sock.sendMessage(from, { text: '🎨 Executing Sticker Protocol...' });

        const stream = await downloadContentFromMessage(targetMessage, type);
        let buffer = Buffer.from([]);
        for await(const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const tmpInput = path.join(os.tmpdir(), `input_${Date.now()}.${type === 'image' ? 'jpg' : 'mp4'}`);
        const tmpOutput = path.join(os.tmpdir(), `output_${Date.now()}.webp`);
        fs.writeFileSync(tmpInput, buffer);

        await new Promise((resolve, reject) => {
            let ff = ffmpeg(tmpInput)
                .on('end', resolve)
                .on('error', reject)
                .addOutputOptions([
                    '-vcodec libwebp',
                    '-vf scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000'
                ])
                .toFormat('webp');

            if (type === 'video') {
                ff.addOutputOptions(['-loop 0', '-preset default', '-an', '-vsync 0']);
            }
            ff.save(tmpOutput);
        });

        const stickerData = fs.readFileSync(tmpOutput);
        await sock.sendMessage(from, { sticker: stickerData });

        if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput);
        if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
    } catch (e) {
        logger(`Sticker Error: ${e.message}`);
        await sock.sendMessage(from, { text: `❌ Sticker generation failed: ${e.message}` });
    }
}

module.exports = { processMessage, handleSticker };