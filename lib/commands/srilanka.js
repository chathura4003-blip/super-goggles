'use strict';
/**
 * Sri Lanka Movie / Drama Downloader  (v2 — robust multi-strategy)
 *
 * Strategy:
 *   1. Try yt-dlp directly on the page URL (covers YouTube, FB, Dailymotion, etc.)
 *   2. Fetch page HTML → extract iframe / video / script-embedded URLs
 *   3. Try yt-dlp on each extracted URL (Streamtape, Doodstream, Filemoon, Voe…)
 *   4. Keyword mode → DuckDuckGo search restricted to SL sites → numbered list
 *
 * Commands: .slmovie  .slfilm  .sldrama  .slmv  .baiscp  .piranha  .slsearch
 */

const path    = require('path');
const axios   = require('axios');
const cheerio = require('cheerio');
const YTDlpWrap = require('yt-dlp-wrap').default;

const { downloadCompressAndSend } = require('../../downloader');
const { sendReact, presenceUpdate } = require('../utils');
const { storeSearchResults } = require('../handler');
const { logger } = require('../../logger');

const ytdlpPath = path.join(__dirname, '../../yt-dlp-linux');
const ytdlp     = new YTDlpWrap(ytdlpPath);

// ── Known video hosters that yt-dlp can download ────────────────────────────
const KNOWN_HOSTERS = [
    'youtube.com', 'youtu.be',
    'facebook.com', 'fb.watch', 'fb.com',
    'dailymotion.com', 'dai.ly',
    'streamtape.com', 'streamtape.to', 'streamtape.net', 'streamtape.co', 'streamtape.xyz',
    'doodstream.com', 'dood.watch', 'dood.to', 'doodstream.to', 'doodstream.co', 'dood.re',
    'filemoon.sx', 'filemoon.to', 'filemoon.in', 'fmoonembed.com', 'filemoon.cc',
    'voe.sx',
    'streamlare.com',
    'mixdrop.co', 'mixdrop.to',
    'upstream.to',
    'mp4upload.com',
    'vidcloud.co', 'vidcloud.icu',
    'fembed.com',
    'ok.ru',
    'mega.nz', 'mega.co.nz',
];

// ── Browser-like headers to bypass basic bot protection ─────────────────────
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'si-LK,si;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': 'https://www.google.com/',
    'Cache-Control': 'no-cache',
};

// ── Supported SL sites for search ────────────────────────────────────────────
const SL_SITES = [
    'baiscope.lk', 'baiscopelk.net',
    'piranhabb.com', 'piranha.lk',
    'zonalk.com', 'zonalanka.com',
    'sinhalafilm.lk', 'lankatv.net',
    'helakuru.lk', 'lk21.lk',
    'sinhalazone.com', 'sinhalateledrama.net',
    'lankasinhala.com', 'sinhalawall.com',
];

const NUM_EMOJI = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

// ── Check if a domain is a known video hoster ────────────────────────────────
function isKnownHoster(url) {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return KNOWN_HOSTERS.some(h => host === h || host.endsWith('.' + h));
    } catch { return false; }
}

// ── Test if yt-dlp can fetch info for a URL ──────────────────────────────────
async function ytdlpCanHandle(url) {
    try {
        await ytdlp.execPromise([
            url,
            '--no-playlist',
            '--no-check-certificate',
            '--dump-json',
            '--quiet',
            '--no-warnings',
            '--socket-timeout', '15',
        ]);
        return true;
    } catch {
        return false;
    }
}

// ── Scrape a page and return candidate video URLs ────────────────────────────
async function scrapeVideoUrls(pageUrl) {
    let html = '';
    try {
        const resp = await axios.get(pageUrl, {
            headers: HEADERS,
            timeout: 18000,
            maxRedirects: 5,
        });
        html = resp.data || '';
    } catch (e) {
        throw new Error(`Could not fetch page: ${e.message}`);
    }

    const $ = cheerio.load(html);
    const candidates = new Set();

    // 1. Iframe src / data-src / data-lazy-src
    $('iframe, frame').each((_, el) => {
        for (const attr of ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-url']) {
            const src = $(el).attr(attr) || '';
            if (src && src.startsWith('http')) candidates.add(src);
        }
    });

    // 2. <video> and <source> tags
    $('video, source').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        if (src && src.startsWith('http')) candidates.add(src);
    });

    // 3. Open Graph video meta
    ['og:video', 'og:video:url', 'og:video:secure_url'].forEach(prop => {
        const val = $(`meta[property="${prop}"]`).attr('content');
        if (val && val.startsWith('http')) candidates.add(val);
    });

    // 4. Script-embedded video URLs (JW Player, Video.js, custom hosters)
    const scriptContent = $('script:not([src])').map((_, el) => $(el).html()).get().join('\n');

    const scriptPatterns = [
        // Generic file/source strings
        /["']file["']\s*:\s*["']([^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/gi,
        /["']source["']\s*:\s*["']([^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/gi,
        /["']src["']\s*:\s*["']([^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/gi,
        // Direct http URL strings pointing to video
        /["'](https?:\/\/[^"'\s]+\.(?:mp4|m3u8|webm)[^"'\s]*)["']/gi,
        // Streamtape embed
        /["'](https?:\/\/streamtape\.[a-z]+\/e\/[A-Za-z0-9_-]+[^"']*)["']/gi,
        // Doodstream embed
        /["'](https?:\/\/(?:dood|doodstream)\.[a-z]+\/e\/[A-Za-z0-9_-]+[^"']*)["']/gi,
        // Filemoon embed
        /["'](https?:\/\/filemoon\.[a-z]+\/e\/[A-Za-z0-9_-]+[^"']*)["']/gi,
        // Voe embed
        /["'](https?:\/\/voe\.sx\/e\/[A-Za-z0-9_-]+[^"']*)["']/gi,
    ];

    for (const pat of scriptPatterns) {
        let m;
        pat.lastIndex = 0;
        while ((m = pat.exec(scriptContent)) !== null) {
            const u = m[1];
            if (u && u.startsWith('http')) candidates.add(u);
        }
    }

    // 5. Also check inline onclick / data-embed attrs
    $('[data-embed], [data-video], [data-src-video]').each((_, el) => {
        for (const attr of ['data-embed', 'data-video', 'data-src-video', 'data-iframe']) {
            const val = $(el).attr(attr) || '';
            if (val && val.startsWith('http')) candidates.add(val);
        }
    });

    const all = [...candidates].filter(Boolean);

    // Sort: known hosters first, then direct mp4/m3u8, then the rest
    const known  = all.filter(u => isKnownHoster(u));
    const direct = all.filter(u => !isKnownHoster(u) && /\.(mp4|m3u8|webm)/i.test(u));
    const others = all.filter(u => !isKnownHoster(u) && !/\.(mp4|m3u8|webm)/i.test(u));

    return [...known, ...direct, ...others];
}

// ── Get page title ────────────────────────────────────────────────────────────
async function getPageTitle(url) {
    try {
        const r = await axios.get(url, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(r.data);
        return $('title').text().trim() ||
               $('meta[property="og:title"]').attr('content') ||
               'Unknown Title';
    } catch { return 'Unknown Title'; }
}

// ── Search SL movie sites via DuckDuckGo ─────────────────────────────────────
async function searchSLMovies(keyword, limit = 8) {
    const siteFilter = SL_SITES.slice(0, 6).map(s => `site:${s}`).join(' OR ');
    const q    = `${keyword} sinhala movie ${siteFilter}`;
    const url  = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    try {
        const resp = await axios.get(url, { headers: HEADERS, timeout: 14000 });
        const $    = cheerio.load(resp.data);
        const results = [];
        $('.result__body').each((_, el) => {
            if (results.length >= limit) return;
            const title = $(el).find('.result__title').text().trim();
            let href    = $(el).find('.result__title a').attr('href') ||
                          $(el).find('.result__url').attr('href') || '';
            const snip  = $(el).find('.result__snippet').text().trim().slice(0, 80);
            if (!title || !href) return;
            if (href.startsWith('//')) href = 'https:' + href;
            if (!href.startsWith('http')) return;
            results.push({ title, url: href, description: snip, source: 'SL Sites' });
        });
        return results;
    } catch { return []; }
}

// ── Main command ──────────────────────────────────────────────────────────────
module.exports = {
    name: 'slmovie',
    aliases: ['slfilm', 'sldrama', 'slmv', 'baiscp', 'piranha', 'slsearch'],
    description: 'Download movies/dramas from Sri Lankan websites',
    category: 'Downloader',

    async execute(sock, msg, from, args) {
        const sender  = msg.key.participant || msg.key.remoteJid;
        const rawArgs = args.join(' ').trim();

        // ── No input: show usage ──────────────────────────────────────────────
        if (!rawArgs) {
            return sock.sendMessage(from, {
                text:
`🇱🇰 *Sri Lanka Movie / Drama Downloader*
${'─'.repeat(32)}

*Usage:*
▸ *.slmovie <url>* — paste any SL site link
▸ *.slmovie <keyword>* — search across SL movie sites

*Supported sites:*
baiscope.lk · piranhabb.com · zonalk.com
sinhalafilm.lk · lankatv.net · helakuru.lk
lk21.lk · sinhalazone.com + more

*Aliases:* .slfilm · .sldrama · .slmv · .baiscp · .piranha`
            });
        }

        const isUrl = /^https?:\/\//i.test(rawArgs);

        // ── URL mode ──────────────────────────────────────────────────────────
        if (isUrl) {
            await sendReact(sock, from, msg, '🔍');
            await presenceUpdate(sock, from, 'composing');

            const pageTitle = await getPageTitle(rawArgs);
            await sock.sendMessage(from, {
                text: `🇱🇰 *Analysing page...*\n📄 ${pageTitle.slice(0, 70)}\n⏳ This may take 15–30 seconds...`
            });

            // ── Step 1: yt-dlp directly on the page ──────────────────────────
            let downloadUrl = null;
            let strategy    = '';

            const directOk = await ytdlpCanHandle(rawArgs);
            if (directOk) {
                downloadUrl = rawArgs;
                strategy    = 'direct';
                logger(`[SL] yt-dlp handled ${rawArgs} directly`);
            }

            // ── Step 2: Scrape page for video URLs ────────────────────────────
            if (!downloadUrl) {
                let candidates = [];
                try {
                    candidates = await scrapeVideoUrls(rawArgs);
                    logger(`[SL] Scraped ${candidates.length} candidate URL(s) from page`);
                } catch (e) {
                    logger(`[SL] Scrape error: ${e.message}`);
                }

                for (const candidate of candidates.slice(0, 6)) {
                    const ok = await ytdlpCanHandle(candidate);
                    if (ok) {
                        downloadUrl = candidate;
                        strategy    = 'embedded';
                        logger(`[SL] yt-dlp can handle embedded URL: ${candidate}`);
                        break;
                    }
                }

                // ── Step 3: Fallback — first candidate regardless of yt-dlp check ──
                if (!downloadUrl && candidates.length) {
                    downloadUrl = candidates[0];
                    strategy    = 'fallback';
                    logger(`[SL] Fallback to first candidate: ${downloadUrl}`);
                }
            }

            if (!downloadUrl) {
                await sendReact(sock, from, msg, '❌');
                return sock.sendMessage(from, {
                    text:
`❌ *Could not extract a video from this page.*

Possible reasons:
• Video is behind a login / paywall
• Site uses advanced JS-only loading (we can't render JS)
• Video is DRM-protected

💡 *Tips:*
• Try opening the page, find the actual video player URL, and paste that
• Try searching: *.slmovie <movie title>* to find a working link`
                });
            }

            await sock.sendMessage(from, {
                text: `⬇️ *Downloading...*\n🔗 ${strategy === 'direct' ? 'Direct page download' : 'Found embedded video'}\n⏳ Please wait...`
            });

            try {
                await downloadCompressAndSend(sock, from, downloadUrl, 'SL Sites', 'sd', false);
                await sendReact(sock, from, msg, '✅');
            } catch (e) {
                await sendReact(sock, from, msg, '❌');
                await sock.sendMessage(from, {
                    text:
`❌ *Download failed*

Error: _${e.message.slice(0, 200)}_

💡 The video host may require a direct video link.
Try: find the iframe player URL inside the page and paste it with *.slmovie <iframe_url>*`
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
                    text:
`❌ No results found for "*${rawArgs}*" on Sri Lankan movie sites.

💡 Tips:
• Try Sinhala spelling or English title
• Paste a direct URL from baiscope.lk, piranhabb.com, etc.`
                });
            }

            let listMsg = `🇱🇰 *Sri Lanka Movie Search*\n`;
            listMsg += `🔍 _${rawArgs}_\n${'─'.repeat(30)}\n\n`;
            results.slice(0, 10).forEach((r, i) => {
                const t = r.title.length > 55 ? r.title.slice(0, 53) + '…' : r.title;
                listMsg += `${NUM_EMOJI[i] || `${i+1}.`} *${t}*\n`;
                if (r.description) listMsg += `   _${r.description}_\n`;
                listMsg += `\n`;
            });
            listMsg += `${'─'.repeat(30)}\n`;
            listMsg += `👉 Copy the page link and send:\n*.slmovie <link>*`;

            await sock.sendMessage(from, { text: listMsg });
            storeSearchResults(msg?.key?.id, sender, results.slice(0, 10));
            await sendReact(sock, from, msg, '✅');

        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            await sock.sendMessage(from, { text: `❌ Search error: ${e.message}` });
        }
    }
};
