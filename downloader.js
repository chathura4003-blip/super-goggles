const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpegFluent = require('fluent-ffmpeg');
const readline = require('readline');

const { DOWNLOAD_DIR } = require('./config');
const { logger } = require('./logger');
const { sendTemporaryMessage } = require('./lib/utils');

const isWin = process.platform === 'win32';
const ytdlpPath = path.join(__dirname, isWin ? 'yt-dlp.exe' : 'yt-dlp-linux');
const ytdlp = new YTDlpWrap(ytdlpPath);

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// ── Detect working ffmpeg binary ──────────────────────────────────────────
// Prefer system ffmpeg (NixOS) over ffmpeg-static (has libpostproc conflicts)
let FFMPEG_PATH = null;

function detectFfmpeg() {
    const candidates = [
        '/nix/store/6h39ipxhzp4r5in5g4rhdjz7p7fkicd0-replit-runtime-path/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        '/usr/local/bin/ffmpeg'
    ];

    // Try 'which ffmpeg' first
    try {
        const foundBuffer = execSync('which ffmpeg', { stdio: 'pipe', timeout: 3000 });
        const found = foundBuffer ? foundBuffer.toString().trim() : null;
        if (found && fs.existsSync(found)) {
            logger(`Using system ffmpeg: ${found}`);
            return found;
        }
    } catch { }

    // Try known NixOS paths
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            logger(`Using ffmpeg: ${c}`);
            return c;
        }
    }

    // Fall back to ffmpeg-static (may have issues but better than nothing)
    try {
        const staticPath = require('ffmpeg-static');
        logger(`Falling back to ffmpeg-static: ${staticPath}`);
        return staticPath;
    } catch { }

    return null;
}

FFMPEG_PATH = detectFfmpeg();
if (FFMPEG_PATH) ffmpegFluent.setFfmpegPath(FFMPEG_PATH);

// ── yt-dlp startup check ─────────────────────────────────────────────────
async function init() {
    if (!fs.existsSync(ytdlpPath)) {
        logger(`yt-dlp binary missing — downloading for ${process.platform}...`);
        try {
            if (isWin) {
                execSync(
                    `powershell -Command "Invoke-WebRequest -Uri https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe -OutFile '${ytdlpPath}'"`,
                    { stdio: 'pipe', timeout: 60000 }
                );
            } else {
                execSync(
                    `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o "${ytdlpPath}" && chmod a+rx "${ytdlpPath}"`,
                    { stdio: 'pipe', timeout: 60000 }
                );
            }
            logger('yt-dlp downloaded! ✅');
        } catch (e) {
            logger(`yt-dlp download failed: ${e.message}`);
        }
    } else {
        logger('yt-dlp binary ready ✅');
    }
}
init().catch(e => logger(`Init: ${e.message}`));

// ── File cache ─────────────────────────────────────────────────────────────
const downloadCache = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

function getCacheKey(url, isAudio, quality) {
    return crypto.createHash('md5').update(`${url}:${isAudio}:${quality}`).digest('hex');
}

function getCached(key) {
    const entry = downloadCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL || !fs.existsSync(entry.filePath)) {
        downloadCache.delete(key);
        return null;
    }
    return entry;
}

function setCache(key, filePath, isAudio) {
    downloadCache.set(key, { filePath, isAudio, timestamp: Date.now() });
    setTimeout(() => {
        const e = downloadCache.get(key);
        if (e && fs.existsSync(e.filePath)) try { fs.unlinkSync(e.filePath); } catch { }
        downloadCache.delete(key);
    }, CACHE_TTL);
}

// ── Find yt-dlp output by filename prefix ──────────────────────────────────
function findOutput(prefix) {
    try {
        const files = fs.readdirSync(DOWNLOAD_DIR);
        const match = files.find(f => f.startsWith(prefix) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
        return match ? path.join(DOWNLOAD_DIR, match) : null;
    } catch { return null; }
}

// ── Send file to WhatsApp ───────────────────────────────────────────────────
async function sendFile(sock, from, filePath, isAudio, siteName) {
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
    const ext = path.extname(filePath).toLowerCase();

    if (isAudio) {
        const audioMime = ext === '.mp3' ? 'audio/mpeg' : (ext === '.m4a' ? 'audio/mp4' : 'audio/ogg; codecs=opus');
        await sock.sendMessage(from, {
            audio: { url: filePath },
            mimetype: audioMime,
            ptt: false
        });
    } else {
        const isLarge = parseFloat(sizeMB) > 60; // Standard WhatsApp media limit
        const isWebm = ext === '.webm' || ext === '.mkv';

        if (isLarge || isWebm) {
            // Send as document if too large or non-standard container
            await sock.sendMessage(from, {
                document: { url: filePath },
                mimetype: isWebm ? 'video/x-matroska' : 'video/mp4',
                fileName: `${siteName}_${Date.now()}${ext}`,
                caption: `🎬 *${siteName}* | ${sizeMB}MB`
            });
        } else {
            // Standard video message
            await sock.sendMessage(from, {
                video: { url: filePath },
                mimetype: 'video/mp4',
                caption: `🎬 *${siteName}* 🔥`
            });
        }
    }
}

// ── Build yt-dlp format string ─────────────────────────────────────────────
// Prefer single-file (pre-merged) formats to avoid ffmpeg post-processing.
// Only fall back to merge-required formats when explicitly needed.
function buildFormatArgs(quality, isAudio, ffmpegAvailable) {
    if (isAudio) {
        if (ffmpegAvailable) {
            return ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0'];
        }
        // No ffmpeg: download best audio as-is (m4a/webm)
        return ['-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio'];
    }

    if (quality === 'hd') {
        if (ffmpegAvailable) {
            return [
                '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[ext=mp4]/best',
                '--merge-output-format', 'mp4'
            ];
        }
        return ['-f', 'best[height<=1080][ext=mp4]/best[ext=mp4]/best'];
    }

    if (quality === 'low') {
        return ['-f', 'worst[ext=mp4]/worstvideo[ext=mp4]+worstaudio/worst'];
    }

    // SD (default) — always prefer pre-merged mp4 so no ffmpeg needed
    return [
        '-f', 'best[height<=480][ext=mp4]/best[height<=720][ext=mp4]/best[ext=mp4]/bestvideo[height<=480]+bestaudio/best',
        ...(ffmpegAvailable ? ['--merge-output-format', 'mp4'] : [])
    ];
}

async function getMetadata(url) {
    try {
        const metadata = await ytdlp.getVideoInfo(url);
        let thumb = metadata.thumbnail || null;
        if (Array.isArray(metadata.thumbnails) && metadata.thumbnails.length > 0) {
            thumb = metadata.thumbnails[metadata.thumbnails.length - 1].url; // get best quality
        }
        return {
            title: metadata.title || 'Unknown Title',
            duration: metadata.duration_string || '?',
            thumbnail: typeof thumb === 'string' ? thumb : null,
            source: metadata.extractor_key || 'Media',
            filesize: metadata.filesize || metadata.filesize_approx || 0,
            url: metadata.webpage_url || url
        };
    } catch (e) {
        logger(`Metadata Error: ${e?.message || 'Unknown'}`);
        if (e?.stack) console.error(e.stack);
        return null;
    }
}

async function downloadCompressAndSend(sock, from, url, siteName = 'Media', quality = 'sd', isAudio = false) {
    if (!url) return await sock.sendMessage(from, { text: '⚠️ No URL provided, Master!' });

    const cacheKey = getCacheKey(url, isAudio, quality);
    const cached = getCached(cacheKey);
    if (cached) {
        logger(`Cache hit: ${url}`);
        const ph = await sock.sendMessage(from, { text: `⚡ *Sending from cache instantly, Master!*` });
        try {
            await sendFile(sock, from, cached.filePath, cached.isAudio, siteName);
            await sock.sendMessage(from, { edit: ph.key, text: `✅ Delivered from cache! *(${siteName})*` });
        } catch {
            downloadCache.delete(cacheKey);
            await downloadAndSend(sock, from, url, siteName, quality, isAudio, cacheKey);
        }
        return;
    }

    await downloadAndSend(sock, from, url, siteName, quality, isAudio, cacheKey);
}

async function downloadAndSend(sock, from, url, siteName, quality, isAudio, cacheKey) {
    const placeholder = await sock.sendMessage(from, {
        text: `⏳ Initializing ${isAudio ? 'audio' : 'video'} download from *${siteName}*...`
    });

    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const outputTemplate = path.join(DOWNLOAD_DIR, `${uid}.%(ext)s`);
    let downloadedFile = null;
    let compressedFile = null;
    let lastUpdate = 0;

    try {
        const ffmpegOk = !!FFMPEG_PATH;
        const formatArgs = buildFormatArgs(quality, isAudio, ffmpegOk);

        const ytdlpArgs = [
            url,
            ...(ffmpegOk ? ['--ffmpeg-location', FFMPEG_PATH] : []),
            ...formatArgs,
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--no-playlist',
            '--no-part',
            '--quiet',
            '--no-warnings',
            '--no-check-certificate',
            '--geo-bypass',
            '--socket-timeout', '60',
            '--newline',
            '-o', outputTemplate
        ];

        logger(`yt-dlp args: ${ytdlpArgs.slice(0, 6).join(' ')} ...`);

        // use spawn directly to avoid yt-dlp-wrap internal bug
        const downloadProcess = spawn(ytdlpPath, ytdlpArgs);
        
        // Parse progress from stdout manually
        const rl = readline.createInterface({ input: downloadProcess.stdout });
        rl.on('line', (line) => {
            try {
                // yt-dlp --progress output: [download]  10.0% of 100.00MiB at 1.00MiB/s ETA 01:00
                const match = line.match(/\[download\]\s+([\d\.]+)%\s+of\s+.*\s+at\s+([\w\.\/]+)\s+ETA\s+([\d:]+)/);
                if (match) {
                    const now = Date.now();
                    if (now - lastUpdate > 5000) {
                        const percent = match[1];
                        const speed = match[2];
                        const eta = match[3];

                        if (placeholder && placeholder.key) {
                            sock.sendMessage(from, {
                                edit: placeholder.key,
                                text: `🚀 *Downloading...*\n\n📊 Progress: ${percent}%\n⚡ Speed: ${speed}\n⏳ ETA: ${eta}`
                            }).catch(() => { });
                        }
                        lastUpdate = now;
                    }
                }
            } catch (err) { /* ignore parse errors */ }
        });

        // Also pipe stderr to logger for debugging
        downloadProcess.stderr.on('data', (data) => {
            const errStr = data ? data.toString() : '';
            if (errStr.includes('ERROR')) logger(`yt-dlp stderr: ${errStr.trim()}`);
        });

        await new Promise((resolve, reject) => {
            downloadProcess.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`yt-dlp exited with code ${code}`));
            });
            downloadProcess.on('error', reject);
        });

        // Locate the output file
        downloadedFile = findOutput(uid);
        if (!downloadedFile || !fs.existsSync(downloadedFile)) {
            // Try explicit extensions
            const extensions = ['mp4', 'mp3', 'm4a', 'webm', 'mkv'];
            for (const ext of extensions) {
                const attempt = path.join(DOWNLOAD_DIR, `${uid}.${ext}`);
                if (fs.existsSync(attempt)) { downloadedFile = attempt; break; }
            }
        }

        if (!downloadedFile || !fs.existsSync(downloadedFile)) {
            throw new Error('Downloaded file not found. It may have failed to merge or was moved.');
        }

        let stats;
        try {
            stats = fs.statSync(downloadedFile);
        } catch (e) {
            // Retry once if statSync fails due to lock
            await new Promise(r => setTimeout(r, 500));
            stats = fs.statSync(downloadedFile);
        }
        let sizeMB = stats.size / (1024 * 1024);
        logger(`Downloaded: ${sizeMB.toFixed(1)}MB from ${siteName}`);

        // Compress video if over 50MB and ffmpeg is available
        if (!isAudio && sizeMB > 50 && ffmpegOk) {
            await sendTemporaryMessage(sock, from, `⚙️ Compressing ${sizeMB.toFixed(1)}MB for WhatsApp...`, 10000);

            compressedFile = path.join(DOWNLOAD_DIR, `${uid}_c.mp4`);
            const scale = sizeMB > 150 ? '-2:360' : '-2:480';
            const crf = sizeMB > 150 ? '32' : '28';

            await new Promise((resolve, reject) => {
                ffmpegFluent(downloadedFile)
                    .videoCodec('libx264')
                    .addOutputOptions([
                        `-crf ${crf}`, '-preset veryfast',
                        `-vf scale=${scale}`,
                        '-pix_fmt yuv420p', '-movflags +faststart'
                    ])
                    .audioCodec('aac').audioBitrate('96k')
                    .output(compressedFile)
                    .on('end', resolve)
                    .on('error', reject)
                    .run();
            });

            try { fs.unlinkSync(downloadedFile); } catch { }
            downloadedFile = compressedFile;
            compressedFile = null;
            sizeMB = fs.statSync(downloadedFile).size / (1024 * 1024);
        }

        const sizeFmt = sizeMB.toFixed(1);
        await sock.sendMessage(from, {
            edit: placeholder.key,
            text: `✅ Sending *${sizeFmt}MB* ${isAudio ? 'audio' : 'video'} now, Master...`
        });

        await sendFile(sock, from, downloadedFile, isAudio, siteName);
        setCache(cacheKey, downloadedFile, isAudio);
        logger(`Sent & cached: ${sizeFmt}MB from ${siteName}`);

        // Keep the success confirmation message (edited placeholder) in the chat
        // const { deleteMessage } = require('./lib/utils');
        // await deleteMessage(sock, from, placeholder.key);


    } catch (e) {
        if (e?.stack) console.error('DOWNLOAD STACK:', e.stack);
        const msg = (e?.message || String(e || 'Unknown error')).toString();
        logger(`Download Error [${siteName}]: ${msg}`);

        let tip = '_Try SD quality or check the link is public._';
        if (msg.includes('geo')) tip = '_This content may be geo-restricted._';
        else if (msg.includes('login') || msg.includes('sign')) tip = '_This content requires login on the source site._';
        else if (msg.includes('postproc') || msg.includes('libpostproc')) tip = '_FFmpeg post-processing failed. Retrying with simpler format…_';

        await sock.sendMessage(from, {
            edit: placeholder.key,
            text: `❌ Download failed, Master.\n\n*Error:* ${msg.slice(0, 200)}\n\n${tip}`
        });

        // Auto-retry with simple format if ffmpeg postprocess failed
        if (msg.includes('postproc') || msg.includes('libpostproc')) {
            await retrySimpleFormat(sock, from, url, siteName, isAudio, cacheKey);
        }

        if (downloadedFile && fs.existsSync(downloadedFile)) try { fs.unlinkSync(downloadedFile); } catch { }
        if (compressedFile && fs.existsSync(compressedFile)) try { fs.unlinkSync(compressedFile); } catch { }
    }
}

// ── Retry with simplest possible format (no ffmpeg post-processing) ─────────
async function retrySimpleFormat(sock, from, url, siteName, isAudio, cacheKey) {
    const ph = await sendTemporaryMessage(sock, from, `🔄 Retrying with simplified format, Master...`, 15000);
    const uid = `retry_${Date.now()}`;
    const outputTemplate = path.join(DOWNLOAD_DIR, `${uid}.%(ext)s`);
    let downloadedFile = null;

    try {
        // use spawn directly for retry too
        const retryProcess = spawn(ytdlpPath, [
            url,
            '-f', isAudio ? 'bestaudio[ext=m4a]/bestaudio' : 'best[ext=mp4]/best',
            '--no-playlist', '--no-part', '--quiet', '--no-warnings',
            '--socket-timeout', '30',
            '-o', outputTemplate
        ]);

        await new Promise((resolve, reject) => {
            retryProcess.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Retry exited with code ${code}`));
            });
            retryProcess.on('error', reject);
        });

        downloadedFile = findOutput(uid);
        for (const ext of ['mp4', 'mp3', 'm4a', 'webm', 'mkv']) {
            if (!downloadedFile) {
                const t = path.join(DOWNLOAD_DIR, `${uid}.${ext}`);
                if (fs.existsSync(t)) { downloadedFile = t; break; }
            }
        }
        if (!downloadedFile || !fs.existsSync(downloadedFile)) throw new Error('Retry download not found');

        const sizeMB = (fs.statSync(downloadedFile).size / (1024 * 1024)).toFixed(1);
        await sock.sendMessage(from, { edit: ph.key, text: `✅ Retry succeeded (${sizeMB}MB), sending...` });
        await sendFile(sock, from, downloadedFile, isAudio, siteName);
        setCache(cacheKey, downloadedFile, isAudio);
    } catch (e2) {
        await sock.sendMessage(from, { edit: ph.key, text: `❌ Retry also failed: ${e2.message.slice(0, 150)}` });
        if (downloadedFile && fs.existsSync(downloadedFile)) try { fs.unlinkSync(downloadedFile); } catch { }
    }
}

module.exports = { downloadCompressAndSend, getMetadata };