/**
 * Converts standard Markdown (as output by Claude) to Telegram MarkdownV2 format.
 *
 * Telegram MarkdownV2 differences from standard Markdown:
 * - Bold: *text* (not **text**)
 * - Italic: _text_ (same)
 * - Strikethrough: ~text~ (not ~~text~~)
 * - Special chars must be escaped: _ * [ ] ( ) ~ ` > # + - = | { } . !
 * - Code blocks: same syntax but only ` and \ need escaping inside
 * - Links: [text](url) but ) and \ must be escaped in URL
 */

// Sentinel tokens for formatting markers (Unicode private use area)
const T = {
  BOLD_OPEN: '\uE001',
  BOLD_CLOSE: '\uE002',
  ITALIC_OPEN: '\uE003',
  ITALIC_CLOSE: '\uE004',
  STRIKE_OPEN: '\uE005',
  STRIKE_CLOSE: '\uE006',
  CODE_INLINE: '\uE007',
  CODE_BLOCK_START: '\uE008',
  CODE_BLOCK_END: '\uE009',
  LINK_TEXT_OPEN: '\uE00A',
  LINK_TEXT_CLOSE: '\uE00B',
  LINK_URL_OPEN: '\uE00C',
  LINK_URL_CLOSE: '\uE00D',
  BLOCKQUOTE: '\uE00E',
} as const;

// Characters that must be escaped in regular Telegram MarkdownV2 text
const SPECIAL_CHARS = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

// Characters that must be escaped inside code blocks
const CODE_SPECIAL_CHARS = /([`\\])/g;

// Characters that must be escaped inside link URLs
const URL_SPECIAL_CHARS = /([)\\])/g;

interface CodeBlock {
  placeholder: string;
  lang: string;
  content: string;
}

interface InlineCode {
  placeholder: string;
  content: string;
}

interface Link {
  placeholder: string;
  text: string;
  url: string;
}

/**
 * Convert standard Markdown to Telegram MarkdownV2.
 */
export function convertToTelegramMarkdown(input: string): string {
  if (!input) return input;

  let text = input;

  // Phase 1: Extract protected regions into placeholders
  const codeBlocks: CodeBlock[] = [];
  const inlineCodes: InlineCode[] = [];
  const links: Link[] = [];
  const preEscaped: string[] = [];

  // Extract fenced code blocks first (``` ... ```)
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, content) => {
    const placeholder = `\uF000CB${codeBlocks.length}\uF001`;
    codeBlocks.push({ placeholder, lang: lang || '', content });
    return placeholder;
  });

  // Extract inline code (` ... `)
  text = text.replace(/`([^`\n]+)`/g, (_, content) => {
    const placeholder = `\uF000IC${inlineCodes.length}\uF001`;
    inlineCodes.push({ placeholder, content });
    return placeholder;
  });

  // Extract links [text](url) - handle nested parens in URLs
  text = text.replace(/\[([^\]]+)\]\(((?:[^()\\]|\\.|\([^)]*\))*)\)/g, (_, linkText, url) => {
    const placeholder = `\uF000LK${links.length}\uF001`;
    links.push({ placeholder, text: linkText, url });
    return placeholder;
  });

  // Phase 2: Convert Markdown syntax to Telegram MarkdownV2 using sentinel tokens

  // Headings → bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, `${T.BOLD_OPEN}$1${T.BOLD_CLOSE}`);

  // Bold+italic (***text*** or ___text___) → *_text_*
  text = text.replace(
    /\*{3}(.+?)\*{3}/g,
    `${T.BOLD_OPEN}${T.ITALIC_OPEN}$1${T.ITALIC_CLOSE}${T.BOLD_CLOSE}`,
  );
  text = text.replace(
    /_{3}(.+?)_{3}/g,
    `${T.BOLD_OPEN}${T.ITALIC_OPEN}$1${T.ITALIC_CLOSE}${T.BOLD_CLOSE}`,
  );

  // Bold (**text** or __text__) → *text*
  text = text.replace(
    /\*{2}(.+?)\*{2}/g,
    `${T.BOLD_OPEN}$1${T.BOLD_CLOSE}`,
  );
  // Note: __text__ in standard Markdown is bold/italic, but in Telegram it's underline.
  // We convert it to bold to match standard Markdown intent.
  text = text.replace(
    /__(.+?)__/g,
    `${T.BOLD_OPEN}$1${T.BOLD_CLOSE}`,
  );

  // Italic (*text* or _text_) → _text_
  text = text.replace(
    /\*(.+?)\*/g,
    `${T.ITALIC_OPEN}$1${T.ITALIC_CLOSE}`,
  );
  text = text.replace(
    /(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/g,
    `${T.ITALIC_OPEN}$1${T.ITALIC_CLOSE}`,
  );

  // Strikethrough (~~text~~) → ~text~
  text = text.replace(
    /~~(.+?)~~/g,
    `${T.STRIKE_OPEN}$1${T.STRIKE_CLOSE}`,
  );

  // Blockquotes: > at start of line
  text = text.replace(/^>\s?/gm, T.BLOCKQUOTE);

  // Bullet lists: - or * at start of line
  text = text.replace(/^(\s*)[-*]\s/gm, (_, indent) => {
    const idx = preEscaped.length;
    preEscaped.push('\\- ');
    return `${indent}\uF000PE${idx}\uF001`;
  });

  // Numbered lists: 1. at start of line
  text = text.replace(/^(\s*\d+)\.\s/gm, (_, prefix) => {
    const idx = preEscaped.length;
    preEscaped.push('\\. ');
    return `${prefix}\uF000PE${idx}\uF001`;
  });

  // Horizontal rules (---, ***, ___)
  text = text.replace(/^[-*_]{3,}$/gm, () => {
    const idx = preEscaped.length;
    preEscaped.push('\\-\\-\\-');
    return `\uF000PE${idx}\uF001`;
  });

  // Phase 3: Escape special characters in plain text
  // Split by sentinel tokens, only escape non-sentinel segments
  const allTokens = Object.values(T);
  const tokenPattern = new RegExp(
    `(${allTokens.map((t) => escapeRegex(t)).join('|')}|` +
      `\uF000CB\\d+\uF001|\uF000IC\\d+\uF001|\uF000LK\\d+\uF001|\uF000PE\\d+\uF001)`,
  );

  const parts = text.split(tokenPattern);
  text = parts
    .map((part) => {
      // If it's a sentinel token or placeholder, leave it
      if (
        allTokens.includes(part as (typeof allTokens)[number]) ||
        /^\uF000(CB|IC|LK|PE)\d+\uF001$/.test(part)
      ) {
        return part;
      }
      // Escape special chars in regular text (but not already-escaped ones)
      return part.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '\uE0FF$1').replace(SPECIAL_CHARS, '\\$1').replace(/\uE0FF(.)/g, '\\$1');
    })
    .join('');

  // Phase 4: Replace sentinel tokens with actual Telegram MarkdownV2 markers
  text = text
    .replace(new RegExp(escapeRegex(T.BOLD_OPEN), 'g'), '*')
    .replace(new RegExp(escapeRegex(T.BOLD_CLOSE), 'g'), '*')
    .replace(new RegExp(escapeRegex(T.ITALIC_OPEN), 'g'), '_')
    .replace(new RegExp(escapeRegex(T.ITALIC_CLOSE), 'g'), '_')
    .replace(new RegExp(escapeRegex(T.STRIKE_OPEN), 'g'), '~')
    .replace(new RegExp(escapeRegex(T.STRIKE_CLOSE), 'g'), '~')
    .replace(new RegExp(escapeRegex(T.BLOCKQUOTE), 'g'), '>');

  // Phase 5: Restore pre-escaped placeholders
  for (let i = 0; i < preEscaped.length; i++) {
    text = text.replace(`\uF000PE${i}\uF001`, preEscaped[i]);
  }

  // Phase 6: Restore code blocks and inline code with proper escaping
  for (const cb of codeBlocks) {
    const escapedContent = cb.content.replace(CODE_SPECIAL_CHARS, '\\$1');
    const langTag = cb.lang ? cb.lang : '';
    const replacement = `\`\`\`${langTag}\n${escapedContent}\`\`\``;
    text = text.replace(cb.placeholder, replacement);
  }

  for (const ic of inlineCodes) {
    const escapedContent = ic.content.replace(CODE_SPECIAL_CHARS, '\\$1');
    text = text.replace(ic.placeholder, `\`${escapedContent}\``);
  }

  // Restore links with proper escaping
  for (const link of links) {
    const escapedText = link.text.replace(SPECIAL_CHARS, '\\$1');
    const escapedUrl = link.url.replace(URL_SPECIAL_CHARS, '\\$1');
    text = text.replace(
      link.placeholder,
      `[${escapedText}](${escapedUrl})`,
    );
  }

  return text;
}

/** Escape a string for use in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
