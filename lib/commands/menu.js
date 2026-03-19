const { BOT_NAME, PREFIX, OWNER_NUMBER } = require('../../config');
const { sendReact } = require('../utils');
const path = require('path');
const os = require('os');

module.exports = {
    name: 'menu',
    aliases: ['help', 'allmenu', 'commands', 'list'],
    description: 'Supreme interactive menu system',
    async execute(sock, msg, from, args) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const command = text.toLowerCase().trim().split(' ')[0].slice(1);

        await sendReact(sock, from, msg, '📜');

        const uptime = process.uptime();
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        const logoPath = path.join(__dirname, '../../supreme_bot_logo.png');

        if (command === 'allmenu' || command === 'list' || command === 'commands') {
            const fullMenu =
                `╔══════════════════════╗
   ✨ ${BOT_NAME} ✨
   PREFIX: [ ${PREFIX} ]  |  UPTIME: ${h}h ${m}m
╚══════════════════════╝

📥 *DOWNLOAD*
${PREFIX}yt <link> [hd/sd/low] — YouTube video
${PREFIX}yta <link> — YouTube audio (MP3)
${PREFIX}tt <link> — TikTok (no watermark)
${PREFIX}ig <link> — Instagram post/reel
${PREFIX}fb <link> — Facebook video
${PREFIX}ph <link/keyword> — Pornhub
${PREFIX}xnxx <link/keyword> — XNXX
${PREFIX}xv <link/keyword> — XVideos
${PREFIX}xh <link/keyword> — xHamster
${PREFIX}yp <link/keyword> — YouPorn
${PREFIX}sb <link/keyword> — SpankBang
${PREFIX}rt <link/keyword> — RedTube

🇱🇰 *SRI LANKA SITES*
${PREFIX}slmovie <link/keyword> — SL movie/drama download
${PREFIX}slfilm  <link/keyword> — (same as slmovie)
${PREFIX}sldrama <link/keyword> — (same as slmovie)


🤖 *AI & TOOLS*
${PREFIX}ai <text> — AI chat assistant
${PREFIX}img <prompt> — AI image generation
${PREFIX}tts <text> — Text to speech
${PREFIX}trt <text> — Translate (Sinhala ↔ English)

👑 *GROUP CONTROL* _(Admin Only)_
${PREFIX}kick @user — Remove member
${PREFIX}add <number> — Add member
${PREFIX}promote @user — Make admin
${PREFIX}demote @user — Remove admin
${PREFIX}lock / ${PREFIX}unlock — Lock/unlock group
${PREFIX}antilink on/off — Anti-link protection
${PREFIX}antibad on/off — Bad word filter

🔞 *NSFW* _(Group Admin Only)_
${PREFIX}nsfw on/off — Enable/disable NSFW
${PREFIX}18+ — Random 18+ image
${PREFIX}hentai — Random hentai image
${PREFIX}nsfwvid [keyword] — NSFW video search

🎮 *FUN & GAMES*
${PREFIX}quiz — Trivia question
${PREFIX}math — Math challenge
${PREFIX}riddle — Brain teaser
${PREFIX}joke — Random joke
${PREFIX}meme — Random meme

💰 *ECONOMY*
${PREFIX}balance — Check your coins
${PREFIX}daily — Claim daily reward (500 coins)
${PREFIX}shop — Browse the item shop
${PREFIX}buy <item> — Purchase an item
${PREFIX}transfer @user <amount> — Send coins

💎 *PREMIUM*
${PREFIX}premium — Check premium status
${PREFIX}claim <code> — Redeem premium code
${PREFIX}unlock — Unlock premium features

📊 *SYSTEM*
${PREFIX}ping — Check bot latency
${PREFIX}alive — System status & uptime
${PREFIX}menu — This menu
${PREFIX}owner — Developer contact

👨‍💻 *OWNER PANEL* _(Owner Only)_
${PREFIX}bc <text> — Broadcast to all groups
${PREFIX}ban @user — Ban user from bot
${PREFIX}unban @user — Unban user
${PREFIX}setppbot — Set bot profile picture
${PREFIX}autoread on/off — Auto-read messages
${PREFIX}autotyping on/off — Typing indicator
${PREFIX}restart — Restart the bot

━━━━━━━━━━━━━━━━━━━━━━
_${BOT_NAME} v2.1 | Owner: +${OWNER_NUMBER}_`;

            return await sock.sendMessage(from, {
                image: { url: logoPath },
                caption: fullMenu
            });
        }

        // Default short menu with buttons
        const menuText =
            `👋 *Hello, Master! Welcome to ${BOT_NAME}*

Your ultimate WhatsApp assistant — 80+ commands across all categories.

⚡ *Prefix:* [ ${PREFIX} ]
🕐 *Uptime:* ${h}h ${m}m
📡 *Status:* Online

📦 *Categories:*
📥 Downloaders (YT, TikTok, NSFW & more)
🇱🇰 Sri Lanka Movies (baiscope, piranha & more)
🔍 Search Engine (12+ sites)
🤖 AI & Creative Tools
👑 Group Management
💰 Virtual Economy
🎮 Fun & Games
🔞 NSFW Module

━━━━━━━━━━━━━━━━━━
_Type \`.allmenu\` for the full command list._`;

        await sock.sendMessage(from, {
            image: { url: logoPath },
            caption: menuText + '\n\n📜 Type *.allmenu* for all commands\n📊 Type *.alive* for system status\n🏓 Type *.ping* for ping'
        });

        await sendReact(sock, from, msg, '✅');
    }
};
