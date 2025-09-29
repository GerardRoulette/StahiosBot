const { Bot } = require('grammy');
require('dotenv').config();

// достаем переменные из env
const SOURCE_CHATS = JSON.parse(process.env.SOURCE_CHATS).map((id) => id.toString()); // чаты которые трекаем
const DESTINATION_CHAT = process.env.DESTINATION_CHAT.toString(); // чаты куда форвардим
const BOT_TOKEN = process.env.BOT_TOKEN;
const TAGS = process.env.TAGS; 

const bot = new Bot(BOT_TOKEN);

// кэш обработанных сообщений: ключ -> timestamp (ms)
const processedMessages = new Map();


// поддержка массива тегов через TAGS (JSON массив), без других вариантов
let NORMALIZED_TAGS = [];
try {
	if (TAGS) {
		const parsed = JSON.parse(TAGS);
		if (Array.isArray(parsed)) {
			NORMALIZED_TAGS = parsed
				.filter((t) => typeof t === 'string' && t.trim().length > 0)
				.map((t) => t.replace(/^#/, '').toLowerCase());
		}
	}
} catch (_) {
	// если TAGS невалиден — игнорируем
}

function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// настройки TTL и кап на размер кэша (захардкожены для простоты)
const PROCESSED_TTL_HOURS = 24;
const PROCESSED_MAX_SIZE = 5000;
const PROCESSED_TTL_MS = PROCESSED_TTL_HOURS * 60 * 60 * 1000;

function cleanupProcessed() {
	const now = Date.now();
	// удалить просроченные
	for (const [key, ts] of processedMessages) {
		if (now - ts > PROCESSED_TTL_MS) {
			processedMessages.delete(key);
		}
	}
	// кап по размеру (удаляем самые старые по порядку вставки)
	if (processedMessages.size > PROCESSED_MAX_SIZE) {
		const toDelete = processedMessages.size - PROCESSED_MAX_SIZE;
		let deleted = 0;
		for (const key of processedMessages.keys()) {
			processedMessages.delete(key);
			deleted++;
			if (deleted >= toDelete) break;
		}
	}
}

// периодическая очистка
setInterval(cleanupProcessed, 5 * 60 * 1000);

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
	const processedKey = `${chatId}:${messageId}`;
	if (!SOURCE_CHATS.includes(chatId)) {
		return;
	}
	// проверяем и одновременно очищаем просроченное
	const ts = processedMessages.get(processedKey);
	if (ts && (Date.now() - ts) <= PROCESSED_TTL_MS) {
        return;
    }
    
	// регекс хэштегов вида #tag1|#tag2 ... (без учета регистра), не захватывает подстроки
	const tagAlternation = NORMALIZED_TAGS.map((t) => escapeRegex(t)).join('|');
	const hashtagRegex = new RegExp(`(?:^|\\s)#(?:${tagAlternation})(?![\\w_])`, 'i');
	if (!hashtagRegex.test(text)) {
        return;
    }
    
	processedMessages.set(processedKey, Date.now());
	cleanupProcessed();
    
    try {
		const usernameDisplay = formatUsername(user);
		const messageLink = createMessageLink(chatId, messageId);
		
		// удаляем первый найденный тег из текста/подписи для чистоты
		const formattedText = `${usernameDisplay} пишет: "${text}"\n\n${messageLink}`;
        
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