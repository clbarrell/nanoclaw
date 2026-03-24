import { Telegraf } from 'telegraf';

import { TELEGRAM_BOT_TOKEN } from './config.js';
import { storeChatMetadata, storeGenericMessage } from './db.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

let bot: Telegraf;

/**
 * Convert a Telegram chat ID to a NanoClaw JID.
 */
export function toTelegramJid(chatId: number | string): string {
  return `tg:${chatId}`;
}

/**
 * Extract the Telegram chat ID from a NanoClaw JID.
 */
export function fromTelegramJid(jid: string): string {
  return jid.slice(3);
}

/**
 * Send a text message to a Telegram chat.
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<void> {
  try {
    await bot.telegram.sendMessage(chatId, text);
    logger.info({ chatId, length: text.length }, 'Telegram message sent');
  } catch (err) {
    logger.error({ chatId, err }, 'Failed to send Telegram message');
  }
}

/**
 * Send a typing indicator to a Telegram chat.
 */
export async function sendTelegramTyping(chatId: string): Promise<void> {
  try {
    await bot.telegram.sendChatAction(chatId, 'typing');
  } catch (err) {
    logger.debug({ chatId, err }, 'Failed to send Telegram typing action');
  }
}

/**
 * Connect to Telegram and start listening for messages.
 * Messages are stored in the database; the existing message loop picks them up.
 */
export async function connectTelegram(
  getRegisteredGroups: () => Record<string, RegisteredGroup>,
): Promise<void> {
  bot = new Telegraf(TELEGRAM_BOT_TOKEN);

  bot.on('text', (ctx) => {
    const chatId = ctx.chat.id;
    const jid = toTelegramJid(chatId);
    const timestamp = new Date(ctx.message.date * 1000).toISOString();
    const sender = String(ctx.from.id);
    const senderName =
      ctx.from.first_name +
      (ctx.from.last_name ? ` ${ctx.from.last_name}` : '');
    const content = ctx.message.text;
    const msgId = String(ctx.message.message_id);
    const isFromMe = ctx.from.is_bot;

    // Store chat metadata for all Telegram chats (enables discovery)
    const chatName =
      ctx.chat.type === 'private'
        ? senderName
        : ('title' in ctx.chat ? ctx.chat.title : undefined) || jid;
    storeChatMetadata(jid, timestamp, chatName);

    // Only store full message content for registered groups
    const registeredGroups = getRegisteredGroups();
    if (registeredGroups[jid]) {
      storeGenericMessage(
        msgId,
        jid,
        sender,
        senderName,
        content,
        timestamp,
        isFromMe,
      );
    }

    logger.debug(
      { jid, sender: senderName, registered: !!registeredGroups[jid] },
      'Telegram message received',
    );
  });

  bot.catch((err) => {
    logger.error({ err }, 'Telegram bot error');
  });

  await bot.launch();
  logger.info('Connected to Telegram');

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
