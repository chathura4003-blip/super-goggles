const fs = require('fs');
const path = require('path');
const { logger } = require('../logger');

const commands = new Map();

// Key: message ID of the search result list → { results, senderJid }
const userSearches = new Map();

// Key: senderJid → { results, lastMsgId, timestamp } — for plain number replies (no quote needed)
const userLastSearch = new Map();

// Key: senderJid → { result, timestamp } — for quality selection (1, 2, 3)
const userQualitySelection = new Map();

const RESULT_TTL = 10 * 60 * 1000; // 10 minutes

function loadCommands() {
    const commandsDir = path.join(__dirname, 'commands');
    if (!fs.existsSync(commandsDir)) fs.mkdirSync(commandsDir);

    const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
    for (const file of files) {
        try {
            const cmd = require(path.join(commandsDir, file));
            if (cmd.name && cmd.execute) {
                commands.set(cmd.name, cmd);
                if (cmd.aliases) {
                    cmd.aliases.forEach(a => commands.set(a, cmd));
                }
            }
        } catch (e) {
            logger(`Failed to load command ${file}: ${e.message}`);
        }
    }
    logger(`Loaded ${commands.size} command handlers.`);
}

// Store search results for a user
function storeSearchResults(msgId, senderJid, results) {
    const entry = { results, senderJid, timestamp: Date.now() };
    userSearches.set(msgId, entry);
    userLastSearch.set(senderJid, { ...entry, lastMsgId: msgId });
    setTimeout(() => {
        userSearches.delete(msgId);
        const last = userLastSearch.get(senderJid);
        if (last && last.lastMsgId === msgId) userLastSearch.delete(senderJid);
    }, RESULT_TTL);
}

// Show quality selection buttons after a result is picked
async function showQualityButtons(sock, from, result, index = null, sender) {
    const { BOT_NAME, PREFIX } = require('../config');
    userQualitySelection.set(sender, { result, timestamp: Date.now() });

    const title = result.title.length > 55 ? result.title.slice(0, 52) + '...' : result.title;
    const idxStr = index !== null ? ` (Result #${index + 1})` : '';

    let sizeStr = 'Calculating...';
    if (result.filesize) sizeStr = (result.filesize / (1024 * 1024)).toFixed(1) + ' MB';

    const menuText = `🎬 *VIDEO SELECTED*${idxStr}
━━━━━━━━━━━━━━━━━━━
📝 *Title:* ${title}
⏱️ *Duration:* ${result.duration || '?'}
🌐 *Source:* ${result.source || 'Media'}
📦 *File Size:* ${sizeStr}
⚡ *Speed:* 5-10 MB/s (Est.)
━━━━━━━━━━━━━━━━━━━
1️⃣ *HD Video* 
2️⃣ *SD Video* 
3️⃣ *Audio File* 
━━━━━━━━━━━━━━━━━━━
_Reply with 1, 2, or 3_
_Or tap a button below_`;

    const buttons = [
        { buttonId: `${PREFIX}yt hd ${result.url}`, buttonText: { displayText: '1️⃣ HD Video' }, type: 1 },
        { buttonId: `${PREFIX}yt sd ${result.url}`, buttonText: { displayText: '2️⃣ SD Video' }, type: 1 },
        { buttonId: `${PREFIX}yta ${result.url}`, buttonText: { displayText: '3️⃣ Audio File' }, type: 1 }
    ];

    const messageOptions = {
        buttons: buttons
    };

    if (result.thumbnail) {
        messageOptions.image = { url: result.thumbnail };
        messageOptions.caption = menuText;
        messageOptions.footer = `⚡ ${BOT_NAME} Downloader`;
    } else {
        messageOptions.text = menuText;
        messageOptions.footer = `⚡ ${BOT_NAME} Downloader`;
    }

    await sock.sendMessage(from, messageOptions);
}

async function handleCommand(sock, msg, from, text) {
    const { PREFIX } = require('../config');
    const sender = msg.key.participant || msg.key.remoteJid;

    // ─── Handle list menu response ───────────────────────────────────────
    const listResponse = msg.message?.listResponseMessage;
    if (listResponse?.singleSelectReply?.selectedRowId) {
        const rowId = listResponse.singleSelectReply.selectedRowId;
        if (rowId.startsWith('pick:')) {
            const idx = parseInt(rowId.replace('pick:', ''));
            const userEntry = userLastSearch.get(sender);
            if (userEntry && !isNaN(idx) && userEntry.results[idx]) {
                const { getMetadata } = require('../downloader');
                const meta = await getMetadata(userEntry.results[idx].url);
                await showQualityButtons(sock, from, meta || userEntry.results[idx], idx, sender);
                return true;
            }
        }
    }

    // ─── Handle button response ───────────────────────────────────────────
    // Skip button processing if we are already processing specific text (recursive call)
    if (!text) {
        const buttonResponse = msg.message?.buttonsResponseMessage || msg.message?.templateButtonReplyMessage;
        if (buttonResponse?.selectedButtonId || buttonResponse?.selectedId) {
            const btnId = buttonResponse.selectedButtonId || buttonResponse.selectedId;

            // Legacy button routing or new direct-command buttons
            if (btnId.startsWith(PREFIX) || btnId.startsWith('.')) {
                return await handleCommand(sock, msg, from, btnId);
            }
        }
    }

    // Use provided text or fallback to message content
    const commandText = text || msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || '';

    if (!commandText) return false;
    const lower = commandText.toLowerCase().trim();
    const isNumberMsg = /^\d+$/.test(lower);

    if (isNumberMsg) {
        const num = parseInt(lower.trim());
        const idx = num - 1;

        // Check if it's a quality selection (1, 2, 3)
        const qualityEntry = userQualitySelection.get(sender);
        if (qualityEntry && Date.now() - qualityEntry.timestamp < RESULT_TTL) {
            if (num >= 1 && num <= 3) {
                const { downloadCompressAndSend } = require('../downloader');
                const { result } = qualityEntry;
                if (num === 1) await downloadCompressAndSend(sock, from, result.url, result.source, 'hd', false);
                else if (num === 2) await downloadCompressAndSend(sock, from, result.url, result.source, 'sd', false);
                else if (num === 3) await downloadCompressAndSend(sock, from, result.url, result.source, 'sd', true);
                userQualitySelection.delete(sender);
                return true;
            }
        }

        // Search result selection (Try quoted message first)
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        if (contextInfo?.stanzaId) {
            const entry = userSearches.get(contextInfo.stanzaId);
            if (entry && idx >= 0 && idx < entry.results.length) {
                const { getMetadata } = require('../downloader');
                const meta = await getMetadata(entry.results[idx].url);
                await showQualityButtons(sock, from, meta || entry.results[idx], idx, sender);
                return true;
            }
        }

        // Fallback: use this user's last search (no quote needed)
        const userEntry = userLastSearch.get(sender);
        if (userEntry && Date.now() - userEntry.timestamp < RESULT_TTL) {
            if (idx >= 0 && idx < userEntry.results.length) {
                const { getMetadata } = require('../downloader');
                const meta = await getMetadata(userEntry.results[idx].url);
                await showQualityButtons(sock, from, meta || userEntry.results[idx], idx, sender);
                return true;
            }
        }
    }

    // ─── Standard prefix commands ─────────────────────────────────────────
    if (!text.startsWith(PREFIX)) return false;

    const args = text.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = commands.get(commandName);
    if (!command) return false;

    try {
        await command.execute(sock, msg, from, args);
        return true;
    } catch (e) {
        logger(`Command Error (${commandName}): ${e.message}`);
        await sock.sendMessage(from, { text: `❌ Command error: ${e.message}` });
        return false;
    }
}

module.exports = {
    loadCommands,
    handleCommand,
    userSearches,
    userLastSearch,
    storeSearchResults,
    showQualityButtons
};
