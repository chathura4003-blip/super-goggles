const axios = require('axios');
const { sendReact } = require('../utils');

const RIDDLES = [
    { q: "I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?", a: "An echo" },
    { q: "I have cities, but no houses live there. I have mountains, but no trees grow. I have water, but no fish swim. I have roads, but no cars drive. What am I?", a: "A map" },
    { q: "The more you take, the more you leave behind. What am I?", a: "Footsteps" },
    { q: "I have hands but cannot clap. What am I?", a: "A clock" },
    { q: "What has teeth but cannot bite?", a: "A comb" },
    { q: "What has one eye but cannot see?", a: "A needle" },
    { q: "What gets wetter the more it dries?", a: "A towel" },
    { q: "I am always in front of you but can never be seen. What am I?", a: "The future" },
    { q: "What can you catch but not throw?", a: "A cold" },
    { q: "I have no legs but always run. I have no mouth but always murmur. What am I?", a: "A river" }
];

module.exports = {
    name: 'fun',
    aliases: ['quiz', 'math', 'riddle', 'joke', 'meme'],
    description: 'Games & Entertainment suite',
    async execute(sock, msg, from, args) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const command = text.toLowerCase().trim().split(' ')[0].slice(1);

        await sendReact(sock, from, msg, '🎮');

        try {
            if (command === 'joke') {
                const { data } = await axios.get('https://official-joke-api.appspot.com/random_joke');
                await sock.sendMessage(from, {
                    text: `😂 *Joke Time, Master!*\n\n${data.setup}\n\n||*${data.punchline}*||`
                });
            }

            else if (command === 'meme') {
                const { data } = await axios.get('https://meme-api.com/gimme');
                await sock.sendMessage(from, {
                    image: { url: data.url },
                    caption: `😂 *${data.title}*\n\n👍 ${data.ups} upvotes`
                });
            }

            else if (command === 'math') {
                const ops = ['+', '-', '×'];
                const op = ops[Math.floor(Math.random() * ops.length)];
                const n1 = Math.floor(Math.random() * 50) + 1;
                const n2 = Math.floor(Math.random() * 50) + 1;
                const answer = op === '+' ? n1 + n2 : op === '-' ? n1 - n2 : n1 * n2;
                await sock.sendMessage(from, {
                    text: `🧠 *Math Challenge, Master!*\n\nWhat is *${n1} ${op} ${n2}*?\n\n_Reply to find out the answer! Spoiler: ||${answer}||_`
                });
            }

            else if (command === 'quiz') {
                try {
                    const { data } = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple');
                    const q = data.results[0];
                    const allAnswers = [...q.incorrect_answers, q.correct_answer].sort(() => Math.random() - 0.5);
                    const answerList = allAnswers.map((a, i) => `${String.fromCharCode(65 + i)}. ${a}`).join('\n');
                    await sock.sendMessage(from, {
                        text: `❓ *Quiz Time, Master!*\n\n*Category:* ${q.category}\n*Difficulty:* ${q.difficulty}\n\n*${q.question}*\n\n${answerList}\n\n_Answer: ||${q.correct_answer}||_`
                    });
                } catch {
                    await sock.sendMessage(from, { text: '❌ Could not fetch quiz question. Try again, Master.' });
                }
            }

            else if (command === 'riddle') {
                const riddle = RIDDLES[Math.floor(Math.random() * RIDDLES.length)];
                await sock.sendMessage(from, {
                    text: `🧩 *Riddle Time, Master!*\n\n${riddle.q}\n\n_Answer: ||${riddle.a}||_`
                });
            }

            await sendReact(sock, from, msg, '✅');
        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            await sock.sendMessage(from, { text: `Fun module error: ${e.message}` });
        }
    }
};
