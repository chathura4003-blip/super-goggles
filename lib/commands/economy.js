const db = require('../db');
const { sendReact } = require('../utils');

const SHOP_ITEMS = [
    { id: 'vip', name: '👑 VIP Badge', price: 5000, description: 'Show off your VIP status' },
    { id: 'boost', name: '⚡ Download Boost', price: 2000, description: 'Priority download queue' },
    { id: 'shield', name: '🛡️ Group Shield', price: 3000, description: 'Protect your group' },
    { id: 'lottery', name: '🎰 Lottery Ticket', price: 500, description: 'Win up to 10,000 coins!' },
    { id: 'xp', name: '📈 XP Boost', price: 1000, description: '2x daily reward for 24h' }
];

module.exports = {
    name: 'economy',
    aliases: ['balance', 'bal', 'daily', 'shop', 'buy', 'transfer', 'trans'],
    description: 'Virtual currency and shop system',
    async execute(sock, msg, from, args) {
        const sender = msg.key.participant || msg.key.remoteJid;
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const command = text.toLowerCase().trim().split(' ')[0].slice(1);

        await sendReact(sock, from, msg, '💰');

        try {
            let userData = db.get('users', sender);
            if (!userData || !userData.hasOwnProperty('balance')) {
                userData = { balance: 0, lastDaily: 0, items: [] };
            }
            if (!userData.items) userData.items = [];

            if (command === 'balance' || command === 'bal') {
                const items = userData.items.length
                    ? `\n\n🎒 *Inventory:* ${userData.items.map(i => SHOP_ITEMS.find(s => s.id === i)?.name || i).join(', ')}`
                    : '';
                await sock.sendMessage(from, {
                    text: `💰 *Your Wallet, Master!*\n\n💵 Balance: *${userData.balance} coins*${items}`
                });
            }

            else if (command === 'daily') {
                const now = Date.now();
                const cooldown = 86400000;
                const hasXpBoost = userData.items?.includes('xp');
                const reward = hasXpBoost ? 1000 : 500;

                if (now - (userData.lastDaily || 0) < cooldown) {
                    const remaining = cooldown - (now - userData.lastDaily);
                    const h = Math.floor(remaining / 3600000);
                    const m = Math.floor((remaining % 3600000) / 60000);
                    return await sock.sendMessage(from, {
                        text: `⏳ You already claimed today's reward, Master!\n\nCome back in *${h}h ${m}m*.`
                    });
                }

                userData.balance += reward;
                userData.lastDaily = now;
                db.set('users', sender, userData);
                await sock.sendMessage(from, {
                    text: `✅ *Daily Reward Claimed!*\n\n💵 +${reward} coins${hasXpBoost ? ' (2x XP Boost active!)' : ''}\n💰 New balance: *${userData.balance} coins*`
                });
            }

            else if (command === 'shop') {
                let shopMsg = `🛒 *Supreme Bot Shop*\n\n`;
                SHOP_ITEMS.forEach((item, i) => {
                    shopMsg += `${i + 1}. ${item.name}\n   📝 ${item.description}\n   💰 Price: *${item.price} coins*\n\n`;
                });
                shopMsg += `_Use \`.buy <item name>\` to purchase, Master!_`;
                await sock.sendMessage(from, { text: shopMsg });
            }

            else if (command === 'buy') {
                const itemName = args.join(' ').toLowerCase();
                const item = SHOP_ITEMS.find(i => i.id === itemName || i.name.toLowerCase().includes(itemName));

                if (!item) {
                    return await sock.sendMessage(from, {
                        text: `❌ Item not found. Use *.shop* to see available items, Master.`
                    });
                }
                if (userData.balance < item.price) {
                    return await sock.sendMessage(from, {
                        text: `❌ Insufficient funds, Master!\n\nYou need *${item.price} coins* but only have *${userData.balance} coins*.\nUse *.daily* to earn more!`
                    });
                }
                if (userData.items.includes(item.id)) {
                    return await sock.sendMessage(from, { text: `⚠️ You already own *${item.name}*, Master!` });
                }

                // Lottery special case
                if (item.id === 'lottery') {
                    userData.balance -= item.price;
                    const win = Math.random() < 0.3;
                    const prize = win ? Math.floor(Math.random() * 9500) + 500 : 0;
                    userData.balance += prize;
                    db.set('users', sender, userData);
                    return await sock.sendMessage(from, {
                        text: win
                            ? `🎰 *JACKPOT, Master!*\n\nYou won *${prize} coins!*\n💰 Balance: *${userData.balance} coins*`
                            : `🎰 *Better luck next time, Master.*\n\nYou lost your 500 coin ticket.\n💰 Balance: *${userData.balance} coins*`
                    });
                }

                userData.balance -= item.price;
                userData.items.push(item.id);
                db.set('users', sender, userData);
                await sock.sendMessage(from, {
                    text: `✅ *Purchase Successful!*\n\n${item.name} added to your inventory.\n💰 Remaining balance: *${userData.balance} coins*`
                });
            }

            else if (command === 'transfer' || command === 'trans') {
                const target =
                    msg.message.extendedTextMessage?.contextInfo?.participant ||
                    (args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
                const amount = parseInt(args[1] || args[0]);

                if (!amount || isNaN(amount) || amount <= 0) {
                    return await sock.sendMessage(from, { text: '⚠️ Specify a valid amount. E.g. `.transfer @user 500`, Master.' });
                }
                if (amount > userData.balance) {
                    return await sock.sendMessage(from, { text: `❌ You only have *${userData.balance} coins*, Master.` });
                }
                if (!target || target === '@s.whatsapp.net') {
                    return await sock.sendMessage(from, { text: '⚠️ Tag the user you want to transfer to, Master.' });
                }

                userData.balance -= amount;
                db.set('users', sender, userData);

                let targetData = db.get('users', target);
                if (!targetData || !targetData.hasOwnProperty('balance')) targetData = { balance: 0, lastDaily: 0, items: [] };
                targetData.balance = (targetData.balance || 0) + amount;
                db.set('users', target, targetData);

                await sock.sendMessage(from, {
                    text: `✅ Transferred *${amount} coins* to @${target.split('@')[0]}\n💰 Your balance: *${userData.balance} coins*`,
                    mentions: [target]
                });
            }

            await sendReact(sock, from, msg, '✅');
        } catch (e) {
            await sendReact(sock, from, msg, '❌');
            await sock.sendMessage(from, { text: `Economy error: ${e.message}` });
        }
    }
};
