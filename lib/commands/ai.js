const axios = require('axios');
const googleTTS = require('google-tts-api');
const translate = require('translate-google-api');
const { sendReact, presenceUpdate } = require('../utils');

module.exports = {
    name: 'ai',
    aliases: ['openai', 'chat', 'tts', 'trt', 'translate', 'img'],
    description: 'AI & Creative Tools Suite',
    async execute(sock, msg, from, args) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const lower = text.toLowerCase().trim();
        const command = lower.split(' ')[0].slice(1);
        const q = args.join(' ');

        if (!q) return await sock.sendMessage(from, { text: `Please provide input, Master! / යමක් ඇතුළත් කරන්න!` });

        await sendReact(sock, from, msg, '🤖');
        await presenceUpdate(sock, from, command === 'tts' ? 'recording' : 'composing');

        try {
            if (command === 'ai' || command === 'openai' || command === 'chat') {
                // Using a free proxy for GPT
                const { data } = await axios.get(`https://aivolve-api.vercel.app/api/chat?prompt=${encodeURIComponent(q)}`);
                await sock.sendMessage(from, { text: data.response || 'AI response failed, Master.' });
            } 
            else if (command === 'tts') {
                const url = googleTTS.getAudioUrl(q, { lang: 'en', slow: false, host: 'https://translate.google.com' });
                await sock.sendMessage(from, { audio: { url }, mimetype: 'audio/mpeg', ptt: true });
            }
            else if (command === 'trt' || command === 'translate') {
                const tr = await translate(q, { to: 'si' }); // Default to Sinhala
                await sock.sendMessage(from, { text: `*Translation / පරිවර්තනය:*\n\n${tr[0]}` });
            }
            else if (command === 'img') {
                const imgUrl = `https://aivolve-api.vercel.app/api/image?prompt=${encodeURIComponent(q)}`;
                await sock.sendMessage(from, { image: { url: imgUrl }, caption: `*AI Generated Image for:* "${q}"` });
            }

            await sendReact(sock, from, msg, '✅');
        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            await sock.sendMessage(from, { text: `AI Tool Error: ${e.message}` });
        }
    }
};
