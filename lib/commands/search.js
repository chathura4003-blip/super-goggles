const { searchYouTube, searchSite, searchAllAdult } = require('../../search');
const { sendReact, presenceUpdate } = require('../utils');
const { storeSearchResults } = require('../handler');
const axios = require('axios');

// Number emojis for clean list display
const NUM_EMOJI = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

function truncate(str, max = 50) {
    return str && str.length > max ? str.slice(0, max - 1) + '…' : (str || 'Unknown');
}

function formatResults(results, query, emoji, label) {
    let msg = `${emoji} *${label}*\n`;
    msg += `🔍 Search: _${query}_\n`;
    msg += `${'─'.repeat(28)}\n\n`;
    msg += `🎥 *RESULTS:*\n`;
    results.forEach((v, i) => {
        msg += `${NUM_EMOJI[i] || `${i + 1}.`} ${truncate(v.title)} _(${v.duration || '?'})_\n`;
    });
    msg += `\n${'─'.repeat(28)}\n`;
    msg += `👉 *Reply 1–${results.length} or use menu below*`;
    return msg;
}

const ADULT_SITE_MAP = {
    'phsearch': 'Pornhub',
    'xnxx': 'XNXX',
    'xvsearch': 'XVideos',
    'xhsearch': 'xHamster',
    'ypsearch': 'YouPorn',
    'sbsearch': 'SpankBang',
    'rtsearch': 'RedTube',
};

module.exports = {
    name: 'search',
    aliases: [
        'yts', 'g', 'wiki',
        'phsearch', 'xnxx', 'xvsearch', 'xhsearch',
        'ypsearch', 'sbsearch', 'rtsearch',
        'ttsearch', 'igsearch', 'pinsearch', 'reddit'
    ],
    description: 'Advanced search engine with clean UI',
    async execute(sock, msg, from, args) {
        const q = args.join(' ');
        if (!q) return await sock.sendMessage(from, { text: '🔍 Please provide a keyword, Master!' });

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const command = text.toLowerCase().trim().split(' ')[0].slice(1);
        const sender = msg.key.participant || msg.key.remoteJid;

        await sendReact(sock, from, msg, '🔍');
        await presenceUpdate(sock, from, 'composing');

        try {
            // ── YouTube Search ──────────────────────────────────────────
            if (command === 'yts') {
                const results = await searchYouTube(q, 10);
                if (!results.length) {
                    return await sock.sendMessage(from, { text: `❌ No YouTube results for "${q}", Master.` });
                }

                const listMsg = formatResults(results, q, '▶️', 'YouTube Search');
                await sock.sendMessage(from, {
                    text: listMsg
                });
                storeSearchResults(msg?.key?.id, sender, results);
                await sendReact(sock, from, msg, '✅');
                return;
                await sendReact(sock, from, msg, '✅');
                return;
            }

            // ── Adult Site-Specific Search ──────────────────────────────
            const adultSite = ADULT_SITE_MAP[command];
            if (adultSite) {
                const results = await searchSite(adultSite, q, 10);
                if (!results.length) {
                    return await sock.sendMessage(from, {
                        text: `🔞 No *${adultSite}* results for "${q}", Master.\n\n_The site may be blocking requests. Try again shortly._`
                    });
                }

                const listMsg = formatResults(results, q, '🔞', `${adultSite} Search`);
                await sock.sendMessage(from, {
                    text: listMsg
                });
                storeSearchResults(msg?.key?.id, sender, results);
                await sendReact(sock, from, msg, '✅');
                return;
                await sendReact(sock, from, msg, '✅');
                return;
            }

            // ── Google / DuckDuckGo ─────────────────────────────────────
            if (command === 'g') {
                const { data: ddg } = await axios.get(
                    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json`
                ).catch(() => ({ data: {} }));
                const answer = ddg?.AbstractText || ddg?.Answer || '';
                const related = ddg?.RelatedTopics?.slice(0, 5) || [];

                let reply = `🌐 *Google / DuckDuckGo*\n🔍 Search: _${q}_\n${'─'.repeat(28)}\n\n`;
                if (answer) reply += `📋 *Summary:*\n${answer}\n\n`;
                if (related.length) {
                    reply += `🔗 *Related:*\n`;
                    related.forEach(r => {
                        if (r.Text) reply += `• ${truncate(r.Text, 80)}\n`;
                    });
                }
                if (!answer && !related.length) {
                    reply += `_No instant answer found. Try .wiki ${q}_`;
                }
                return await sock.sendMessage(from, { text: reply });
            }

            // ── Wikipedia ───────────────────────────────────────────────
            if (command === 'wiki') {
                const { data } = await axios.get(
                    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`
                );
                const reply =
`📖 *Wikipedia: ${data.title}*
${'─'.repeat(28)}

${data.extract || 'No summary available.'}

🔗 ${data.content_urls?.desktop?.page || ''}`;
                return await sock.sendMessage(from, { text: reply });
            }

            // ── Reddit ──────────────────────────────────────────────────
            if (command === 'reddit') {
                const { data } = await axios.get(
                    `https://www.reddit.com/r/${encodeURIComponent(q)}/hot.json?limit=8`,
                    { headers: { 'User-Agent': 'SupremeBot/2.0' } }
                );
                const posts = data?.data?.children || [];
                if (!posts.length) return await sock.sendMessage(from, { text: `❌ No posts in r/${q}, Master.` });

                let reply = `🔴 *Reddit — r/${q}*\n${'─'.repeat(28)}\n\n`;
                posts.slice(0, 8).forEach((p, i) => {
                    const post = p.data;
                    reply += `${NUM_EMOJI[i] || `${i + 1}.`} *${truncate(post.title, 60)}*\n`;
                    reply += `   👍 ${post.ups} | 💬 ${post.num_comments}\n\n`;
                });
                return await sock.sendMessage(from, { text: reply });
            }

            // ── Pinterest ────────────────────────────────────────────────
            if (command === 'pinsearch') {
                return await sock.sendMessage(from, {
                    text: `📌 *Pinterest Search:* "${q}"\n\n🔗 https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}\n\n_Open the link in your browser, Master._`
                });
            }

            // ── General (mixed) search ────────────────────────────────
            const [ytResults, adultResults] = await Promise.all([
                searchYouTube(q, 5),
                searchAllAdult(q, 5)
            ]);
            const allResults = [...ytResults, ...adultResults].slice(0, 10);
            if (!allResults.length) {
                return await sock.sendMessage(from, { text: `❌ No results found for "${q}", Master.` });
            }

            const listMsg = formatResults(allResults, q, '🔎', 'Multi-Site Search');
            await sock.sendMessage(from, {
                text: listMsg
            });
            storeSearchResults(msg?.key?.id, sender, allResults);
            await sendReact(sock, from, msg, '✅');
            await sendReact(sock, from, msg, '✅');

        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            await sock.sendMessage(from, { text: `❌ Search error: ${e.message}` });
        }
    }
};
