const { Bot } = require('grammy');
require('dotenv').config();

// достаем переменные из env
const SOURCE_CHATS = JSON.parse(process.env.SOURCE_CHATS);
const DESTINATION_CHAT = process.env.DESTINATION_CHAT;
const BOT_TOKEN = process.env.BOT_TOKEN;
const TAG = process.env.TAG;

const bot = new Bot(BOT_TOKEN);

const processedMessages = new Set();

// генерация линка на сообщение
function createMessageLink(chatId, messageId) {
    const baseChatId = chatId.toString().replace(/^-100/, '');
    return `https://t.me/c/${baseChatId}/${messageId}`;
}

// генерация юзернейма
function formatUsername(user) {
    if (user.username) {
        return `@${user.username}`;
    } else {
        return `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}`;
    }
}

// Собственно форвардинг
async function forwardMessage(ctx, message) {
    // вытаскиваем все что надо
    const chatId = message.chat.id.toString();
    const messageId = message.message_id;
    const text = message.text || message.caption || '';
    const user = message.from;
    
    // проверяем что запрос из чата пришел из нужных чатов
    if (!SOURCE_CHATS.includes(chatId) || processedMessages.has(messageId)) {
        return;
    }
    
    //регекс хэштэга, так как будто бы надежнее
    const hashtagRegex = new RegExp(`\\b${TAG}\\b`, 'i');
    if (!hashtagRegex.test(text)) {
        return;
    }
    
    processedMessages.add(messageId);
    
    try {
        const usernameDisplay = formatUsername(user);
        const messageLink = createMessageLink(chatId, messageId);
        let content = text.replace(hashtagRegex, '').trim();
        
        const formattedText = `${usernameDisplay} пишет: "${content}\n\n${messageLink}"`;
        
        // Если вдруг сообщение с вложением
        if (message.photo) {
            // фотки
            await ctx.api.sendPhoto(
                DESTINATION_CHAT, 
                message.photo[message.photo.length - 1].file_id,
                { caption: formattedText }
            );
        } else if (message.document) {
            // файл
            await ctx.api.sendDocument(
                DESTINATION_CHAT,
                message.document.file_id,
                { caption: formattedText }
            );
        } else if (message.video) {
            // видео
            await ctx.api.sendVideo(
                DESTINATION_CHAT,
                message.video.file_id,
                { caption: formattedText }
            );
        } else {
            // просто текст
            await ctx.api.sendMessage(DESTINATION_CHAT, formattedText);
        }
        
        console.log(`Forwarded message ${messageId} from chat ${chatId}`);
        
    } catch (error) {
        console.error('Error forwarding message:', error);
    }
}

bot.on('message', async (ctx) => {
    await forwardMessage(ctx, ctx.message);
});

bot.catch((err) => {
    console.error('Bot error:', err);
});

console.log('Starting bot with media support...');
bot.start();