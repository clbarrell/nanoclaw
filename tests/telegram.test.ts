import { describe, expect, it } from 'vitest';
import { Context } from 'telegraf';
import { Update } from 'telegraf/types';

import {
  toTelegramJid,
  fromTelegramJid,
  extractMessageContext,
} from '../src/telegram.js';

describe('toTelegramJid', () => {
  it('converts a numeric chat ID', () => {
    expect(toTelegramJid(123456789)).toBe('tg:123456789');
  });

  it('converts a string chat ID', () => {
    expect(toTelegramJid('123456789')).toBe('tg:123456789');
  });

  it('handles negative group IDs', () => {
    expect(toTelegramJid(-1001234567890)).toBe('tg:-1001234567890');
  });
});

describe('fromTelegramJid', () => {
  it('extracts chat ID from JID', () => {
    expect(fromTelegramJid('tg:123456789')).toBe('123456789');
  });

  it('handles negative group IDs', () => {
    expect(fromTelegramJid('tg:-1001234567890')).toBe('-1001234567890');
  });
});

describe('extractMessageContext', () => {
  function makeCtx(overrides: {
    chatId?: number;
    chatType?: string;
    chatTitle?: string;
    fromId?: number;
    firstName?: string;
    lastName?: string;
    isBot?: boolean;
    messageId?: number;
    date?: number;
  } = {}): Context<Update.MessageUpdate> {
    const {
      chatId = 42,
      chatType = 'private',
      chatTitle = 'Test Group',
      fromId = 100,
      firstName = 'Alice',
      lastName = 'Smith',
      isBot = false,
      messageId = 1,
      date = 1700000000,
    } = overrides;

    const chat: Record<string, unknown> = { id: chatId, type: chatType };
    if (chatType !== 'private') chat.title = chatTitle;

    return {
      chat,
      from: { id: fromId, first_name: firstName, last_name: lastName, is_bot: isBot },
      message: { message_id: messageId, date },
    } as unknown as Context<Update.MessageUpdate>;
  }

  it('extracts fields from a private chat message', () => {
    const ctx = makeCtx();
    const result = extractMessageContext(ctx);

    expect(result).not.toBeNull();
    expect(result!.chatId).toBe(42);
    expect(result!.jid).toBe('tg:42');
    expect(result!.sender).toBe('100');
    expect(result!.senderName).toBe('Alice Smith');
    expect(result!.msgId).toBe('1');
    expect(result!.isFromMe).toBe(false);
    expect(result!.chatName).toBe('Alice Smith');
    expect(result!.timestamp).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('uses group title as chatName for group chats', () => {
    const ctx = makeCtx({ chatType: 'group', chatTitle: 'My Group' });
    const result = extractMessageContext(ctx);

    expect(result!.chatName).toBe('My Group');
  });

  it('marks bot messages as isFromMe', () => {
    const ctx = makeCtx({ isBot: true });
    const result = extractMessageContext(ctx);

    expect(result!.isFromMe).toBe(true);
  });

  it('handles missing last name', () => {
    const ctx = makeCtx({ lastName: undefined as unknown as string });
    const from = (ctx as unknown as { from: Record<string, unknown> }).from;
    delete from.last_name;

    const result = extractMessageContext(ctx);
    expect(result!.senderName).toBe('Alice');
  });

  it('returns null when chat is missing', () => {
    const ctx = { chat: null, from: { id: 1 }, message: { message_id: 1, date: 0 } } as unknown as Context<Update.MessageUpdate>;
    expect(extractMessageContext(ctx)).toBeNull();
  });

  it('returns null when from is missing', () => {
    const ctx = { chat: { id: 1 }, from: null, message: { message_id: 1, date: 0 } } as unknown as Context<Update.MessageUpdate>;
    expect(extractMessageContext(ctx)).toBeNull();
  });
});

describe('/register command argument parsing', () => {
  function parseRegisterArgs(text: string): { name: string; jid: string } | null {
    const args = text.split(/\s+/).slice(1);
    if (args.length < 2) return null;
    const [name, jid] = args;
    return { name, jid };
  }

  function sanitizeFolder(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  it('parses valid /register command', () => {
    const result = parseRegisterArgs('/register gardening tg:123456789');
    expect(result).toEqual({ name: 'gardening', jid: 'tg:123456789' });
  });

  it('returns null for missing arguments', () => {
    expect(parseRegisterArgs('/register')).toBeNull();
    expect(parseRegisterArgs('/register onlyname')).toBeNull();
  });

  it('handles extra whitespace', () => {
    const result = parseRegisterArgs('/register  gardening   tg:123');
    expect(result).toEqual({ name: 'gardening', jid: 'tg:123' });
  });

  it('sanitizes folder names', () => {
    expect(sanitizeFolder('My Garden!')).toBe('my-garden-');
    expect(sanitizeFolder('test-group')).toBe('test-group');
    expect(sanitizeFolder('UPPERCASE')).toBe('uppercase');
    expect(sanitizeFolder('special@#chars')).toBe('special--chars');
  });
});
