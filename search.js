const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const YTDlpWrap = require('yt-dlp-wrap').default;
const { logger } = require('./logger');

// Use the correct Linux binary
const ytdlpPath = path.join(__dirname, 'yt-dlp-linux');
const ytdlp = new YTDlpWrap(ytdlpPath);

const ADULT_SITES = [
    {
        name: 'Pornhub',
        url: q => `https://www.pornhub.com/video/search?search=${encodeURIComponent(q)}`,
        sel: '.pcVideoListItem',
        title: '.title a',
        href: '.title a',
        dur: '.duration',
        base: 'https://www.pornhub.com'
    },
    {
        name: 'XVideos',
        url: q => `https://www.xvideos.com/?k=${encodeURIComponent(q)}`,
        sel: '.thumb-block',
        title: '.title a',
        href: '.title a',
        dur: '.duration',
        base: 'https://www.xvideos.com'
    },
    {
        name: 'XNXX',
        url: q => `https://www.xnxx.com/search/${encodeURIComponent(q)}`,
        sel: '.thumb-block',
        title: '.title a',
        href: '.title a',
        dur: '.duration',
        base: 'https://www.xnxx.com'
    },
    {
        name: 'xHamster',
        url: q => `https://xhamster.com/search/${encodeURIComponent(q)}`,
        sel: '.video-thumb',
        title: '.video-thumb__image-container',
        href: '.video-thumb__image-container',
        dur: '.thumb-image-container__duration',
        base: 'https://xhamster.com'
    },
    {
        name: 'YouPorn',
        url: q => `https://www.youporn.com/search?query=${encodeURIComponent(q)}`,
        sel: '.video-list-item',
        title: '.video-title a',
        href: '.video-title a',
        dur: '.duration',
        base: 'https://www.youporn.com'
    },
    {
        name: 'SpankBang',
        url: q => `https://spankbang.com/s/${encodeURIComponent(q)}/`,
        sel: '.video-item',
        title: '.n a',
        href: '.n a',
        dur: '.l',
        base: 'https://spankbang.com'
    },
    {
        name: 'RedTube',
        url: q => `https://www.redtube.com/?search=${encodeURIComponent(q)}`,
        sel: '.video_link_container',
        title: '.video_title_text',
        href: 'a',
        dur: '.duration_label',
        base: 'https://www.redtube.com'
    }
];

async function scrapeAdultSite(site, query, max = 10) {
    try {
        const { data } = await axios.get(site.url(query), {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        const $ = cheerio.load(data);
        const results = [];

        $(site.sel).slice(0, max).each((_, el) => {
            const titleEl = $(el).find(site.title);
            const hrefEl = $(el).find(site.href);
            const title = titleEl.attr('title') || titleEl.text().trim();
            let href = hrefEl.attr('href');

            if (title && href) {
                const url = href.startsWith('http') ? href : `${site.base}${href}`;
                const duration = $(el).find(site.dur).first().text().trim() || '?';
                const thumb = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
                results.push({ title: title.trim(), url, duration, thumb, site: site.name });
            }
        });
        return results;
    } catch (e) {
        if (!e.message.includes('403') && !e.message.includes('timeout')) {
            logger(`${site.name} search fail: ${e.message}`);
        }
        return [];
    }
}

async function searchYouTube(query, max = 10) {
    try {
        const ytOut = await ytdlp.execPromise([
            `ytsearch${max}:${query}`,
            '--dump-json',
            '--no-playlist',
            '--quiet',
            '--no-warnings'
        ]);
        const lines = ytOut.trim().split('\n').filter(Boolean);
        return lines.map(line => {
            try {
                const v = JSON.parse(line);
                let dur = v.duration_string;
                if (!dur && v.duration) {
                    const m = Math.floor(v.duration / 60);
                    const s = String(v.duration % 60).padStart(2, '0');
                    dur = `${m}:${s}`;
                }
                return {
                    title: v.title,
                    url: v.webpage_url || v.original_url,
                    duration: dur || '?',
                    thumb: v.thumbnail || '',
                    site: 'YouTube'
                };
            } catch { return null; }
        }).filter(Boolean);
    } catch (e) {
        logger(`YouTube search fail: ${e.message}`);
        return [];
    }
}

// Search specific adult site only
async function searchSite(siteName, query, max = 10) {
    const site = ADULT_SITES.find(s => s.name.toLowerCase() === siteName.toLowerCase());
    if (!site) return [];
    return await scrapeAdultSite(site, query, max);
}

// Search all adult sites
async function searchAllAdult(query, max = 10) {
    const tasks = ADULT_SITES.map(s => scrapeAdultSite(s, query, 3));
    const settled = await Promise.allSettled(tasks);
    const all = settled.flatMap(r => r.value || []);
    return all.slice(0, max);
}

// Legacy: search all sites (adult + YouTube mixed) — kept for backward compat
async function multiSiteSearch(query, maxPerSite = 5) {
    const [ytResults, adultResults] = await Promise.all([
        searchYouTube(query, 3),
        searchAllAdult(query, 10)
    ]);
    return [...ytResults, ...adultResults];
}

module.exports = { multiSiteSearch, searchYouTube, searchSite, searchAllAdult };
