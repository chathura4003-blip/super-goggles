const { sendReact } = require('../utils');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const os = require('os');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

module.exports = {
    name: 'sticker',
    aliases: ['st'],
    description: 'Convert image or video to WhatsApp sticker',
    async execute(sock, msg, from, args) {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const isQuotedImg = quoted?.imageMessage;
        const isQuotedVid = quoted?.videoMessage;
        const isDirectImg = msg.message?.imageMessage;
        const isDirectVid = msg.message?.videoMessage;

        const targetMsg = isQuotedImg || isQuotedVid || isDirectImg || isDirectVid;
        const type = (isQuotedImg || isDirectImg) ? 'image' : (isQuotedVid || isDirectVid) ? 'video' : null;

        if (!targetMsg || !type) {
            return await sock.sendMessage(from, {
                text: '⚠️ Reply to an image or short video to create a sticker, Master!'
            });
        }

        await sendReact(sock, from, msg, '🎨');
        await sock.sendMessage(from, { text: '🔄 Creating your sticker, Master...' });

        try {
            const stream = await downloadContentFromMessage(targetMsg, type);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            const ext = type === 'image' ? 'jpg' : 'mp4';
            const tmpIn = path.join(os.tmpdir(), `stk_in_${Date.now()}.${ext}`);
            const tmpOut = path.join(os.tmpdir(), `stk_out_${Date.now()}.webp`);
            fs.writeFileSync(tmpIn, buffer);

            await new Promise((resolve, reject) => {
                let ff = ffmpeg(tmpIn)
                    .addOutputOptions([
                        '-vcodec libwebp',
                        '-vf scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1',
                        '-loop 0',
                        '-preset default',
                        '-an',
                        '-vsync 0',
                        '-s 512:512'
                    ])
                    .toFormat('webp')
                    .on('end', resolve)
                    .on('error', reject);
                ff.save(tmpOut);
            });

            const stickerBuffer = fs.readFileSync(tmpOut);
            await sock.sendMessage(from, { sticker: stickerBuffer });
            await sendReact(sock, from, msg, '✅');

            if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
            if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            await sock.sendMessage(from, { text: `❌ Sticker error: ${e.message}` });
        }
    }
};
