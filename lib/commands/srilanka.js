'use strict';
/**
 * Sri Lanka Movie / Drama Downloader
 * Supports: baiscope.lk · piranhabb.com · zonalk.com · sinhalafilm.lk
 *           lankatv.net  · helakuru.lk  · lk21.lk  · sinhalazone.com
 *
 * Commands:
 *   .slmovie <url>       — extract & download from an SL site page
 *   .slmovie <keyword>   — search SL movie sites and list results
 *   Aliases: slfilm · sldrama · slmv · baiscp · piranha · slsearch
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const path    = require('path');
const { downloadCompressAndSend } = require('../../downloader');
const { sendReact, presenceUpdate } = require('../utils');
const { storeSearchResults, showQualityButtons } = require('../handler');

const NUM_EMOJI = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

// ── Supported SL streaming sites ─────────────────────────────────────────────
const SL_SITES = [
    'baiscope.lk',
    'baiscopelk.net',
    'piranhabb.com',
    'piranha.lk',
    'zonalk.com',
    'zonalanka.com',
    'sinhalafilm.lk',
    'lankatv.net',
    'helakuru.lk',
    'lk21.lk',
    'sinhalazone.com',
    'sinhalateledrama.net',
    'lankasinhala.com',
    'sinhalawall.com',
];

// Headers that mimic a real browser (most SL sites block bots)
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'si-LK,si;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': 'https://www.google.com/',
};

// ── Extract video URL(s) from a page ─────────────────────────────────────────
async function extractVideoUrl(pageUrl) {
    const resp = await axios.get(pageUrl, { headers: HEADERS, timeout: 15000 });
    const html = resp.data;
    const $    = cheerio.load(html);

    const candidates = [];

    // 1. iframes (YouTube, Facebook, Dailymotion, Streamtape, etc.)
    $('iframe').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        if (src && src.startsWith('http')) candidates.push(src);
    });

    // 2. <video> and <source> tags with direct mp4/m3u8
    $('video source, video').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        if (src && (src.includes('.mp4') || src.includes('.m3u8') || src.includes('.webm'))) {
            candidates.push(src);
        }
    });

    // 3. JS variables with video URLs (jwplayer, videojs setups)
    const scriptText = $('script').map((_, el) => $(el).html()).get().join('\n');
    const patterns = [
        /file\s*:\s*["']([^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/gi,
        /source\s*:\s*["']([^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/gi,
        /["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/gi,
        // Embed helpers for common hosters
        /embed\.dailymotion\.com\/video\/([a-zA-Z0-9]+)/,
        /streamtape\.com\/e\/([a-zA-Z0-9]+)/,
        /doodstream\.com\/e\/([a-zA-Z0-9]+)/,
        /mega\.nz\/#(?:!|F!)([a-zA-Z0-9_-]+)/,
    ];

    for (const pat of patterns) {
        let m;
        pat.lastIndex = 0;
        while ((m = pat.exec(scriptText)) !== null) {
            const u = m[1].startsWith('http') ? m[1] : null;
            if (u) candidates.push(u);
        }
    }

    // 4. Open Graph video
    const ogVideo = $('meta[property="og:video"]').attr('content') ||
                    $('meta[property="og:video:url"]').attr('content');
    if (ogVideo) candidates.push(ogVideo);

    // De-duplicate and prefer YouTube/Facebook (most reliable)
    const unique = [...new Set(candidates)].filter(Boolean);
    const ytFb   = unique.filter(u => /youtube\.com|youtu\.be|fb\.watch|facebook\.com\/watch/i.test(u));
    const direct = unique.filter(u => /\.(mp4|m3u8|webm)/i.test(u));
    const others = unique.filter(u => !ytFb.includes(u) && !direct.includes(u));

    return ytFb[0] || direct[0] || others[0] || null;
}

// ── DuckDuckGo search restricted to SL movie sites ───────────────────────────
async function searchSLMovies(keyword, limit = 8) {
    const siteFilter = SL_SITES.map(s => `site:${s}`).join(' OR ');
    const query      = `${keyword} ${siteFilter}`;
    const url        = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    try {
        const resp = await axios.get(url, { headers: HEADERS, timeout: 12000 });
        const $    = cheerio.load(resp.data);
        const results = [];

        $('.result__body').each((_, el) => {
            if (results.length >= limit) return;
            const title = $(el).find('.result__title').text().trim();
            const href  = $(el).find('.result__url').attr('href') ||
                          $(el).find('.result__title a').attr('href') || '';
            const snip  = $(el).find('.result__snippet').text().trim();
            if (title && href) {
                let link = href;
                // DuckDuckGo wraps links
                if (link.startsWith('//')) link = 'https:' + link;
                if (!link.startsWith('http')) return;
                results.push({ title, url: link, description: snip, source: 'SL Sites' });
            }
        });

        return results;
    } catch {
        return [];
    }
}

// ── Get page title as fallback metadata ──────────────────────────────────────
async function getPageTitle(url) {
    try {
        const resp = await axios.get(url, { headers: HEADERS, timeout: 10000 });
        const $    = cheerio.load(resp.data);
        return $('title').text().trim() ||
               $('meta[property="og:title"]').attr('content') ||
               'Unknown Title';
    } catch {
        return 'Unknown Title';
    }
}

// ── Command ───────────────────────────────────────────────────────────────────
module.exports = {
    name: 'slmovie',
    aliases: ['slfilm', 'sldrama', 'slmv', 'baiscp', 'piranha', 'slsearch'],
    description: 'Download movies/dramas from Sri Lankan websites',
    category: 'Downloader',

    async execute(sock, msg, from, args) {
        const sender  = msg.key.participant || msg.key.remoteJid;
        const rawArgs = args.join(' ').trim();

        if (!rawArgs) {
            return sock.sendMessage(from, {
                text: `🇱🇰 *Sri Lanka Movie Downloader*\n${'─'.repeat(32)}\n\n` +
                      `*Usage:*\n` +
                      `▸ *.slmovie <url>* — paste any SL site link\n` +
                      `▸ *.slmovie <keyword>* — search across SL movie sites\n\n` +
                      `*Supported sites:*\n` +
                      `baiscope.lk · piranhabb.com · zonalk.com\n` +
                      `sinhalafilm.lk · lankatv.net · helakuru.lk\n` +
                      `lk21.lk · sinhalazone.com + more\n\n` +
                      `*Aliases:* .slfilm · .sldrama · .slmv · .baiscp · .piranha`
            });
        }

        const isUrl = /^https?:\/\//i.test(rawArgs);

        // ── URL mode ──────────────────────────────────────────────────────────
        if (isUrl) {
            await sendReact(sock, from, msg, '🔍');
            await presenceUpdate(sock, from, 'composing');

            const pageTitle = await getPageTitle(rawArgs);
            await sock.sendMessage(from, {
                text: `🇱🇰 *Extracting video...*\n📄 *Page:* ${pageTitle.slice(0, 60)}`
            });

            let videoUrl = null;
            try {
                videoUrl = await extractVideoUrl(rawArgs);
            } catch (e) {
                // If scraping failed, try yt-dlp directly on the URL
            }

            if (!videoUrl) {
                // Try yt-dlp directly — it knows many SL streaming platforms
                videoUrl = rawArgs;
            }

            await sock.sendMessage(from, {
                text: `⬇️ *Downloading...*\n🔗 Source: ${videoUrl.slice(0, 80)}`
            });

            try {
                await downloadCompressAndSend(sock, from, videoUrl, 'SL Sites', 'sd', false);
                await sendReact(sock, from, msg, '✅');
            } catch (e) {
                await sendReact(sock, from, msg, '❌');
                await sock.sendMessage(from, {
                    text: `❌ *Download failed*\n\n_${e.message}_\n\n` +
                          `💡 Try with a direct video link, or the page may use DRM/sign-in protection.`
                });
            }
            return;
        }

        // ── Keyword search mode ───────────────────────────────────────────────
        await sendReact(sock, from, msg, '🔍');
        await presenceUpdate(sock, from, 'composing');
        await sock.sendMessage(from, {
            text: `🔍 *Searching SL sites for:* _${rawArgs}_\n⏳ Please wait...`
        });

        try {
            const results = await searchSLMovies(rawArgs, 10);

            if (!results.length) {
                await sendReact(sock, from, msg, '❌');
                return sock.sendMessage(from, {
                    text: `❌ No results found for "*${rawArgs}*" on Sri Lankan movie sites.\n\n` +
                          `💡 Try a different keyword or paste a direct URL from baiscope.lk etc.`
                });
            }

            let listMsg = `🇱🇰 *Sri Lanka Movie Search*\n`;
            listMsg += `🔍 Query: _${rawArgs}_\n`;
            listMsg += `${'─'.repeat(30)}\n\n`;
            results.slice(0, 10).forEach((r, i) => {
                const short = r.title.length > 52 ? r.title.slice(0, 50) + '…' : r.title;
                listMsg += `${NUM_EMOJI[i] || `${i+1}.`} *${short}*\n`;
                if (r.description) listMsg += `   _${r.description.slice(0, 60)}_\n`;
                listMsg += `\n`;
            });
            listMsg += `${'─'.repeat(30)}\n`;
            listMsg += `👉 *Reply with a number* to get the download link\n`;
            listMsg += `_Or paste the URL with .slmovie <link>_`;

            await sock.sendMessage(from, { text: listMsg });
            storeSearchResults(msg?.key?.id, sender, results.slice(0, 10));
            await sendReact(sock, from, msg, '✅');

        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            await sock.sendMessage(from, { text: `❌ Search error: ${e.message}` });
        }
    }
};
