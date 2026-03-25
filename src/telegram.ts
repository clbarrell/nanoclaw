import fs from 'fs';
import path from 'path';

import { Context, Telegraf } from 'telegraf';
import { Message, Update } from 'telegraf/types';

import { GROUPS_DIR, TELEGRAM_BOT_TOKEN } from './config.js';
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

/** Common metadata extracted from any Telegram message. */
interface TelegramMessageContext {
  chatId: number;
  jid: string;
  timestamp: string;
  sender: string;
  senderName: string;
  msgId: string;
  isFromMe: boolean;
  chatName: string;
}

/** Extract common fields from any Telegram message context. */
function extractMessageContext(
  ctx: Context<Update.MessageUpdate>,
): TelegramMessageContext | null {
  if (!ctx.chat || !ctx.from || !ctx.message) return null;

  const chatId = ctx.chat.id;
  const jid = toTelegramJid(chatId);
  const timestamp = new Date(ctx.message.date * 1000).toISOString();
  const sender = String(ctx.from.id);
  const senderName =
    ctx.from.first_name +
    (ctx.from.last_name ? ` ${ctx.from.last_name}` : '');
  const msgId = String(ctx.message.message_id);
  const isFromMe = ctx.from.is_bot;
  const chatName =
    ctx.chat.type === 'private'
      ? senderName
      : ('title' in ctx.chat ? ctx.chat.title : undefined) || jid;

  return { chatId, jid, timestamp, sender, senderName, msgId, isFromMe, chatName };
}

/** Download a Telegram file by file_id and return the buffer. */
async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const response = await fetch(fileLink.href);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Save a media buffer to the group's media directory. Returns the container-relative path. */
function saveMediaFile(
  group: RegisteredGroup,
  filename: string,
  buffer: Buffer,
): string {
  const mediaDir = path.join(GROUPS_DIR, group.folder, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(path.join(mediaDir, filename), buffer);
  return `/workspace/group/media/${filename}`;
}

/**
 * Connect to Telegram and start listening for messages.
 * Messages are stored in the database; the existing message loop picks them up.
 */
export async function connectTelegram(
  getRegisteredGroups: () => Record<string, RegisteredGroup>,
): Promise<void> {
  bot = new Telegraf(TELEGRAM_BOT_TOKEN);

  // --- Text messages ---
  bot.on('text', (ctx) => {
    const mc = extractMessageContext(ctx);
    if (!mc) return;

    storeChatMetadata(mc.jid, mc.timestamp, mc.chatName);

    const registeredGroups = getRegisteredGroups();
    if (registeredGroups[mc.jid]) {
      storeGenericMessage(
        mc.msgId,
        mc.jid,
        mc.sender,
        mc.senderName,
        ctx.message.text,
        mc.timestamp,
        mc.isFromMe,
      );
    }

    logger.debug(
      { jid: mc.jid, sender: mc.senderName, registered: !!registeredGroups[mc.jid] },
      'Telegram text received',
    );
  });

  // --- Photos ---
  bot.on('photo', async (ctx) => {
    const mc = extractMessageContext(ctx);
    if (!mc) return;

    storeChatMetadata(mc.jid, mc.timestamp, mc.chatName);

    const registeredGroups = getRegisteredGroups();
    const group = registeredGroups[mc.jid];
    if (!group) return;

    try {
      // Take highest resolution (last in array)
      const photos = ctx.message.photo;
      const photo = photos[photos.length - 1];
      const buffer = await downloadTelegramFile(photo.file_id);
      const filename = `tg-${mc.msgId}.jpg`;
      const containerPath = saveMediaFile(group, filename, buffer);

      const caption = (ctx.message as Message.PhotoMessage).caption || '';
      const content = caption
        ? `[Photo: ${containerPath}] ${caption}`
        : `[Photo: ${containerPath}]`;

      storeGenericMessage(
        mc.msgId,
        mc.jid,
        mc.sender,
        mc.senderName,
        content,
        mc.timestamp,
        mc.isFromMe,
      );

      logger.info(
        { jid: mc.jid, sender: mc.senderName, size: buffer.length },
        'Telegram photo received',
      );
    } catch (err) {
      logger.error({ jid: mc.jid, err }, 'Failed to process Telegram photo');

      storeGenericMessage(
        mc.msgId,
        mc.jid,
        mc.sender,
        mc.senderName,
        '[Photo: download failed]',
        mc.timestamp,
        mc.isFromMe,
      );
    }
  });

  // --- Voice notes ---
  bot.on('voice', async (ctx) => {
    const mc = extractMessageContext(ctx);
    if (!mc) return;

    storeChatMetadata(mc.jid, mc.timestamp, mc.chatName);

    const registeredGroups = getRegisteredGroups();
    if (!registeredGroups[mc.jid]) return;

    try {
      const buffer = await downloadTelegramFile(ctx.message.voice.file_id);
      const { transcribeAudio } = await import('./transcription.js');
      const transcript = await transcribeAudio(buffer);

      const content = transcript
        ? `[Voice: ${transcript}]`
        : '[Voice message - transcription unavailable]';

      storeGenericMessage(
        mc.msgId,
        mc.jid,
        mc.sender,
        mc.senderName,
        content,
        mc.timestamp,
        mc.isFromMe,
      );

      logger.info(
        { jid: mc.jid, sender: mc.senderName, transcribed: !!transcript },
        'Telegram voice note processed',
      );
    } catch (err) {
      logger.error({ jid: mc.jid, err }, 'Failed to process Telegram voice note');

      storeGenericMessage(
        mc.msgId,
        mc.jid,
        mc.sender,
        mc.senderName,
        '[Voice message - transcription failed]',
        mc.timestamp,
        mc.isFromMe,
      );
    }
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
